# Changelog

## 0.5.9 — Telegram session switch UX and pi-ai dependency fix

### Fixed

- **Direct `@mariozechner/pi-ai` dependency**: added the package explicitly so TypeScript and the build can resolve the shared session/model types imported directly by the frontend and login/model-selection code. The package was already present transitively through `@mariozechner/pi-coding-agent`, but pnpm does not guarantee transitive packages are importable from the app root.
- **Telegram session switch response**: the `/session <ID>` reply now shows the latest message from the switched session inline, uses bold labels for the metadata lines, and no longer sends inline buttons.

## 0.5.8 — Fix Telegram session lost when web UI deletes sessions

### Fixed

- **Telegram session file corrupted after web UI deletion**: when all sessions were removed from the web UI while the Telegram bridge had an active session cached in memory, the next incoming message would recreate the session file via `appendFileSync` without writing the session header first. This produced a malformed JSONL file that was not visible in the web UI session list and could not be properly resumed. The bridge now detects this condition (`messageCount > 0` but `sessionFile` no longer exists on disk) and transparently starts a fresh session before processing the message, exactly as `/new` would do.

## 0.5.7 — Catalan and Spanish translations for configuration options

### Added

- **Catalan translations**: New `translations/ca.yaml` file with complete translations for all configuration options (log_level, agents_md_append, telegram_enabled, telegram_bot_token, telegram_allowed_chat_ids)
- **Spanish translations**: New `translations/es.yaml` file with complete translations for all configuration options
- **Comprehensive config translations**: Updated `translations/en.yaml` to include friendly labels and descriptions for all 5 configuration options:
  - `log_level`: Logging level controls with usage guidance
  - `telegram_enabled`: Telegram notifications toggle with requirements
  - `telegram_bot_token`: Bot API token with security guidance
  - `telegram_allowed_chat_ids`: Chat ID list with setup instructions
- **Enhanced translation tests**: Updated test suite to verify all configuration options have proper name and description fields

### Changed

- Bumped version from 0.5.6 to 0.5.7

### Added

- **Session resume across restarts**: Telegram conversations now resume where they left off after a server restart. A `SenderSessionRegistry` persists the `senderId → sessionFile` mapping to `bridge-sessions.json` inside the data directory. On startup, each sender's last session is reopened via `SessionManager.open()` instead of always creating a new one via `SessionManager.create()`. The registry is updated after every init, command, and prompt so it always reflects the current session (including after `/new` or `/session <ID>`)
- **`/s‹id›` session shortcut**: The sessions list now renders each entry as a tappable `/s‹id›` command link (e.g. `/s019dc5e5`) so users can switch sessions with a single tap. The shortcut is not registered in the bot autocomplete menu to keep it uncluttered

### Changed

- **`/sessions` list**: Replaced the broken tab-separated pseudo-table (whose "Name" column mirrored the ID) with a readable per-session block showing the `/s‹id›` link, message count, last-modified date, and the first user message as a preview — so sessions are actually identifiable
- **`/new` response**: Removed the redundant "Start chatting" inline button. Session ID is now shown as inline code (`` `id` ``)
- **`AgentManager.init()`**: Accepts an optional `sessionFile` path; uses `SessionManager.open()` when the file exists on disk, falls back to `SessionManager.create()` otherwise

## 0.5.5 — Fix Telegram bot responses disappearing

### Fixes

- Fixed Telegram bot responses disappearing after generation: `sendMessageDraft` only creates a transient typing-animation preview that auto-expires when the typing indicator ends; the permanent message must always be delivered via `sendMessage`. `processQueue` now unconditionally calls `sendMessage` after generation completes, regardless of draft streaming state
- Fixed unreachable fallback `sendMessage` in the draft path: because `telegram.ts`'s `sendDraft` silently swallows all API errors (best-effort), `bridge.ts`'s `sendDraft()` always returned `true`, making `finalizeDraft()` always return `true` and the `if (!finalized)` fallback dead code
- Fixed missing newline between the source header separator (`───`) and message body in all draft-related calls (`finalizeDraft`, `appendDraftToken`, `sendDraftStatus`): `formatSourceHeader` now includes the trailing `\n` so every caller gets the correct format without per-site boilerplate; the redundant manual `\n` in `telegram.ts`'s `send()` is removed accordingly

## 0.5.4 — Skill discipline overhaul

### Changed

- Removed `using-superpowers` as a bundled external skill; its platform-specific sections (Claude Code `Skill` tool, Copilot CLI, Gemini CLI, Platform Adaptation) are incorrect for the pi agent where skills are read via the `read` tool
- Ported the relevant behavioural content from `using-superpowers` into `home-assistant-management`: `SUBAGENT-STOP`, `EXTREMELY-IMPORTANT` (the 1% rule), The Rule, Red Flags table, Skill Priority, Skill Types, and User Instructions — all adapted for pi agent and HA context
- Updated `base-agents.md` startup rule to invoke `home-assistant-management` instead of `using-superpowers`
- Stripped redundant prose from `home-assistant-management` skill (Overview, Core Capabilities, Quick Start Example, Usage Pattern, Notes) — all either restated the frontmatter or duplicated content already in the reference files; the HA management section is now a clean reference index
- Removed redundant `## Available skills` list from `base-agents.md`; the pi agent already injects the skills list into every session context automatically
- Removed redundant `## Files and mounts` section from `base-agents.md`; paths already stated in `## Execution environment`
- Unified `## What I can do` and `## What I should mention when asked` into a single section, dropping path repetitions
- Removed duplicate "prefer HA API" bullet from `## Boundaries` (already present in `## How I should work`)

### Added

- Four new bundled skills from `obra/superpowers`: `executing-plans`, `systematic-debugging`, `writing-plans`, `test-driven-development`

## 0.5.3 — Fix external skills missing from Docker image

### Fixes

- Fixed external skills (`find-skills`, `using-superpowers`, `home-assistant-best-practices`) never appearing in `/app/skills/` inside the container: the runtime stage was copying `skills/` from the build context (git checkout) instead of from the builder stage where `install-skills.mjs` actually downloads them
- Fixed `install-skills.mjs` failing in the builder stage due to `skills/` directory not existing: custom skills are now copied into the builder before `pnpm run build` runs, so both the directory exists and custom skills are present when external ones are merged in

## 0.5.2 — Fix skill loading after build-time skill refactor

### Fixes

- Fixed bundled skills never loading: `PATHS.bundledSkills` still pointed to `/app/bundled-skills` after the 0.5.1 refactor moved them to `/app/skills`
- Fixed user-installed skills (via `npx skills add` / `~/.agents/skills`) being lost on container restart — `/root/.agents` is now symlinked to `/data/pi-agent/agents` at startup so skill installs land on the persisted `/data` volume

## 0.5.1 — Build-time skill installation

### Changed

- Removed bundled-skills directory from repository
- Skills now installed during build using `npx skills add`
- Added `skills/` directory for both external and custom skills
- Updated Dockerfile to use `skills/` instead of `bundled-skills/`

## 0.5.0 — Telegram streaming and formatting fixes

### Features

- Telegram bot now streams responses in real time using Telegram Bot API 9.3+ `sendMessageDraft`
- Draft message shows live status feedback while the agent works: _Thinking..._ during model reasoning, _Using bash..._ / _Using curl..._ (etc.) during tool execution, then streams the final response token by token before delivering the fully formatted message
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
