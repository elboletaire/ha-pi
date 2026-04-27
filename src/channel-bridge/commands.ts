/**
 * Telegram bot command handlers.
 *
 * Handles /new, /sessions, /status, /abort, /model commands and session selection callbacks.
 * Commands are processed before reaching the AgentManager.
 *
 * NOTE: Command responses use Markdown syntax (processed by markdownToTelegramHTML downstream).
 * Dynamic string values should be wrapped in backticks to prevent Markdown injection.
 * Numeric values are safe to include directly without escaping.
 */

import { AgentManager } from '../agent-manager'
import { log } from '../options'
import type { CommandResult, InlineKeyboardButton } from './types'
import { createPaginatedButtons } from './pagination'
import { readFile } from 'node:fs/promises'

/** Format a Date as a compact locale string without seconds (e.g. "4/25/2026, 10:32 PM"). */
function formatDate(date: Date): string {
  return (
    date.toLocaleDateString() +
    ', ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  )
}

/** Truncate a string to `max` chars, appending '…' if cut. */
function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + '…'
}

/** Strip backticks from dynamic content before wrapping in backticks. */
function stripBackticks(str: string): string {
  return str.replace(/`/g, "'")
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const typedBlock = block as { type?: string; text?: unknown }
      return typedBlock.type === 'text' && typeof typedBlock.text === 'string' ? typedBlock.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function getLatestMessageText(messages: unknown[]): string {
  const latestMessage = messages.at(-1)
  if (!latestMessage || typeof latestMessage !== 'object') {
    return '(no messages)'
  }

  const content = (latestMessage as { content?: unknown }).content
  const text = extractTextFromContent(content).trim()
  return text || '(no text content)'
}

/**
 * Read the JSONL session file and return the text of the last message entry.
 * Handles both plain-string content and ContentBlock arrays.
 * Returns '(no messages)' when the file is absent, empty, or has no text content.
 */
async function readLastMessageFromSessionFile(sessionPath: string): Promise<string> {
  try {
    const content = await readFile(sessionPath, 'utf-8')
    const lines = content.trim().split('\n')
    let lastText = ''
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown } }
        if (entry?.type === 'message' && entry?.message) {
          const text = extractTextFromContent(entry.message.content).trim()
          if (text) lastText = text
        }
      } catch {
        // Skip malformed lines
      }
    }
    return lastText || '(no messages)'
  } catch {
    return '(no messages)'
  }
}

/**
 * Handle /new command - create a new session.
 */
export async function handleNewCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    await agentManager.newSession()
    const state = agentManager.getState()

    return {
      text: `✅ New session created.\n\n**ID:** \`${state?.sessionId.slice(0, 8)}\`\n**Model:** \`${state?.model}\``,
    }
  } catch (err: any) {
    log.error('Failed to create new session:', err.message)
    return {
      text: `❌ Failed to create session: ${err.message}`,
    }
  }
}

/**
 * Handle /sessions command - list all sessions with pagination.
 */
export async function handleSessionsCommand(
  agentManager: AgentManager,
  page: number = 0
): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions()

    if (sessions.length === 0) {
      return {
        text: 'No sessions found.',
        markup: {
          inline_keyboard: [
            [{ text: '🆕 New session', callback_data: '/new' }],
          ],
        },
      }
    }

    const result = createPaginatedButtons({
      items: sessions,
      page,
      pageSize: 5,
      callbackPrefix: 'sessions',
      buttonLabel: (s) => truncate(stripBackticks(s.firstMessage || s.id.slice(0, 8)), 40),
      buttonData: (s) => 'sessions:select:' + s.id.slice(0, 8),
    })

    return {
      text: '📚 Select a session to load',
      markup: {
        inline_keyboard: result.buttons,
      },
    }
  } catch (err: any) {
    log.error('Failed to list sessions:', err.message)
    return {
      text: `❌ Failed to list sessions: ${err.message}`,
    }
  }
}

/**
 * Handle session select command - show session details with Load/Back buttons.
 */
