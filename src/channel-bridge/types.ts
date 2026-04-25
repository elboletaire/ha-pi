/**
 * Channel bridge types.
 *
 * These types define the interface for chat platform adapters.
 */

// Re-export types needed for the Telegram adapter (local implementation)
export type {
  ChannelAdapter,
  ChannelMessage,
  AdapterDirection,
  AdapterConfig,
  OnIncomingMessage,
  IncomingMessage,
  IncomingAttachment,
  SenderSession,
  QueuedPrompt,
  RunResult,
  ModelHealth,
  CommandResult,
  TelegramMarkup,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  ReplyKeyboardButton,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
  BridgeConfig,
  ChannelConfig,
} from '../../pi-channels/src/types.js'

// Re-export the types directly to avoid external dependency references
export type {
  ChannelAdapter as IChannelAdapter,
  IncomingMessage as IIncomingMessage,
  AdapterDirection,
} from '../../pi-channels/src/types.js'
