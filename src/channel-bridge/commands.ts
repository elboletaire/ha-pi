/**
 * Telegram bot command handlers.
 *
 * Handles /new, /sessions, /session, /status, /abort, /model commands.
 * Commands are processed before reaching the AgentManager.
 */

import type { SessionInfo } from '@mariozechner/pi-coding-agent'
import { AgentManager } from '../agent-manager'
import { log } from '../options'
import type { CommandResult } from './types'

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
 * Build a readable session list.
 *
 * Each session is rendered as a tappable /s‹id› command link followed by a
 * one-line preview of the first user message, so the user can identify and
 * switch to a session with a single tap.
 *
 * Example:
 *   /s019dc5e5 · 22 msgs · 4/25/2026, 10:32 PM
 *   "What does this code do in server.ts?"
 */
function buildSessionListText(sessions: SessionInfo[]): string {
  if (sessions.length === 0) {
    return 'No sessions found.\n\n/new — start a new session'
  }

  const lines: string[] = [`📚 Sessions (${sessions.length}):\n`]

  for (const session of sessions) {
    const shortId = session.id.slice(0, 8)
    const msgs = session.messageCount
    const date = formatDate(session.modified)
    const preview = truncate(session.firstMessage || '(no messages)', 60)

    lines.push(`/s${shortId} · ${msgs} msgs · ${date}`)
    lines.push(`"${preview}"`)
    lines.push('')
  }

  lines.push('Tap a /s‹ID› link to switch · /new to start fresh')

  return lines.join('\n')
}

/**
 * Handle /new command - create a new session.
 */
export async function handleNewCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    await agentManager.newSession()
    const state = agentManager.getState()

    return {
      text: `✅ New session created.\n\nID: \`${state?.sessionId.slice(0, 8)}\`\nModel: ${state?.model}`,
    }
  } catch (err: any) {
    log.error('Failed to create new session:', err.message)
    return {
      text: `❌ Failed to create session: ${err.message}`,
    }
  }
}

/**
 * Handle /sessions command - list all sessions.
 */
export async function handleSessionsCommand(agentManager: AgentManager): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions()
    return {
      text: buildSessionListText(sessions),
    }
  } catch (err: any) {
    log.error('Failed to list sessions:', err.message)
    return {
      text: `❌ Failed to list sessions: ${err.message}`,
    }
  }
}

/**
 * Handle /session <ID> command - switch to a specific session.
 */
export async function handleSessionCommand(agentManager: AgentManager, sessionPath: string): Promise<CommandResult> {
  try {
    const sessions = await agentManager.listSessions()
    // Match on full path, full ID, or short-ID prefix (>= 6 chars, from /s‹id› shortcuts)
    const session = sessions.find(
      (s) =>
        s.path === sessionPath ||
        s.id === sessionPath ||
        (sessionPath.length >= 6 && s.id.startsWith(sessionPath))
    )

    if (!session) {
      return {
        text: `❌ Session not found: ${sessionPath}\n\nAvailable sessions:\n${buildSessionListText(sessions)}`,
      }
    }

    await agentManager.switchSession(session.path)
    const state = agentManager.getState()
    const latestMessage = getLatestMessageText(agentManager.getMessages())

    return {
      text: [
        '✅ Switched to session.',
        '',
        `<b>ID:</b> ${escapeHtml(session.id.slice(0, 8))}`,
        `<b>Model:</b> ${escapeHtml(state?.model || 'not set')}`,
        `<b>Messages:</b> ${state?.messageCount ?? 0}`,
        `<b>Latest message:</b> ${escapeHtml(latestMessage)}`,
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
    '/session <ID> - Switch to session',
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

  if (trimmed.startsWith('session:')) {
    return {
      name: 'session',
      args: trimmed.slice('session:'.length),
    }
  }

  if (!trimmed.startsWith('/')) return undefined

  // /s‹id› shortcut — session switch via short hex ID, not registered in autocomplete.
  // Must be checked before the general command regex (which would swallow /s019dc5e5
  // as command name 's019dc5e5' with empty args, never reaching the 'session' case).
  const shortSwitch = trimmed.match(/^\/s([0-9a-f]{6,})(?:@[a-z0-9_]+)?$/i)
  if (shortSwitch) {
    return { name: 'session', args: shortSwitch[1] }
  }

  const [commandToken, ...rest] = trimmed.split(/\s+/)
  const match = commandToken.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?$/i)
  if (!match) return undefined

  return {
    name: match[1].toLowerCase(),
    args: rest.join(' ').trim(),
  }
}

/**
 * Map incoming text commands to handlers.
 * Returns undefined if the command doesn't match any handler.
 */
export function parseCommand(
  text: string
):
  | { type: 'start' }
  | { type: 'help' }
  | { type: 'new' }
  | { type: 'sessions' }
  | { type: 'session'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'status' }
  | { type: 'model'; model?: string }
  | { type: 'abort' }
  | undefined {
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
    case 'session':
      return { type: 'session', path: parsed.args }
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
      return handleSessionsCommand(agentManager)

    case 'session':
      return handleSessionCommand(agentManager, command.path)

    case 'delete':
      return handleDeleteCommand(agentManager, command.path)

    case 'status':
      return handleStatusCommand(agentManager)

    case 'model':
      return handleModelCommand(agentManager, command.model)

    case 'abort':
      return handleAbortCommand(agentManager)

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
    { name: 'session', description: 'Switch to a session' },
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
