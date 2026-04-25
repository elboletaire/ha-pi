/**
 * pi-channels — Bot command handler.
 *
 * Detects messages starting with / and handles them without routing
 * to the agent. Provides built-in commands and a registry for custom ones.
 *
 * Built-in: /start, /help, /abort, /status, /new, /model, /whoami, /ping
 * Shortcuts: /cal, /crm, /idea, /brain, /time — rewrite to agent prompts
 * Instant: /dev, /menu — execute locally, no LLM
 */

import type { SenderSession, ModelHealth, CommandResult, InlineKeyboardMarkup, ReplyKeyboardMarkup } from '../types.ts'

export interface BotCommand {
  name: string
  description: string
  /** Button display emoji (e.g. "📅") */
  emoji?: string
  /** Include in /menu reply keyboard */
  showInKeyboard?: boolean
  /** 0-based row in reply keyboard */
  keyboardRow?: number
  /** Sort position within row */
  keyboardOrder?: number
  handler: (
    args: string,
    session: SenderSession | undefined,
    ctx: CommandContext
  ) => string | CommandResult | null | Promise<string | CommandResult | null>
}

export interface CommandContext {
  abortCurrent: (sender: string) => boolean
  clearQueue: (sender: string) => void
  resetSession: (sender: string) => void
  /** Check if a given sender is using persistent (RPC) mode. */
  isPersistent: (sender: string) => boolean
  /** Get current model name. */
  getModel: () => string
  /** Change the model for this bridge session. */
  setModel: (model: string) => void
  /** Get list of available models (optional, may return empty if not implemented). */
  getAvailableModels?: () => string[]
  /** Restart session with new model, preserving context. */
  restartSessionWithModel: (sender: string, model: string) => Promise<void>
  /** Model health diagnostics. */
  getModelHealth: () => ModelHealth
}

const commands = new Map<string, BotCommand>()

/** Track which senders have the reply keyboard active. */
const menuActive = new Set<string>()

export function isCommand(text: string): boolean {
  return /^\/[a-zA-Z]/.test(text.trim())
}

export function parseCommand(text: string): { command: string; args: string } {
  const match = text.trim().match(/^\/([a-zA-Z_]+)(?:@\S+)?\s*(.*)/s)
  if (!match) return { command: '', args: '' }
  return { command: match[1].toLowerCase(), args: match[2].trim() }
}

export function registerCommand(cmd: BotCommand): void {
  commands.set(cmd.name.toLowerCase(), cmd)
}

export function unregisterCommand(name: string): void {
  commands.delete(name.toLowerCase())
}

