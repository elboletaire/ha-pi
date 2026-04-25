# Changelog

## 0.5.0 — Telegram streaming and formatting fixes

### Features

- Telegram bot now streams responses in real time using Telegram Bot API 9.3+ `sendMessageDraft`
- Draft message shows live status feedback while the agent works: *Thinking...* during model reasoning, *Using bash...* / *Using curl...* (etc.) during tool execution, then streams the final response token by token before delivering the fully formatted message
- Token stream updates are throttled (default 500 ms) to avoid API rate limits; status changes (thinking, tool) are sent immediately
- Typing indicator automatically stops as soon as streaming begins
- New `streamingDrafts` (default: true) and `streamingIntervalMs` (default: 500) options on `TelegramBridgeConfig`; degrades gracefully on older Bot API versions

### Fixes

- Fixed Telegram messages rendering raw HTML tags (`<b>`, `<code>`, etc.) — `parseMode` was set to `'Markdown'` while the formatter produces HTML; changed to `'HTML'`
- Fixed typing indicator remaining stuck after an error — `stopTyping` was scoped inside `try` and unreachable from `finally`
- Fixed `[object Object]` appearing in responses when the pi SDK returns content as typed blocks — now filters on `type === 'text'` blocks only
- Fixed error messages being routed to the hardcoded `'telegram'` adapter instead of the actual sender's adapter
- Fixed model name not appearing in the message header when draft streaming was active (`finalizeDraft` was hardcoding `source: 'agent'`)
- Fixed inline code inside triple-backtick fences being incorrectly extracted as `<code>` spans and producing nested tags in the rendered output
- Fixed several TypeScript errors: `startTypingLoop` return type mismatch (`{ stop }` destructuring), `findLast` not available in ES2022 lib, `stopTyping` variable declared inside `try` but referenced in `finally`

## 0.4.3 — Telegram message formatting fixes

### Fixes

- Fixed "object Object" response bug where array content from pi SDK was not being flattened
- Fixed typing indicator stuck for minutes after errors by moving stop logic to finally block
- Fixed message headers to show current model name instead of generic "agent"
- Fixed HTML code tags displaying as raw text in /sessions and /start commands

## 0.4.2 — Mobile keyboard viewport fix

### Fixes

- Improved the mobile web UI so the chat input stays visible when the on-screen keyboard opens
- Added viewport-aware layout handling for the HA mobile app and other mobile browsers
- Scrolled the input into view on focus to reduce keyboard overlap issues

## 0.4.1 — Telegram bridge completion and logging

### Features

- Added `/start` and `/help` command responses with a Telegram-friendly welcome message
- Wired Telegram inline button callbacks for session navigation and quick actions
- Improved Telegram command suggestions by syncing the full command menu on startup
- Added allowlist rejection logging for unauthorized Telegram chats and callback queries

### Fixes

- Fixed Telegram argument passing in `run.sh` so bot token and allowed chat IDs are preserved correctly
- Fixed Telegram command handling so slash commands and inline button callbacks are parsed consistently
- Fixed session selection and deletion to work with Telegram callback payloads that use session IDs
- Routed Telegram sync and rejection messages through the add-on logger so log-level filtering applies

## 0.4.0 — Telegram bot integration

### Features

- Added full Telegram bot integration via channel bridge architecture
- Text message support for chat interactions via Telegram
- Voice message support with Wyoming STT transcription (Vosk)
- PDF document extraction and processing (up to 10MB)
- Photo and text document sharing support
- Typing indicators for better user experience
- Interactive commands and skill execution through Telegram
- Configurable allowed chat IDs for security
- New `telegram_enabled`, `telegram_bot_token`, and `telegram_allowed_chat_ids` options in add-on config
- Channel bridge architecture enabling multi-channel support (WebSocket + Telegram)
- Session management across channels with state synchronization via `~/.pi/agent/sessions/`
- Updated build workflow to include Telegram bot support
- Comprehensive documentation: TELEGRAM_SETUP.md, TELEGRAM_BOT_PLAN.md, TELEGRAM_CONFIGURATION.md, and channel-bridge docs

### Fixes

- Fixed GitHub Enterprise OAuth form to allow empty values, falling back to github.com when left blank as indicated by the "blank for github.com" hint

## 0.3.3 — Add configuration labels for agent instructions

- Added a friendly label and helper text for `agents_md_append` in the Home Assistant add-on configuration UI
- Added a translation file so the add-on form can present the field more clearly

## 0.3.2 — Session history polish and skill install guidance

- Session delete buttons in the history list now stay hidden until you hover a row, which makes the picker less visually noisy
- Added git to the runtime image so git-based skill installs work reliably inside the container
- Updated the README to point users at the chat-driven "find and install this skill" flow instead of the raw `pi install git:...` command

