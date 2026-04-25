# Channel Bridge

Provider-agnostic bridge for integrating chat platforms with the pi coding agent.

## Overview

The channel bridge allows the pi agent to receive and respond to messages from various chat platforms (Telegram, Discord, Slack, etc.) while sharing the same session storage as the web UI.

## Architecture

```
Platform (Telegram/Discord/etc.)
        │
        ▼
   Adapter (platform-specific)
        │
        ▼
  ChannelBridge
  - Per-sender queues
  - Command routing
  - Concurrency control
        │
        ▼
   AgentManager
   (one per sender)
        │
        ▼
  pi-coding-agent SDK
```

## Module Structure

- `index.ts` - Entry point for starting bridges
- `bridge.ts` - Core ChannelBridge class
- `commands.ts` - Bot command handlers (`/new`, `/sessions`, etc.)
- `typing.ts` - Typing indicator management
- `types.ts` - Type definitions

## Using the Bridge

### Starting a Telegram Bridge

```typescript
import { startTelegramBridge, createAuthStorage, createBridgeResourceLoader } from "./channel-bridge/index.js";

const authStorage = createAuthStorage();
const resourceLoader = await createBridgeResourceLoader();

const bridge = await startTelegramBridge({
  provider: "anthropic",
  modelId: "claude-sonnet-4-5-20250929",
  token: process.env.TELEGRAM_BOT_TOKEN,
  allowedChatIds: process.env.TELEGRAM_ALLOWED_CHAT_IDS?.split(","),
  authStorage,
  resourceLoader,
  maxConcurrent: 2,
  typingIndicators: true,
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await shutdownBridge(bridge);
  process.exit(0);
});
```

## Adding a New Platform

To add support for a new platform (e.g., Discord):

1. Create a new adapter file in `src/channel-bridge/adapters/` implementing the `ChannelAdapter` interface
2. Create a start function similar to `startTelegramBridge`
3. Register the adapter with the bridge

Example (pseudo-code):

Example (pseudo-code):

```typescript
export function createDiscordAdapter(config: AdapterConfig): ChannelAdapter {
  // Implement Discord-specific logic
  return {
    direction: "bidirectional",
    async send(message) { /* Send to Discord */ },
    async start(onMessage) { /* Start polling Discord */ },
    async stop() { /* Stop polling */ },
  };
}

export async function startDiscordBridge(config: DiscordBridgeConfig): Promise<ChannelBridge> {
  const bridge = new ChannelBridge({ /* ... */ });
  const discordAdapter = createDiscordAdapter(config);
  bridge.registerAdapter(discordAdapter);
  await bridge.start();
  return bridge;
}
```

## Commands

The following commands are supported:

| Command | Description |
|---------|-------------|
| `/new` | Create a new session, clear history |
| `/sessions` | List all sessions |
| `/session <ID>` | Switch to a specific session |
| `/delete <ID>` | Delete a session |
| `/status` | Show current session status |
| `/model [name]` | Show/change model |
| `/abort` | Cancel current generation |

## Session Storage

Sessions are stored in `~/.pi/agent/sessions/<encoded-cwd>/` and are shared across all channels. This means:

- A session created in the web UI is accessible from Telegram
- A session created from Telegram is accessible from the web UI
- Each sender (chat/user) gets their own session namespace

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token | Yes (for Telegram) |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Comma-separated list of allowed chat IDs | Recommended |

### Security

- Whitelist allowed chat IDs to prevent unauthorized access
- Store bot tokens in environment variables only
- Each sender (chat/user) gets isolated session state

## Extensibility

The bridge is designed to be easily extended:

1. **New platforms**: Implement `ChannelAdapter` and create a start function
2. **New commands**: Add handlers in `commands.ts` and extend `parseCommand`
3. **Custom behavior**: Override bridge methods or create custom adapters