export function getAllCommands(): BotCommand[] {
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get commands formatted for Telegram's setMyCommands API.
 * Excludes /start (Telegram handles it specially).
 */
export function getCommandsForTelegram(): Array<{ command: string; description: string }> {
  return getAllCommands()
    .filter((c) => c.name !== 'start') // Telegram handles /start natively
    .map((c) => ({
      command: c.name,
      description: c.description.slice(0, 256), // Telegram limit
    }))
}

/**
 * Build inline keyboard grid from commands that have emoji defined.
 * Arranges buttons in rows of `perRow` (default 3).
 * Each button sends the command text (e.g. "/cal") when tapped.
 */
export function getInlineGrid(perRow = 3): InlineKeyboardMarkup {
  const cmds = getAllCommands().filter((c) => c.emoji && c.name !== 'start' && c.name !== 'menu')
  const buttons = cmds.map((c) => ({
    text: `${c.emoji} ${c.name.charAt(0).toUpperCase() + c.name.slice(1)}`,
    callback_data: `/${c.name}`,
  }))
  const rows: Array<Array<{ text: string; callback_data: string }>> = []
  for (let i = 0; i < buttons.length; i += perRow) {
    rows.push(buttons.slice(i, i + perRow))
  }
  return { inline_keyboard: rows }
}

/**
 * Build reply keyboard from commands with showInKeyboard=true.
 * Sorted by keyboardRow, then keyboardOrder.
 */
export function getKeyboardLayout(): ReplyKeyboardMarkup {
  const cmds = getAllCommands()
    .filter((c) => c.showInKeyboard)
    .sort((a, b) => {
      const rowDiff = (a.keyboardRow ?? 99) - (b.keyboardRow ?? 99)
      if (rowDiff !== 0) return rowDiff
      return (a.keyboardOrder ?? 99) - (b.keyboardOrder ?? 99)
    })

  const rowMap = new Map<number, Array<{ text: string }>>()
  for (const c of cmds) {
    const row = c.keyboardRow ?? 0
    if (!rowMap.has(row)) rowMap.set(row, [])
    rowMap.get(row)!.push({ text: `${c.emoji || ''} /${c.name}`.trim() })
  }

  const keyboard = [...rowMap.entries()].sort(([a], [b]) => a - b).map(([, buttons]) => buttons)

  return { keyboard, resize_keyboard: true, one_time_keyboard: false }
}

/**
 * Sentinel prefix for commands that rewrite to agent prompts.
 * When a handler returns this prefix + text, the bridge sends
 * the text to the agent queue instead of replying directly.
 */
export const PROMPT_PREFIX = '__PROMPT__:'

/**
 * Check if a command result is a prompt rewrite (should be sent to agent).
 */
export function isPromptRewrite(result: string): boolean {
  return result.startsWith(PROMPT_PREFIX)
}

/**
 * Extract the prompt text from a prompt rewrite result.
 */
export function extractPrompt(result: string): string {
  return result.slice(PROMPT_PREFIX.length)
}

/**
 * Handle a command. Returns reply text/CommandResult, or null if unrecognized
 * (fall through to agent).
 *
 * If the result starts with PROMPT_PREFIX, the bridge should send
 * it to the agent as a prompt instead of replying directly.
 */
export async function handleCommand(
  text: string,
  session: SenderSession | undefined,
  ctx: CommandContext
): Promise<string | CommandResult | null> {
  const { command } = parseCommand(text)
  if (!command) return null
  const cmd = commands.get(command)
  if (!cmd) return null
  const { args } = parseCommand(text)
  return await cmd.handler(args, session, ctx)
}

// ── Built-in commands ───────────────────────────────────────────

registerCommand({
  name: 'start',
  description: 'Welcome message',
  emoji: '👋',
  handler: () => ({
    text: "👋 Hi! I'm your Pi assistant.\n\nSend me a message and I'll process it. Use /help to see available commands.",
    markup: getInlineGrid(),
  }),
})

registerCommand({
  name: 'help',
  description: 'Show available commands',
  emoji: '❓',
  handler: () => {
    const lines = getAllCommands().map((c) => `${c.emoji || '·'} /${c.name} — ${c.description}`)
    return {
      text: `<b>Available commands:</b>\n\n${lines.join('\n')}`,
      markup: getInlineGrid(),
    }
  },
})

registerCommand({
  name: 'abort',
  description: 'Cancel the current prompt',
  emoji: '❌',
  handler: (_args, session, ctx) => {
    if (!session) return 'No active session.'
    if (!session.processing) return 'Nothing is running right now.'
    return ctx.abortCurrent(session.sender) ? '⏹ Aborting current prompt...' : 'Failed to abort — nothing running.'
  },
})

registerCommand({
  name: 'status',
  description: 'Show session and model health info',
  emoji: '📊',
  showInKeyboard: true,
  keyboardRow: 1,
  keyboardOrder: 1,
  handler: (_args, session, ctx) => {
    const health = ctx.getModelHealth()
    const modelStatus = health.validated
      ? `✅ ${health.model}`
      : `⚠️ ${health.model} — ${health.error || 'not validated'}`

    if (!session) {
      const lines = [
        `<b>Bridge Status</b>`,
        `- Model: ${modelStatus}`,
        `- Session: No active session. Send a message to start one.`,
      ]
      if (health.lastError) {
        lines.push(`- Last error: ${health.lastError}`)
      }
      return {
        text: lines.join('\n'),
        markup: {
          inline_keyboard: [
            [
              { text: '🆕 New Session', callback_data: '/new' },
              { text: '🔄 Model', callback_data: '/model' },
              { text: '❌ Abort', callback_data: '/abort' },
            ],
          ],
        },
      }
    }

    const persistent = ctx.isPersistent(session.sender)
    const uptime = Math.floor((Date.now() - session.startedAt) / 1000)
    const mins = Math.floor(uptime / 60)
    const secs = uptime % 60
    const lines = [
      `<b>Session Status</b>`,
      `- Model: ${modelStatus}`,
      `- Mode: ${persistent ? '🔗 Persistent (conversation memory)' : '⚡ Stateless (no memory)'}`,
      `- State: ${session.processing ? '⏳ Processing...' : '💤 Idle'}`,
      `- Messages: ${session.messageCount}`,
      `- Queue: ${session.queue.length} pending`,
      `- Uptime: ${mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}`,
    ]
    if (persistent) {
      lines.push(`- Context: 💾 Auto-saved on idle (restored on reconnect)`)
    }
    if (health.lastError) {
      lines.push(`- Last error: ${health.lastError}`)
    }
    return {
      text: lines.join('\n'),
      markup: {
        inline_keyboard: [
          [
            { text: '🆕 New Session', callback_data: '/new' },
            { text: '🔄 Model', callback_data: '/model' },
            { text: '❌ Abort', callback_data: '/abort' },
          ],
        ],
      },
    }
  },
})

registerCommand({
  name: 'new',
  description: 'Clear queue and start fresh conversation',
  emoji: '🆕',
  showInKeyboard: true,
  keyboardRow: 1,
  keyboardOrder: 2,
  handler: (_args, session, ctx) => {
    if (!session) return 'No active session.'
    const persistent = ctx.isPersistent(session.sender)
    ctx.abortCurrent(session.sender)
    ctx.clearQueue(session.sender)
    ctx.resetSession(session.sender)
    return persistent
      ? '🔄 Session reset. Conversation context and saved history cleared. Starting fresh.'
      : '🔄 Session reset. Queue cleared.'
  },
})

registerCommand({
  name: 'model',
  description: 'Show or change the AI model',
  emoji: '🔄',
  handler: async (args, session, ctx) => {
    const current = ctx.getModel()
    const available = ctx.getAvailableModels?.() || []

    if (!args) {
      // Show current model
      let reply = `🤖 <b>Current Model</b>: ${current}`

      if (available.length > 0) {
        reply += `\n\n<b>Available Models</b>:\n`
        reply += available.map((m) => `• ${m === current ? `<b>${m}</b> (current)` : m}`).join('\n')
        reply += `\n\nUse <code>/model &lt;name&gt;</code> to switch.`
      } else {
        reply += `\n\n<i>No model list available. Use provider/model format (e.g. anthropic/claude-sonnet-4-20250514)</i>`
      }

      return reply
    }

    // Change model
    const newModel = args.trim()

    // Validate model exists (if we have a list)
    if (available.length > 0 && !available.includes(newModel)) {
      return (
        `❌ Model "${newModel}" not found.\n\n` +
        `<b>Available Models</b>:\n` +
        available.map((m) => `• ${m === current ? `<b>${m}</b> (current)` : m}`).join('\n') +
        `\n\nUse <code>/model &lt;name&gt;</code> to switch.`
      )
    }

    if (!session) {
      ctx.setModel(newModel)
      return `✅ Model changed to: <b>${newModel}</b>\n\nNext message will use this model.`
    }

    // Restart session with new model, preserving context
    await ctx.restartSessionWithModel(session.sender, newModel)

    return (
      `✅ Model changed to: <b>${newModel}</b>\n\n` +
      `🔄 Session restarted with context preserved.\n` +
      `Next message will use the new model.`
    )
  },
})

registerCommand({
  name: 'whoami',
  description: 'Show your sender/chat ID',
  emoji: '👤',
  handler: (_args, session) => {
    if (!session) return 'No active session. Send a message first.'
    return (
      `👤 <b>Your info:</b>\n` +
      `- Chat ID: <code>${session.sender}</code>\n` +
      `- Display name: ${session.displayName}\n` +
      `- Adapter: ${session.adapter}`
    )
  },
})

registerCommand({
  name: 'ping',
  description: 'Health check — is the bot alive?',
  emoji: '🏓',
  handler: () => {
    return `🏓 Pong! Bot is alive.\n⏱ ${new Date().toISOString()}`
  },
})

// ── Shortcut commands (rewrite to agent prompts) ────────────

registerCommand({
  name: 'cal',
  description: 'Calendar — view or create events',
  emoji: '📅',
  showInKeyboard: true,
  keyboardRow: 0,
  keyboardOrder: 0,
  handler: (args) => {
    if (!args) {
      return PROMPT_PREFIX + "Show me today's calendar events and upcoming events for the next 7 days."
    }
    return PROMPT_PREFIX + `Calendar request: ${args}`
  },
})

registerCommand({
  name: 'crm',
  description: 'CRM — search or manage contacts',
  emoji: '👥',
  showInKeyboard: true,
  keyboardRow: 0,
  keyboardOrder: 1,
  handler: (args) => {
    if (!args) {
      return PROMPT_PREFIX + 'Show me upcoming CRM reminders and recent interactions.'
    }
    return PROMPT_PREFIX + `CRM request: ${args}`
  },
})

registerCommand({
  name: 'idea',
  description: 'Save a quick idea to daily memory',
  emoji: '💡',
  handler: (args) => {
    if (!args) {
      return '💡 Usage: <code>/idea Your brilliant idea here</code>'
    }
    return PROMPT_PREFIX + `Save this idea to daily memory: ${args}`
  },
})

registerCommand({
  name: 'brain',
  description: 'Start a brainstorming session',
  emoji: '🧠',
  handler: (args) => {
    if (!args) {
      return '🧠 Usage: <code>/brain Topic to brainstorm</code>'
    }
    return PROMPT_PREFIX + `Let's brainstorm about: ${args}`
  },
})

registerCommand({
  name: 'time',
  description: 'Time tracking — log or view hours',
  emoji: '⏱',
  showInKeyboard: true,
  keyboardRow: 0,
  keyboardOrder: 2,
  handler: (args) => {
    if (!args) {
      return PROMPT_PREFIX + "Show me today's time tracking report and this week's summary."
    }
    return PROMPT_PREFIX + `Time tracking request: ${args}`
  },
})

// ── Instant commands (no LLM) ───────────────────────────────

// To add custom commands (e.g. /dev, /deploy), use registerCommand() from your own extension:
//
// import { registerCommand } from "pi-channels/src/bridge/commands.ts";
// registerCommand({
//   name: "dev",
//   description: "List running dev services",
//   emoji: "🖥",
//   handler: () => { /* your logic */ },
// });

registerCommand({
  name: 'menu',
  description: 'Show or hide the quick action keyboard',
  emoji: '📋',
  handler: (_args, session) => {
    const sender = session?.sender || 'unknown'

    if (_args === 'off' || menuActive.has(sender)) {
      menuActive.delete(sender)
      return {
        text: '⌨️ Keyboard hidden. Type /menu to show it again.',
        markup: { remove_keyboard: true as const },
      }
    }

    menuActive.add(sender)
    return {
      text: '📋 Quick actions keyboard activated!',
      markup: getKeyboardLayout(),
    }
  },
})
