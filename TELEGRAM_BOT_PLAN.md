# Telegram Bot for ha-pi - Implementation Plan

## Goal

Create a Telegram bot that mirrors the ha-pi web UI, sharing the same session storage.
Designed to be extensible to other providers (Discord, Slack, etc.) from the start.

## Approach

- New `src/channel-bridge/` module — provider-agnostic bridge wired directly to the pi SDK
- Telegram adapter built in-house (no subprocess bridge)
- Share sessions: `~/.pi/agent/sessions/<encoded-cwd>/`
- Session IDs: 8-char UUID prefix (e.g., `a1b2c3d4`)

## Architecture

```
Telegram ──▶  TelegramAdapter  (built-in adapter)
Discord  ──▶  DiscordAdapter   (future — implement ChannelAdapter interface)
              │
              ▼
         ChannelBridge         (src/channel-bridge/bridge.ts)
         per-sender FIFO queue
         in-process, no subprocesses
              │
              ▼
         AgentManager          (existing ha-pi SDK)
         one instance per sender, createAgentSession / subscribe / prompt
```

## Required Commands

- `/new` - Create new session, clear history
- `/session <ID>` - Switch to specific session
- `/sessions` - List all sessions (ID, name, message count, last activity)

## Optional Commands

- `/delete <ID>` - Delete session
- `/status` - Show session status
- `/model [name]` - Show/change model
- `/abort` - Cancel current generation

## Module Structure

```
src/channel-bridge/
├── index.ts            # Entry point — instantiates adapters + bridge, starts polling
├── bridge.ts           # ChannelBridge — per-sender AgentManager, FIFO queue, concurrency
├── commands.ts         # Bot command handlers (/new, /sessions, /session, /abort, etc.)
├── typing.ts           # Typing indicator refresh loop (adapter-agnostic)
└── types.ts            # Type definitions for adapters and bridge
```

> The Telegram adapter is built in-house within the `pi-channels/` directory.

## Implementation Notes

- **One `AgentManager` per sender** — each Telegram chat (or Discord user) gets its own
  `AgentSession`, stored in the shared sessions directory alongside web UI sessions
- **FIFO queue per sender** — messages serialized per sender; concurrent senders up to a
  configurable limit
- **In-process streaming** — `session.subscribe()` emits events per token; batch into Telegram
  draft updates (streaming drafts require Bot API 9.3+, graceful fallback to single reply)
- **Commands handled in bridge** — `/abort`, `/new`, `/status`, etc. resolved before reaching
  the AgentManager using the same pattern as pi-channels' `commands.ts`
- **Adding a new provider** — implement the `ChannelAdapter` interface, register it with the
  bridge; no changes to AgentManager or session management needed

## Configuration

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ALLOWED_CHAT_IDS=987654321,123456789  # Required for security
```

## Security

- Whitelist `TELEGRAM_ALLOWED_CHAT_IDS` (don't allow all)
- Store token in env vars only
- Isolate sessions per sender (each chat ID gets its own AgentSession)

## Phases

1. **Foundation**: ChannelBridge skeleton, TelegramAdapter wired, `/new` command, basic text
2. **Session mgmt**: `/sessions`, `/session <ID>`, switching, per-sender AgentManager lifecycle
3. **Messaging**: Streaming drafts (Bot API 9.3+), fallback single reply, typing indicators
4. **Extras**: File/photo/document handling (reused from TelegramAdapter), `/delete`, `/model`
5. **Polish**: Error handling, tests, docs, Discord adapter stub as proof of extensibility

## Testing

- Unit tests for ChannelBridge (queue behaviour, concurrency, command routing)
- Unit tests for command handlers
- Integration tests for end-to-end Telegram flows

## Dependencies

- Built-in Telegram adapter implementation (no external dependencies)
- No additional npm packages required for Telegram (adapter uses the raw Bot API via fetch)
