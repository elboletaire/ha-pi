/**
 * Typing indicator refresh loop.
 *
 * For adapters that don't have native typing support or need continuous updates,
 * this provides a polling-based typing indicator refresh mechanism.
 */

import type { ChannelAdapter } from './types'
import { log } from '../options'

/**
 * Configuration for the typing indicator loop.
 */
export interface TypingConfig {
  /** Adapter to send typing to */
  adapter: ChannelAdapter
  /** Recipient (chat ID, user ID, etc.) */
  recipient: string
  /** Interval in milliseconds (default: 3000) */
  intervalMs?: number
}

/**
 * Start a typing indicator refresh loop.
 *
 * Sends a typing indicator at regular intervals until the returned cleanup
 * function is called. The loop runs indefinitely — callers are responsible
 * for always calling stop() (e.g. in a finally block).
 *
 * Returns a cleanup function that stops the loop.
 */
export function startTypingLoop(config: TypingConfig): () => void {
  const { adapter, recipient, intervalMs = 3000 } = config

  let stopped = false

  const sendTyping = async () => {
    if (stopped) return

    try {
      if (adapter.sendTyping) {
        await adapter.sendTyping(recipient)
      }
    } catch (err: any) {
      log.error(`Failed to send typing indicator:`, err.message)
    }

    if (!stopped) {
      setTimeout(sendTyping, intervalMs)
    }
  }

  // Start the loop
  sendTyping()

  // Return cleanup function
  return () => {
    stopped = true
    log.debug(`Typing loop cleanup called`)
  }
}
