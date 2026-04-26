/**
 * Channel Bridge Entry Point
 *
 * Wires together:
 * - Telegram adapter (built-in)
 * - ChannelBridge for message routing
 * - Starts polling for incoming messages
 *
 * Usage:
 *   import { startTelegramBridge } from "./channel-bridge/index.js";
 *
 *   const bridge = await startTelegramBridge({
 *     provider: "anthropic",
 *     modelId: "claude-sonnet-4-5-20250929",
 *     token: process.env.TELEGRAM_BOT_TOKEN,
 *     allowedChatIds: process.env.TELEGRAM_ALLOWED_CHAT_IDS?.split(","),
 *     authStorage,
 *     resourceLoader,
 *   });
 */

import { ChannelBridge } from './bridge'
// Import the built-in Telegram adapter
import { createTelegramAdapter } from './telegram'
import type { AdapterConfig } from './types'
import { log, PATHS } from '../options'
import { AuthStorage } from '@mariozechner/pi-coding-agent'
import type { ResourceLoader } from '@mariozechner/pi-coding-agent'
import { createResourceLoader } from '../resource-loader'

/**
 * Configuration for starting the Telegram bridge.
 */
export interface TelegramBridgeConfig {
  /** Provider name (e.g., "anthropic") */
  provider: string
  /** Model ID (e.g., "claude-sonnet-4-5-20250929") */
  modelId: string
  /** Telegram bot token */
  token: string
  /** Allowed chat IDs (whitelist for security) */
  allowedChatIds?: string[]
  /** Maximum concurrent message processing (default: 2) */
  maxConcurrent?: number
  /** Enable typing indicators (default: true) */
  typingIndicators?: boolean
  /**
   * Stream partial responses via Telegram Bot API 9.3+ sendMessageDraft (default: true).
   * Degrades gracefully — bots on older API versions simply deliver a single final message.
   */
  streamingDrafts?: boolean
  /**
   * Minimum interval between draft token updates in milliseconds (default: 500).
   * Lower values produce smoother streaming at the cost of more API calls.
   */
  streamingIntervalMs?: number
  /** Auth storage instance */
  authStorage: AuthStorage
  /** Resource loader instance */
  resourceLoader: ResourceLoader
}

/**
 * Start the Telegram channel bridge.
 *
 * Creates the bridge, wires up the Telegram adapter, and starts polling.
 * The bridge shares sessions with the web UI via `~/.pi/agent/sessions/`.
 */
export async function startTelegramBridge(config: TelegramBridgeConfig): Promise<ChannelBridge> {
  log.info(`Starting Telegram bridge for ${config.provider}/${config.modelId}`)

  const bridge = new ChannelBridge({
    provider: config.provider,
    modelId: config.modelId,
    resourceLoader: config.resourceLoader,
    authStorage: config.authStorage,
    maxConcurrent: config.maxConcurrent ?? 2,
    typingIndicators: config.typingIndicators ?? true,
    streamingDrafts: config.streamingDrafts ?? true,
    streamingIntervalMs: config.streamingIntervalMs ?? 500,
  })

  // Create Telegram adapter configuration
  const telegramConfig: AdapterConfig = {
    type: 'telegram',
    botToken: config.token,
    parseMode: 'HTML',
    polling: true,
    pollingTimeout: 30,
    allowedChatIds: config.allowedChatIds,
  }

  // Create and register the Telegram adapter
  const telegramAdapter = createTelegramAdapter(telegramConfig)
  bridge.registerAdapter('telegram', telegramAdapter)

  // Start the bridge (starts polling)
  await bridge.start()

  log.info(`Telegram bridge started. Listening for messages.`)
  log.info(`Allowed chat IDs: ${config.allowedChatIds?.join(', ') || 'none (all)'}`)

  return bridge
}

/**
 * Create a default auth storage for the bridge.
 * Uses the same path as the main server.
 */
export function createAuthStorage(): AuthStorage {
  return AuthStorage.create(`${PATHS.piAgentDir}/auth.json`)
}

/**
 * Create a default resource loader for the bridge.
 */
export async function createBridgeResourceLoader(): Promise<ResourceLoader> {
  return createResourceLoader()
}

/**
 * Graceful shutdown handler.
 */
export async function shutdownBridge(bridge: ChannelBridge): Promise<void> {
  log.info('Shutting down Telegram bridge...')

  try {
    await bridge.stop()
    log.info('Telegram bridge stopped.')
  } catch (err: any) {
    log.error('Error stopping Telegram bridge:', err.message)
  }
}
