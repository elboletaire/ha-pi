# Changelog

## Unreleased

## 0.2.2 — Session resume restores chat history

- Resuming a session from the web UI now restores the visible chat transcript from the selected session
- Added a `session_history` WebSocket payload so the chat view can hydrate after switching sessions or reloading the page

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