export async function handleSessionSelectCommand(agentManager: AgentManager, shortId: string): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions()
    const session = sessions.find((s) => s.id.startsWith(shortId))

    if (!session) {
      return {
        text: `❌ Session not found: ${shortId}`,
      }
    }

    const preview = await readLastMessageFromSessionFile(session.path)
    return {
      text: [
        '📚 Session details',
        '',
        '**ID:** `' + session.id.slice(0, 8) + '`',
        '**Messages:** ' + (session.messageCount ?? 0),
        '**Modified:** `' + formatDate(session.modified) + '`',
        '**Preview:** ' + truncate(preview, 100),
      ].join('\n'),
      markup: {
        inline_keyboard: [
          [
            { text: '✅ Load session', callback_data: 'sessions:load:' + session.id.slice(0, 8) },
            { text: '← Back', callback_data: 'sessions:page:0' },
          ],
        ],
      },
    }
  } catch (err: any) {
    log.error('Failed to select session:', err.message)
    return {
      text: `❌ Failed to select session: ${err.message}`,
    }
  }
}

/**
 * Handle /delete <ID> command - delete a session.
 */
export async function handleDeleteCommand(agentManager: AgentManager, sessionPath: string): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions()
    const session = sessions.find((s) => s.path === sessionPath || s.id === sessionPath)

    if (!session) {
      return {
        text: `❌ Session not found: ${sessionPath}`,
      }
    }

    await agentManager.deleteSession(session.path)

    return {
      text: `✅ Session deleted: ${session.id.slice(0, 8)}`,
      markup: {
        inline_keyboard: [[{ text: '🔄 List sessions', callback_data: 'list_sessions' }]],
      },
    }
  } catch (err: any) {
    log.error('Failed to delete session:', err.message)
    return {
      text: `❌ Failed to delete session: ${err.message}`,
    }
  }
}

/**
 * Handle /status command - show current session status.
 */
export async function handleStatusCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    const state = agentManager.getState()

    if (!state) {
      return {
        text: '⚠️ No session active.',
      }
    }

    return {
      text: [
        '📊 **Session Status**',
        '',
        `**Session ID:** \`${state.sessionId.slice(0, 8)}\``,
        `**Model:** \`${state.model || 'not set'}\``,
        `**Messages:** ${state.messageCount}`,
        `**Streaming:** ${state.isStreaming ? '✅' : '❌'}`,
        `**Thinking Level:** \`${state.thinkingLevel}\``,
      ].join('\n'),
    }
  } catch (err: any) {
    log.error('Failed to get status:', err.message)
    return {
      text: `❌ Failed to get status: ${err.message}`,
    }
  }
}

/**
 * Handle /model list command - show paginated model list.
 */
export async function handleModelListCommand(
  agentManager: AgentManager,
  page: number = 0
): Promise<CommandResult> {
  try {
    const state = agentManager.getState()
    const availableModels = agentManager.getAvailableModels()

    if (availableModels.length === 0) {
      return {
        text: '⚠️ No models available. Check your API key configuration.',
      }
    }

    const currentModel = state?.model || null

    // Pre-compute labels with ✓ prefix for current model
    const labeledModels = availableModels.map((m, idx) => ({
      ...m,
      index: idx,
      label: (currentModel === `${m.provider}/${m.id}` ? '✓ ' : '') + `${m.provider}/${m.id}`,
    }))

    const result = createPaginatedButtons({
      items: labeledModels,
      page,
      pageSize: 5,
      callbackPrefix: 'models',
      buttonLabel: (item) => item.label,
      buttonData: (item, globalIndex) => `models:select:${globalIndex}`,
    })

    return {
      text: '🤖 Select a model',
      markup: {
        inline_keyboard: result.buttons,
      },
    }
  } catch (err: any) {
    log.error('Failed to list models:', err.message)
    return {
      text: `❌ Failed to list models: ${err.message}`,
    }
  }
}

/**
 * Handle model select command - show model details with Use/Back buttons.
 */
