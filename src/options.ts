import { readFileSync, existsSync } from 'fs'

export interface TelegramConfig {
  enabled: boolean
  botToken: string
  allowedChatIds: string[] // Empty array means all chats allowed
}

export interface AddOnOptions {
  provider: string
  model: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  telegramConfig?: TelegramConfig
}

// Path constants — overridable via env vars for local dev / testing
export const PATHS = {
  piAgentDir: process.env.PI_CODING_AGENT_DIR ?? '/data/pi-agent',
  workspace: process.env.HA_PI_WORKSPACE ?? '/data/workspace',
  bundledSkills: process.env.HA_PI_SKILLS_DIR ?? '/app/skills',
  baseAgentsMd: process.env.HA_PI_BASE_AGENTS ?? '/app/base-agents.md',
}

/**
 * Parses CLI args passed by run.sh.
 * run.sh reads /data/options.json via bashio and passes values as CLI flags.
 */
export function parseServerArgs(): AddOnOptions {
  const args = process.argv.slice(2)
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag)
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback
  }

  const logLevel = get('--log-level', 'info')
  const provider = get('--provider', 'anthropic')
  const model = get('--model', 'claude-sonnet-4-5-20250929')

  // Parse Telegram configuration
  const telegramEnabled = get('--telegram-enabled', 'false') === 'true'
  const telegramToken = get('--telegram-bot-token', '')
  const telegramChatIdsRaw = get('--telegram-allowed-chat-ids', '')

  let telegramConfig: TelegramConfig | undefined = undefined

  if (telegramEnabled) {
    if (!telegramToken) {
      log.warn('Telegram enabled but no bot token provided. Telegram bridge will not start.')
    } else {
      const allowedChatIds = telegramChatIdsRaw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)

      telegramConfig = {
        enabled: true,
        botToken: telegramToken,
        allowedChatIds,
      }
    }
  }

  return {
    provider,
    model,
    logLevel: (['debug', 'info', 'warn', 'error'].includes(logLevel) ? logLevel : 'info') as AddOnOptions['logLevel'],
    telegramConfig,
  }
}

/**
 * Simple logger that respects the configured log level.
 */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
let currentLevel: number = LEVELS.info

export function setLogLevel(level: AddOnOptions['logLevel']) {
  currentLevel = LEVELS[level]
}

export const log = {
  debug: (...args: unknown[]) => currentLevel <= LEVELS.debug && console.debug('[pi-agent]', ...args),
  info: (...args: unknown[]) => currentLevel <= LEVELS.info && console.info('[pi-agent]', ...args),
  warn: (...args: unknown[]) => currentLevel <= LEVELS.warn && console.warn('[pi-agent]', ...args),
  error: (...args: unknown[]) => currentLevel <= LEVELS.error && console.error('[pi-agent]', ...args),
}
