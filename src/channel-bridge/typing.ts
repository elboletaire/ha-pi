/**
 * Typing indicator refresh loop.
 *
 * For adapters that don't have native typing support or need continuous updates,
 * this provides a polling-based typing indicator refresh mechanism.
 */

import type { ChannelAdapter } from "./types.js";
import { log } from "../options.js";

/**
 * Configuration for the typing indicator loop.
 */
export interface TypingConfig {
  /** Adapter to send typing to */
  adapter: ChannelAdapter;
  /** Recipient (chat ID, user ID, etc.) */
  recipient: string;
  /** Interval in milliseconds (default: 3000) */
  intervalMs?: number;
  /** Maximum number of refreshes before stopping (default: 10) */
  maxRefreshes?: number;
}

/**
 * Start a typing indicator refresh loop.
 * 
 * Sends a typing indicator at regular intervals. Useful for long-running
 * operations where the user needs feedback that something is happening.
 *
 * Returns a cleanup function that stops the loop.
 */
export function startTypingLoop(config: TypingConfig): () => void {
  const { adapter, recipient, intervalMs = 3000, maxRefreshes = 10 } = config;
  
  let refreshCount = 0;
  let stopped = false;
  
  const sendTyping = async () => {
    if (stopped) return;
    
    refreshCount++;
    
    if (refreshCount > maxRefreshes) {
      log.debug(`Typing loop stopped after ${maxRefreshes} refreshes`);
      return;
    }
    
    try {
      if (adapter.sendTyping) {
        await adapter.sendTyping(recipient);
      }
    } catch (err: any) {
      log.error(`Failed to send typing indicator:`, err.message);
    }
    
    if (!stopped) {
      setTimeout(sendTyping, intervalMs);
    }
  };
  
  // Start the loop
  sendTyping();
  
  // Return cleanup function
  return () => {
    stopped = true;
    log.debug(`Typing loop cleanup called`);
  };
}