export async function handleModelSelectCommand(agentManager: AgentManager, index: number): Promise<CommandResult> {
  try {
    const availableModels = agentManager.getAvailableModels()

    if (index < 0 || index >= availableModels.length) {
      return {
        text: '❌ Model not found. The model list may have changed. Use /model to browse again.',
      }
    }

    const model = availableModels[index]
    const state = agentManager.getState()
    const currentModel = state?.model || null
    const isCurrent = currentModel === `${model.provider}/${model.id}`

    return {
      text: [
        '🤖 Model details',
        '',
        '**Provider:** `' + model.provider + '`',
        '**Model:** `' + model.id + '`',
        '**Current:** ' + (isCurrent ? '✓' : '✗'),
      ].join('\n'),
      markup: {
        inline_keyboard: [
          [
            { text: '✅ Use this model', callback_data: 'models:load:' + index },
            { text: '← Back', callback_data: 'models:page:0' },
          ],
        ],
      },
    }
  } catch (err: any) {
    log.error('Failed to select model:', err.message)
    return {
      text: `❌ Failed to select model: ${err.message}`,
    }
  }
}

/**
 * Handle /model load command - set the selected model.
 */
export async function handleModelLoadCommand(agentManager: AgentManager, index: number): Promise<CommandResult> {
  try {
    const availableModels = agentManager.getAvailableModels()

    if (index < 0 || index >= availableModels.length) {
      return {
        text: '❌ Model not found. The model list may have changed. Use /model to browse again.',
      }
    }

    const model = availableModels[index]
    await agentManager.setModel(model.provider, model.id)
    const state = agentManager.getState()

    return {
      text: '🧠 Model changed to: `' + (state?.model || model.provider + '/' + model.id) + '`',
    }
  } catch (err: any) {
    log.error('Failed to set model:', err.message)
    return {
      text: `❌ Failed to set model: ${err.message}`,
    }
  }
}

/**
 * Handle /abort command - cancel current generation.
 */
export async function handleAbortCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    await agentManager.abort()
    return {
      text: '✅ Generation aborted.',
      markup: {
        inline_keyboard: [[{ text: '🔄 Continue chatting', callback_data: 'continue_chat' }]],
      },
    }
  } catch (err: any) {
    log.error('Failed to abort:', err.message)
    return {
      text: `❌ Failed to abort: ${err.message}`,
    }
  }
}

/**
 * Handle /thinking command - show current thinking level and available options.
 */
export async function handleThinkingCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    const state = agentManager.getState()

    if (!state) {
      return {
        text: '⚠️ No session active.',
      }
    }

    const availableLevels = agentManager.getAvailableThinkingLevels()

    if (availableLevels.length === 0) {
      // Extract short model name from provider/id format
      const modelName = state.model ? state.model.split('/').pop() : 'unknown'
      return {
        text: [
          '🧠 **Thinking Level**',
          '',
          `The current model (\`${modelName}\`) does not support reasoning/thinking levels.`,
        ].join('\n'),
      }
    }

    // Build buttons 2 per row, with current level marked ✓
    const rows: InlineKeyboardButton[][] = []
    for (let i = 0; i < availableLevels.length; i += 2) {
      const row: InlineKeyboardButton[] = [
        {
          text: availableLevels[i].startsWith('✓') ? availableLevels[i] : (state.thinkingLevel === availableLevels[i] ? '✓ ' : '') + availableLevels[i],
          callback_data: `thinking:set:${availableLevels[i]}`,
        },
      ]
      if (i + 1 < availableLevels.length) {
        row.push({
          text: availableLevels[i + 1].startsWith('✓') ? availableLevels[i + 1] : (state.thinkingLevel === availableLevels[i + 1] ? '✓ ' : '') + availableLevels[i + 1],
          callback_data: `thinking:set:${availableLevels[i + 1]}`,
        })
      }
      rows.push(row)
    }

    return {
      text: [
        '🧠 **Thinking Level**',
        '',
        `Current: \`${state.thinkingLevel}\``,
      ].join('\n'),
      markup: {
        inline_keyboard: rows,
      },
    }
  } catch (err: any) {
    log.error('Failed to get thinking levels:', err.message)
    return {
      text: `❌ Failed to get thinking levels: ${err.message}`,
    }
  }
}

/**
 * Handle thinking:set:<level> command - set the thinking level.
 */