## 0.3.1 — Session history cleanup

- Added a delete button to the web session history list so old conversations can be removed
- Deleting the currently open session now starts a fresh empty session automatically so the chat stays usable

## 0.3.0 — Unified providers modal and auth migration

- Moved API keys into the web UI Providers modal so Anthropic, OpenAI, and Google credentials are managed in one place alongside OAuth logins
- Saved API keys now persist to `/data/pi-agent/auth.json`, and legacy add-on API key options are migrated automatically on startup
- Removed provider/model/API key settings from the add-on config, leaving only `log_level` and `agents_md_append`
- Made `agents_md_append` the explicit multiline add-on option for extra instructions
- Auth changes now retry agent startup automatically when the add-on had no model yet, so adding a key or completing OAuth can recover a failed startup without restart

## 0.2.4 — HA service-call workflow helpers

- Added `curl` and `python3` to the runtime image for direct Home Assistant API/service-call workflows
- Expanded the built-in agent instructions with a prioritized Home Assistant service-call pattern that prefers native targets and avoids trial-and-error
- Documented the preferred service-call workflow in the README and docs alongside the built-in agent instructions

## 0.2.3 — Session resume hydration + cursor polish

- Resuming a session from the web UI now restores the visible chat transcript from the selected session
- Added a `session_history` WebSocket payload so the chat view can hydrate after switching sessions or reloading the page
- The streaming cursor now disappears as soon as the model stops responding and the Send button is re-enabled

## 0.2.1 — Docker build fix

- Removed the unnecessary global pnpm install in the runtime image so CI builds no longer fail on a missing global bin directory

## 0.2.0 — Web model selector + dynamic availability

- Added a web model selector modal that only lists authenticated, available models
- Persisted model changes through pi settings so the active model survives restarts
- Added browser-safe model cycling shortcuts plus a header shortcut legend modal
- Model availability now refreshes after provider login/logout, while keeping the currently selected model

## 0.1.6 — OAuth login flows + provider status in UI

- New `LoginManager` drives all OAuth flows via the pi SDK's `authStorage.login()`
- GitHub Copilot device code flow: prominent code display, one-click copy,
  direct link to github.com/login/device, auto-closes on success
- Callback-server providers (Anthropic, Gemini CLI, OpenAI Codex, Antigravity):
  open-URL modal with manual code input fallback via `onManualCodeInput`
- Prompt dialog for interactive inputs during login (e.g. enterprise domain)
- ⚙️ Settings panel shows all OAuth providers with live connection status
- Auth status pushed to frontend on every WebSocket connect
- Shared `AuthStorage` instance across agent sessions and login manager
  so tokens written by login are immediately available to the agent

- `AgentManager.prompt()` was missing `await`, turning thrown errors into
  unhandled rejections that killed the process. Now errors propagate
  correctly to the WebSocket handler and are shown in the UI.
- Intercept TUI-only commands (`/login`, `/model`, `/settings`, etc.) before
  they reach the SDK and return a clear message explaining they don't work
  in the web UI. `/login` includes a pointer to add-on options.
- Server no longer crashes on agent init failure (e.g. missing API key);
  the UI still loads and shows the error message on connect.

- Frontend now builds WebSocket URL relative to `location.pathname` instead
  of hardcoding `/ws`, so it works behind the dynamic Ingress prefix
- Server now uses `noServer` mode and handles the `upgrade` event manually,
  stripping the `X-Ingress-Path` prefix before matching `/ws` — the `ws`
  library's built-in path matching runs before Express middleware so the
  previous approach never worked behind Ingress

- Replaced `home-assistant` skill (ha-skillset, remote management tool) with
  `home-assistant-best-practices` from `homeassistant-ai/skills` (the correct
  official skill for HA automations, helpers, and best practices)
- Removed `ha-helper` entirely — it was built for remote HA management and
  has no place in an add-on running inside HA
- Simplified Dockerfile: no more ha-helper build stage
- Cleaned up `base-agents.md` and `run.sh` accordingly

- Install `express` and `ws` in the runtime stage via `npm ci --omit=dev`
  (they were only present in the builder stage)

- Replaced non-existent HA base-nodejs images with `node:22-alpine` (multi-arch)
- Replaced `bashio` calls in `run.sh` with plain `jq` — no HA base image dependency
- Fixed `ARG BUILD_FROM` scope in multi-stage Dockerfile
- Fixed `--platform` lint warning in builder stage

- Pi coding agent running inside Home Assistant OS
- Streaming chat UI accessible via HA Ingress
- Bundled skills: `using-superpowers`, `find-skills`, `home-assistant`
- Persistent sessions, skills, and settings in `/data` (backed up by HA)
- Customisable agent context via `agents_md_append` add-on option
- Support for Anthropic, OpenAI, and Google providers
