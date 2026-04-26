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

import type { SessionInfo } from '@mariozechner/pi-coding-agent'
import { AgentManager } from '../agent-manager'
import { log } from '../options'
import type { CommandResult, InlineKeyboardButton } from './types'
import { createPaginatedButtons } from './pagination'

/** Format a Date as a compact locale string without seconds (e.g. "4/25/2026, 10:32 PM"). */
function formatDate(date: Date): string {
  return (
    date.toLocaleDateString() +
    ', ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  )
}

/** Escape HTML special characters for Telegram parse_mode=HTML text. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

    const state = agentManager.getState()
    const latestMessage = getLatestMessageText(agentManager.getMessages())

    return {
      text: [
        '📚 Session details',
        '',
        '**ID:** `' + session.id.slice(0, 8) + '`',
        '**Messages:** ' + (session.messageCount ?? 0),
        '**Modified:** `' + formatDate(session.modified) + '`',
        '**Preview:** `' + truncate(stripBackticks(session.firstMessage || '(no messages)'), 40) + '`',
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
 * Handle /session <ID> command - switch to a specific session.
 */
export async function handleSessionCommand(agentManager: AgentManager, sessionPath: string): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions()
    // Match on full path, full ID, or short-ID prefix (>= 6 chars)
    const session = sessions.find(
      (s) =>
        s.path === sessionPath ||
        s.id === sessionPath ||
        (sessionPath.length >= 6 && s.id.startsWith(sessionPath))
    )

    if (!session) {
      return {
        text: `❌ Session not found: ${sessionPath}`,
      }
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
  } catch (err: any) {
    log.error('Failed to switch session:', err.message)
    return {
      text: `❌ Failed to switch session: ${err.message}`,
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
      text: `📊 Session Status\n\nSession ID: ${state.sessionId.slice(0, 8)}\nModel: ${state.model}\nMessages: ${state.messageCount}\nStreaming: ${state.isStreaming}\nThinking Level: ${state.thinkingLevel}`,
    }
  } catch (err: any) {
    log.error('Failed to get status:', err.message)
    return {
      text: `❌ Failed to get status: ${err.message}`,
    }
  }
}

/**
 * Handle /model [name] command - show or change model.
 */
export async function handleModelCommand(agentManager: AgentManager, newModel?: string): Promise<CommandResult> {
  try {
    if (newModel) {
      // Parse model name (provider/model or just model)
      const parts = newModel.split('/')
      let provider: string
      let modelId: string

      if (parts.length === 2) {
        provider = parts[0]
        modelId = parts[1]
      } else {
        // Assume current provider
        const state = agentManager.getState()
        if (!state || !state.model) {
          return {
            text: `❌ No model configured. Use format: \`/model provider/modelId\``,
          }
        }
        const current = state.model.split('/')
        provider = current[0]
        modelId = parts[0]
      }

      await agentManager.setModel(provider, modelId)
      const state = agentManager.getState()

      return {
        text: `✅ Model changed to: ${state?.model}`,
        markup: {
          inline_keyboard: [[{ text: '🔄 List available models', callback_data: 'list_models' }]],
        },
      }
    } else {
      // Show current model
      const state = agentManager.getState()
      const availableModels = agentManager.getAvailableModels()

      const currentModel = state?.model || 'not set'
      const modelList = availableModels.map((m) => `  • ${m.provider}/${m.id}`).join('\n')

      return {
        text: `📊 Current model: ${currentModel}\n\nAvailable models:\n${modelList}`,
      }
    }
  } catch (err: any) {
    log.error('Failed to handle model command:', err.message)
    return {
      text: `❌ ${err.message}`,
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
    '/model [name] - Show/change model',
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
  | { type: 'model'; model?: string }
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
      return { type: 'model', model: parsed.args || undefined }
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
      return handleModelCommand(agentManager, command.model)

    case 'abort':
      return handleAbortCommand(agentManager)

    case 'noop':
      // Ignore noop callbacks (page indicator button)
      return null

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
    { name: 'model', description: 'Change the AI model' },
    { name: 'abort', description: 'Abort the current operation' },
  ]

  return allCommands.map((c) => ({
    command: c.name,
    description: c.description.slice(0, 256), // Telegram limit
  }))
}