export async function handleThinkingSetCommand(agentManager: AgentManager, level: string): Promise<CommandResult> {
  try {
    const availableLevels = agentManager.getAvailableThinkingLevels()

    // If the model doesn't support reasoning at all, show a specific error
    if (availableLevels.length === 0) {
      const state = agentManager.getState()
      const modelName = state?.model ? state.model.split('/').pop() : 'unknown'
      return {
        text: `❌ The current model (\`${modelName}\`) does not support thinking/reasoning levels.`,
      }
    }

    // Validate level is in available levels
    if (!availableLevels.includes(level)) {
      return {
        text: `❌ Invalid thinking level: \`${level}\`. Available levels: ${availableLevels.join(', ')}.`,
      }
    }

    await agentManager.setThinkingLevel(level)

    return {
      text: '✅ Thinking level changed to: `' + level + '`',
    }
  } catch (err: any) {
    log.error('Failed to set thinking level:', err.message)
    return {
      text: `❌ Failed to set thinking level: ${err.message}`,
    }
  }
}

function buildWelcomeText(): string {
  return [
    '🤖 Welcome to Pi Agent!',
    '',
    "I'm your AI coding assistant on Telegram.",
    '',
    'Commands:',
    '/start - This message',
    '/help - Show this message',
    '/new - Create new session',
    '/sessions - List all sessions',
    '/delete <ID> - Delete session',
    '/status - Show current status',
    '/model - Browse and change AI model',
    '/thinking - Change thinking/reasoning level',
    '/abort - Cancel generation',
    '',
    'Send me a message to start coding!',
  ].join('\n')
}

export async function handleStartCommand(): Promise<CommandResult> {
  return {
    text: buildWelcomeText(),
    markup: {
      inline_keyboard: [
        [
          { text: '🆕 New session', callback_data: '/new' },
          { text: '📚 Sessions', callback_data: '/sessions' },
        ],
        [
          { text: '📊 Status', callback_data: '/status' },
          { text: '❓ Help', callback_data: '/help' },
        ],
      ],
    },
  }
}

export async function handleHelpCommand(): Promise<CommandResult> {
  return handleStartCommand()
}

function parseTelegramCommand(text: string): { name: string; args: string } | undefined {
  const trimmed = text.trim()

  switch (trimmed) {
    case 'back_to_chat':
    case 'continue_chat':
      return { name: 'start', args: '' }
    case 'list_sessions':
      return { name: 'sessions', args: '' }
    case 'list_models':
      return { name: 'model', args: '' }
  }

  if (!trimmed.startsWith('/')) return undefined

  const [commandToken, ...rest] = trimmed.split(/\s+/)
  const match = commandToken.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?$/i)
  if (!match) return undefined

  return {
    name: match[1].toLowerCase(),
    args: rest.join(' ').trim(),
  }
}

/**
 * Parse callback data and text commands.
 * Returns undefined if the command doesn't match any handler.
 */
export function parseCommand(
  text: string
):
  | { type: 'start' }
  | { type: 'help' }
  | { type: 'new' }
  | { type: 'sessions'; page?: number }
  | { type: 'session_select'; id: string }
  | { type: 'session_load'; id: string }
  | { type: 'delete'; path: string }
  | { type: 'status' }
  | { type: 'model'; page?: number }
  | { type: 'model_select'; index: number }
  | { type: 'model_load'; index: number }
  | { type: 'thinking' }
  | { type: 'thinking_set'; level: string }
  | { type: 'abort' }
  | { type: 'noop' }
  | undefined {
  // Parse callback data format: "prefix:data:id" or "prefix:data"
  if (text.startsWith('sessions:')) {
    const parts = text.split(':')
    if (parts.length === 3 && parts[1] === 'select') {
      return { type: 'session_select', id: parts[2] }
    }
    if (parts.length === 3 && parts[1] === 'load') {
      return { type: 'session_load', id: parts[2] }
    }
    if (parts.length === 3 && parts[1] === 'page') {
      const page = parseInt(parts[2], 10)
      if (!isNaN(page)) {
        return { type: 'sessions', page }
      }
    }
    if (parts.length === 2 && parts[1] === 'noop') {
      return { type: 'noop' }
    }
  }

  // Parse model callbacks
  if (text.startsWith('models:')) {
    const parts = text.split(':')
    if (parts.length === 3 && parts[1] === 'select') {
      const index = parseInt(parts[2], 10)
      if (!isNaN(index)) {
        return { type: 'model_select', index }
      }
    }
    if (parts.length === 3 && parts[1] === 'load') {
      const index = parseInt(parts[2], 10)
      if (!isNaN(index)) {
        return { type: 'model_load', index }
      }
    }
    if (parts.length === 3 && parts[1] === 'page') {
      const page = parseInt(parts[2], 10)
      if (!isNaN(page)) {
        return { type: 'model', page }
      }
    }
    // Page indicator callback - intentionally ignored
    if (parts.length === 2 && parts[1] === 'noop') {
      return { type: 'noop' }
    }
  }

  // Parse thinking callbacks
  if (text.startsWith('thinking:set:')) {
    const level = text.slice('thinking:set:'.length)
    return { type: 'thinking_set', level }
  }

  const parsed = parseTelegramCommand(text)
  if (!parsed) return undefined

  switch (parsed.name) {
    case 'start':
      return { type: 'start' }
    case 'help':
      return { type: 'help' }
    case 'new':
      return { type: 'new' }
    case 'sessions':
      return { type: 'sessions' }
    case 'delete':
      return { type: 'delete', path: parsed.args }
    case 'status':
      return { type: 'status' }
    case 'model':
      // Ignore model arguments, always show list
      return { type: 'model' }
    case 'thinking':
      return { type: 'thinking' }
    case 'abort':
      return { type: 'abort' }
    default:
      return undefined
  }
}

