# pi-channels (Local Copy)

Two-way channel extension for [pi](https://github.com/badlogic/pi-mono). Routes messages between agents and external services like Telegram, webhooks, or custom adapters.

This is a local copy of the pi-channels package used by ha-pi for Telegram bot support.

Includes a **chat bridge** that turns any bidirectional adapter into a full agent chat interface — incoming messages are routed to the agent, and responses are sent back automatically. Supports **persistent sessions** (via RPC mode) for full conversation context across messages, or stateless mode for isolated prompts.

## Install

```bash
# From GitHub
pi install git:github.com/gtrias/pi-channels

# Or from a local checkout
pi install /path/to/pi-channels
```

## Quick start

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather) and get the bot token
2. Add your chat ID to the allowed list (send `/start` to [@userinfobot](https://t.me/userinfobot) to find it)
3. Configure pi-channels in `~/.pi/agent/settings.json`:

```json
{
  "pi-channels": {
    "adapters": {
      "telegram": {
        "type": "telegram",
        "botToken": "env:TELEGRAM_BOT_TOKEN",
        "polling": true
      }
    },
    "bridge": {
      "enabled": true
    }
  }
}
```

4. Set the environment variable: `export TELEGRAM_BOT_TOKEN="1234567890:ABCDEFghijklMNOpqrSTUvwxYZ"`
5. Start pi: `pi --chat-bridge`
6. Send a message to your bot — it's now a full AI assistant!

## How it works

```
┌──────────────┐     channel:send      ┌──────────────┐      Telegram API     ┌──────────┐
│  Extensions  │ ───────────────────▶  │  pi-channels │ ───────────────────▶  │ Telegram │
│  (cron, etc) │                       │   registry   │                       │   user   │
└──────────────┘                       │   + routes   │                       └──────────┘
                                       └──────┬───────┘                            │
                                              │                                    │
                                              │ channel:receive                    │
                                              ▼                                    │
                                       ┌──────────────┐     pi --mode rpc    ┌────┴─────┐
                                       │  Chat Bridge │ ◀──────────────────  │ incoming │
                                       │  (per-sender │ ──────────────────▶  │ messages │
                                       │   sessions)  │     reply            └──────────┘
                                       └──────────────┘
```

1. Extensions emit `channel:send` events (or pi-cron emits `cron:job_complete`)
2. pi-channels resolves the adapter + recipient (directly or via a named route)
3. Delivers the message via the matching adapter
4. No adapter found? Returns `{ ok: false }` (silent unless caller checks callback)

When the **chat bridge** is enabled:
1. Incoming messages (e.g. from Telegram polling) hit `channel:receive`
2. The bridge serializes per sender (one prompt at a time, FIFO queue)
3. **Persistent mode** (default): each sender gets a long-lived `pi --mode rpc` subprocess with conversation memory
4. **Stateless mode**: each prompt spawns an isolated `pi -p --no-session` subprocess (no memory)
5. The response is sent back via the same adapter to the same chat
6. Typing indicators and streaming drafts keep the user informed during processing

## Configuration

Add `"pi-channels"` to your pi settings file (`~/.pi/agent/settings.json` or `.pi/settings.json`):

```json
{
  "pi-channels": {
    "adapters": {
      "telegram": {
        "type": "telegram",
        "botToken": "env:TELEGRAM_BOT_TOKEN",
        "polling": true
      },
      "alerts": {
        "type": "webhook",
        "headers": { "Authorization": "env:WEBHOOK_SECRET" }
      }
    },
    "routes": {
      "ops": { "adapter": "telegram", "recipient": "<YOUR_GROUP_CHAT_ID>" },
      "cron": { "adapter": "telegram", "recipient": "<YOUR_PERSONAL_CHAT_ID>" }
    },
    "bridge": {
      "enabled": false,
      "sessionMode": "persistent",
      "sessionRules": [
        { "match": "telegram:-100*", "mode": "stateless" },
        { "match": "webhook:*", "mode": "stateless" }
      ],
      "idleTimeoutMinutes": 30,
      "maxQueuePerSender": 5,
      "timeoutMs": 300000,
      "maxConcurrent": 2,
      "typingIndicators": true,
      "commands": true,
      "streamingDrafts": true,
      "streamingIntervalMs": 500,
      "model": null,
      "extensions": []
    }
  }
}
```

> **Tip:** Use `"env:VAR_NAME"` syntax to reference environment variables — keeps secrets out of config files.

Project settings (`.pi/settings.json`) override global settings (`~/.pi/agent/settings.json`).

### Routes

Routes map friendly names to adapter + recipient pairs. This lets other extensions (like pi-cron) use logical names instead of raw chat IDs:

```json
{
  "routes": {
    "ops": { "adapter": "telegram", "recipient": "<YOUR_GROUP_CHAT_ID>" },
    "personal": { "adapter": "telegram", "recipient": "<YOUR_CHAT_ID>" }
  }
}
```

When pi-cron fires a job with `channel: "ops"`, the route resolves it to the configured Telegram group.

### Bridge configuration

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Enable on startup. Also via `--chat-bridge` flag or `/chat-bridge on`. |
| `sessionMode` | `"persistent"` | Default session mode. `"persistent"` = RPC subprocess with conversation memory. `"stateless"` = isolated subprocess per message. |
| `sessionRules` | `[]` | Per-sender overrides. Array of `{ match, mode }` rules. Patterns match against `adapter:senderId` keys using glob syntax (`*`, `?`). First match wins. |
| `idleTimeoutMinutes` | `30` | Idle timeout for persistent sessions. After inactivity, the subprocess is killed. Context is saved and restored on the next message. |
| `maxQueuePerSender` | `5` | Max pending messages per sender before rejecting new ones. |
| `timeoutMs` | `300000` | Per-prompt timeout in ms (default: 5 min). |
| `maxConcurrent` | `2` | Max senders processed in parallel. |
| `model` | `null` | Model override for subprocess (e.g. `"anthropic/claude-sonnet-4-20250514"`). `null` = use pi's default. |
| `typingIndicators` | `true` | Send typing indicators while processing. |
| `commands` | `true` | Handle bot commands (`/start`, `/help`, `/abort`, `/status`, `/new`, `/model`). |
| `streamingDrafts` | `true` | Stream partial responses via Telegram's `sendMessageDraft` API (Bot API 9.3+). Shows text as it's generated. Only works in private chats with persistent sessions. |
| `streamingIntervalMs` | `500` | Minimum interval between draft updates in ms. Lower = smoother but more API calls. |
| `extensions` | `[]` | Extension paths to load in bridge subprocesses. Subprocess runs with `--no-extensions` by default to avoid conflicts (e.g. port collisions). List only what the bridge agent needs. |

## Chat bridge

The chat bridge turns pi into a conversational assistant accessible via Telegram (or any bidirectional adapter).

### Enabling

Three ways to enable:

```bash
# 1. CLI flag
pi --chat-bridge

# 2. Runtime command (while pi is running)
/chat-bridge on

# 3. Settings (always on)
{ "bridge": { "enabled": true } }
```

### How it works

- Messages are serialized **per sender** — each sender has their own FIFO queue
- Only one prompt runs at a time per sender (no interleaving)
- Multiple senders can run concurrently (up to `maxConcurrent`)
- If a sender's queue is full, new messages are rejected with a warning
- Typing indicators refresh every 4 seconds (Telegram typing expires after ~5s)
- Streaming drafts show partial text as it's generated (configurable interval)

### Session modes

**Persistent** (`"persistent"`, default) — each sender gets a long-lived `pi --mode rpc` subprocess:
- Conversation context carries over — the agent remembers previous messages
- Sessions auto-restart if the subprocess crashes
- Idle sessions are killed after `idleTimeoutMinutes` — context is saved to disk and restored on next message
- `/new` command clears conversation context and starts fresh
- Image attachments are sent as base64 via the RPC protocol
- Document attachments are inlined as text into the prompt
- Best for: **private chats, conversational interactions**

**Stateless** (`"stateless"`) — each message spawns an isolated `pi -p --no-session` subprocess:
- No memory between messages — each prompt is independent
- Lower resource usage (no long-running processes)
- Best for: **group chats, ops channels, webhook triggers, one-shot commands**

### Session rules

Use `sessionRules` to control mode per sender. Patterns match against the sender key (`adapter:senderId`) using glob syntax (`*` = any chars, `?` = single char):

```json
{
  "bridge": {
    "sessionMode": "persistent",
    "sessionRules": [
      { "match": "telegram:-100*", "mode": "stateless" },
      { "match": "telegram:<YOUR_CHAT_ID>", "mode": "persistent" },
      { "match": "webhook:*", "mode": "stateless" }
    ]
  }
}
```

> **Telegram ID format:** Group chat IDs start with `-100` (e.g. `-1001234567890`), so `telegram:-100*` matches all groups. Private chats are positive numbers (e.g. `telegram:987654321`).

First matching rule wins. Unmatched senders fall back to `sessionMode`.

### Context persistence

When a persistent session is killed due to idle timeout:

1. Conversation messages are retrieved from the RPC subprocess
2. Messages are saved to `~/.pi/agent/bridge-context/<sender>.json`
3. On the next message, saved context is replayed into the new subprocess
4. The agent resumes naturally from where the conversation left off

This means your Telegram conversations survive idle periods without losing context. Use `/new` to explicitly start fresh.

### Bot commands

When `commands` is enabled, messages starting with `/` are handled directly without routing to the agent:

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with quick action grid |
| `/help` | List all available commands |
| `/abort` | Cancel the currently running prompt |
| `/status` | Show session info (mode, model, queue, uptime, context status) |
| `/new` | Reset session — clears queue, conversation context, and saved history |
| `/model` | Show current model or switch (`/model anthropic/claude-sonnet-4-20250514`) |
| `/model <name>` | Change model — session restarts with context preserved |
| `/whoami` | Show your chat ID, display name, and adapter |
| `/ping` | Health check — is the bot alive? |
| `/menu` | Toggle quick action reply keyboard (tap again or `/menu off` to hide) |

**Shortcut commands** — routed as prompts to the agent:

| Command | Description |
|---------|-------------|
| `/cal` | Calendar — view today's events and upcoming 7 days |
| `/cal <request>` | Calendar — custom request (e.g. `/cal create meeting tomorrow 3pm`) |
| `/crm` | CRM — show upcoming reminders and recent interactions |
| `/crm <request>` | CRM — custom request (e.g. `/crm find John`) |
| `/time` | Time tracking — today's report and weekly summary |
| `/time <request>` | Time tracking — custom request (e.g. `/time log 2h bugfix`) |
| `/idea <text>` | Save a quick idea to daily memory |
| `/brain <topic>` | Start a brainstorming session |

> Shortcut commands work with any pi extensions you have loaded — they simply construct natural-language prompts that get sent to the agent.

Commands work in both private and group chats. In groups, `/command@botname` format is supported.

> **Custom commands**: Register your own via `registerCommand()` from `commands.ts`. See [the source](src/bridge/commands.ts) for the pattern.

### Bridge events

| Event | When | Payload |
|-------|------|---------|
| `bridge:enqueue` | Message queued | `{ id, adapter, sender, queueDepth }` |
| `bridge:start` | Prompt processing starts | `{ id, adapter, sender, text, persistent }` |
| `bridge:complete` | Prompt done | `{ id, adapter, sender, ok, durationMs, persistent }` |

## Built-in adapters

### Telegram

Full-featured bidirectional adapter with rich media support.

```json
{
  "type": "telegram",
  "botToken": "env:TELEGRAM_BOT_TOKEN",
  "polling": true,
  "parseMode": "Markdown",
  "pollingTimeout": 30,
  "allowedChatIds": ["<YOUR_CHAT_ID>"],
  "voiceTranscription": {
    "host": "localhost",
    "port": 10300,
    "language": "en"
  }
}
```

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | ✅ | Telegram Bot API token. Use `"env:VAR"` syntax for security. |
| `polling` | No | Enable long polling for incoming messages (default: `false`). Required for bridge. |
| `parseMode` | No | Message formatting: `"Markdown"` or `"HTML"` (default: plain text). |
| `pollingTimeout` | No | Long polling timeout in seconds (default: `30`). |
| `allowedChatIds` | No | Whitelist of chat IDs that can interact with the bot. If omitted, all chats are allowed. **Recommended for security.** |
| `voiceTranscription` | No | Wyoming STT server connection for voice-to-text. See [Voice transcription](#voice-transcription-config). |

**Capabilities:**

| Feature | Details |
|---------|---------|
| **Text messages** | Full bidirectional — send and receive |
| **Photos** | Downloaded and passed as image attachments (up to 10MB) |
| **Text documents** | Downloaded, content inlined into prompt (up to 1MB). Supports: `.md`, `.txt`, `.json`, `.csv`, `.py`, `.ts`, `.sql`, and [50+ extensions](src/adapters/telegram.ts) |
| **PDFs** | Text extracted via `pdftotext` with raw fallback (up to 10MB) |
| **Voice messages** | Transcribed via Wyoming STT — ffmpeg converts OGA→PCM, then sent to STT server (up to 20MB) |
| **File sending** | `sendFile()` auto-picks `sendPhoto` for images, `sendDocument` for others |
| **Streaming drafts** | Real-time response streaming via `sendMessageDraft` (Bot API 9.3+) |
| **Typing indicators** | Auto-refreshed every 4 seconds while processing |
| **Markdown → HTML** | Converts Markdown to Telegram HTML: bold, italic, code blocks, inline code, headers, links, tables |
| **Message splitting** | Auto-splits messages over 4096 chars at newline boundaries |
| **Callback queries** | Inline keyboard button taps routed as text messages |
| **Command sync** | Bot menu auto-synced with registered commands via `setMyCommands` |

### Webhook

Simple outgoing-only adapter that POSTs JSON to a URL.

```json
{
  "type": "webhook",
  "method": "POST",
  "headers": { "Authorization": "Bearer <your-secret>" }
}
```

- Recipient = webhook URL (passed per-message or via route)
- POSTs JSON: `{ text, source, metadata, timestamp }`
- Custom headers supported (e.g. auth tokens)
- Method configurable (default: `POST`)

## Custom adapters

Other extensions can register adapters at runtime via the event bus:

```typescript
// Outgoing-only adapter
pi.events.emit("channel:register", {
  name: "email",
  adapter: {
    direction: "outgoing",
    async send(message) {
      await sendEmail({
        to: message.recipient,
        subject: message.source || "pi notification",
        body: message.text,
      });
    },
  },
});

// Then anyone can send via it
pi.events.emit("channel:send", {
  adapter: "email",
  recipient: "user@example.com",
  text: "Deploy complete!",
  source: "ci/cd",
});
```

Bidirectional adapters can also receive messages and support typing + file sending:

```typescript
pi.events.emit("channel:register", {
  name: "discord",
  adapter: {
    direction: "bidirectional",
    async send(message) { /* send to Discord channel */ },
    async start(onMessage) { /* listen for incoming messages */ },
    async stop() { /* cleanup connections */ },
    async sendTyping(recipient) { /* show typing indicator */ },
    async sendFile(recipient, filePath, caption) { /* upload file */ },
    async sendDraft(recipient, draftId, text) { /* streaming preview */ },
  },
});
```

## Event API

| Event | Direction | Payload |
|---|---|---|
| `channel:send` | → adapter | `{ adapter, recipient, text, source?, metadata?, markup?, callback? }` |
| `channel:receive` | ← adapter | `{ adapter, sender, text, attachments?, metadata? }` |
| `channel:register` | register | `{ name, adapter, callback? }` |
| `channel:remove` | register | `{ name, callback? }` |
| `channel:list` | query | `{ callback? }` |
| `channel:test` | → adapter | `{ adapter, recipient, callback? }` |

Also listens to `cron:job_complete` from pi-cron — automatically routes job output to the channel specified in the job's `channel` field.

## LLM tool

The `notify` tool lets the LLM send messages and files directly:

| Action | Description |
|--------|-------------|
| `list` | Show configured adapters and routes |
| `send` | Deliver a text message (requires: `adapter`, `text`) |
| `send_file` | Send a file/document with optional caption (requires: `adapter`, `file_path`) |
| `test` | Send a ping to verify adapter connectivity |

### File sending security

The `send_file` action validates paths against an allowlist to prevent data exfiltration:

**Allowed directories:** `$TMPDIR`, `~/Downloads`, `~/Documents`, `~/src`, `~/.pi`

**Blocked patterns:** `.env` files, `.git/` internals, `node_modules/`, SSH keys, GPG keys, AWS credentials, PEM/KEY files, `settings.json` (contains API keys)

## Pi commands

| Command | Description |
|---------|-------------|
| `/chat-bridge` | Show bridge status (sessions, queue, active prompts) |
| `/chat-bridge on` | Start the chat bridge |
| `/chat-bridge off` | Stop the chat bridge |

## File structure

```
src/
├── index.ts              # Extension entry — lifecycle, flag, command
├── types.ts              # All shared types — messages, adapters, bridge config, sessions
├── config.ts             # Settings loader — merges global + project config
├── registry.ts           # Adapter registry — route resolution, send/sendFile dispatch
├── events.ts             # Event bus wiring — channel:*, bridge:*, cron integration
├── tool.ts               # LLM tool (notify) with file security validation
├── logger.ts             # Structured logging via event bus
├── adapters/
│   ├── telegram.ts       # Telegram Bot API — photos, docs, PDFs, voice, streaming, Markdown→HTML
│   ├── webhook.ts        # Generic webhook adapter (outgoing only)
│   ├── audio-convert.ts  # ffmpeg OGA/OGG → raw PCM conversion for STT
│   ├── wyoming-stt.ts    # Wyoming protocol client for speech-to-text (Vosk, etc.)
│   └── pdf-extract.ts    # PDF text extraction — pdftotext with raw BT/ET fallback
└── bridge/
    ├── bridge.ts         # Core bridge — per-sender queues, concurrency, streaming drafts, model management
    ├── commands.ts       # Bot command registry — built-in + shortcut + custom commands
    ├── rpc-runner.ts     # Persistent RPC sessions — context save/restore, idle timeout, crash recovery
    ├── runner.ts         # Stateless subprocess runner (pi -p --no-session)
    └── typing.ts         # Typing indicator manager (4s refresh cycle)
```

## Optional dependencies

Features degrade gracefully when dependencies are not available:

| Dependency | Used for | Install | Without it |
|------------|----------|---------|------------|
| `ffmpeg` | Voice → PCM conversion | `sudo apt install ffmpeg` | Voice messages are ignored |
| `pdftotext` | PDF text extraction (high quality) | `sudo apt install poppler-utils` | Falls back to basic raw text extraction |
| Wyoming STT server | Voice-to-text transcription | [Wyoming docs](https://github.com/rhasspy/wyoming) | Voice transcription returns an error |

### Voice transcription config

Configure the Wyoming STT connection in your Telegram adapter config:

```json
{
  "type": "telegram",
  "botToken": "...",
  "polling": true,
  "voiceTranscription": {
    "host": "localhost",
    "port": 10300,
    "language": "en"
  }
}
```

The `language` field is passed to the STT server. Common values: `en`, `es`, `de`, `fr`, `zh`, `ja`. Check your STT server's documentation for supported languages.

## License

MIT — see [LICENSE](LICENSE).
