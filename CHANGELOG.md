# Changelog

## 0.1.5 — Fix crash on prompt error + TUI command handling

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