/**
 * Process a command and return the result.
 */
export async function processCommand(agentManager: AgentManager, text: string): Promise<CommandResult | null> {
  const command = parseCommand(text)

  if (!command) {
    return null
  }

  switch (command.type) {
    case 'start':
      return handleStartCommand()

    case 'help':
      return handleHelpCommand()

    case 'new':
      return handleNewCommand(agentManager)

    case 'sessions':
      return handleSessionsCommand(agentManager, command.page ?? 0)

    case 'session_select':
      return handleSessionSelectCommand(agentManager, command.id)

    case 'session_load':
      // Reuse handleSessionCommand logic for loading
      const sessions = await agentManager.listSessions()
      const session = sessions.find((s) => s.id.startsWith(command.id))
      if (!session) {
        return { text: `❌ Session not found: ${command.id}` }
      }
      await agentManager.switchSession(session.path)
      const state = agentManager.getState()
      const latestMessage = getLatestMessageText(agentManager.getMessages())
      return {
        text: [
          '✅ Switched to session.',
          '',
          '**ID:** `' + session.id.slice(0, 8) + '`',
          '**Model:** `' + (state?.model || 'not set') + '`',
          '**Messages:** ' + (state?.messageCount ?? 0),
          '**Latest message:** `' + latestMessage + '`',
        ].join('\n'),
      }

    case 'delete':
      return handleDeleteCommand(agentManager, command.path)

    case 'status':
      return handleStatusCommand(agentManager)

    case 'model':
      return handleModelListCommand(agentManager, command.page ?? 0)

    case 'model_select':
      return handleModelSelectCommand(agentManager, command.index)

    case 'model_load':
      return handleModelLoadCommand(agentManager, command.index)

    case 'thinking':
      return handleThinkingCommand(agentManager)

    case 'thinking_set':
      return handleThinkingSetCommand(agentManager, command.level)

    case 'abort':
      return handleAbortCommand(agentManager)

    case 'noop':
      // Ignore noop callbacks (page indicator button) by returning an empty response.
      return { text: '' }

    default:
      return null
  }
}

// ── Telegram-specific command helpers ────────────────────

export interface BotCommand {
  name: string
  description: string
  emoji?: string
}

/**
 * Get commands formatted for Telegram's setMyCommands API.
 */
export function getCommandsForTelegram(): Array<{ command: string; description: string }> {
  // Return the built-in commands that are available in this system
  const allCommands: BotCommand[] = [
    { name: 'start', description: 'Show the welcome message' },
    { name: 'help', description: 'Show the welcome message' },
    { name: 'new', description: 'Start a new session' },
    { name: 'sessions', description: 'List available sessions' },
    { name: 'delete', description: 'Delete a session' },
    { name: 'status', description: 'Check system status and health' },
    { name: 'model', description: 'Browse and change AI model' },
    { name: 'thinking', description: 'Change thinking/reasoning level' },
    { name: 'abort', description: 'Abort the current operation' },
  ]

  return allCommands.map((c) => ({
    command: c.name,
    description: c.description.slice(0, 256), // Telegram limit
  }))
}
