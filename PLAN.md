# ha-pi-agent — Plan

Pi agent as a Home Assistant add-on: a Docker container running a Node.js server that embeds
a full `pi-coding-agent` SDK session and exposes a WebSocket-backed chat UI via HA Ingress.

---

## Goals

- Run a pi agent instance accessible from the HA web UI (via Ingress panel)
- Agent can control the HA instance it lives on (using `ha-helper` + bundled skills)
- User customisations (skills, settings, sessions) survive container upgrades
- Everything in `/data` so HA's native backup covers it
- AGENTS.md: hardcoded baseline from the image + user-appendable section (via add-on options and/or
  a file the user can edit with pi directly)

---

## Persistence & Backup Strategy

HAOS mounts `/data` as the persistent volume for each add-on and includes it in HA backups
automatically. The entire pi agent config directory is redirected there via the
`PI_CODING_AGENT_DIR` environment variable.

```
/data/
├── pi-agent/                  ← PI_CODING_AGENT_DIR
│   ├── auth.json              ← API key storage (pi managed)
│   ├── settings.json          ← pi settings (pi managed)
│   ├── sessions/              ← conversation history
│   ├── skills/                ← user-installed skills (via `pi install`)
│   ├── extensions/            ← user-installed extensions
│   ├── git/                   ← git-sourced packages
│   ├── AGENTS.md              ← user's personal AGENTS.md append file
│   └── agents-options.md      ← generated from add-on options on each start
├── workspace/                 ← pi's working directory (cwd)
│   └── (files pi creates/reads)
└── ha-helper/                 ← ha-helper cache, audit log
    ├── cache.json
    ├── audit.jsonl
    └── capabilities.json
```

### Image-side (read-only)

```
/app/
├── bundled-skills/            ← read-only, always from image
│   ├── using-superpowers/
│   ├── find-skills/
│   └── home-assistant/        ← from ha-skillset
├── base-agents.md             ← hardcoded baseline AGENTS.md (image-owned)
├── dist/                      ← compiled server JS
└── public/                    ← compiled frontend assets
```

### AGENTS.md loading order (pi SDK ResourceLoader)

Three sources are concatenated in order:

1. `/app/base-agents.md` — injected via `agentsFilesOverride` in the SDK.
   Hardcoded by us: working dir, HA URL/token hint, skill roster, force-read instruction.
   Survives upgrades unchanged.

2. `/data/pi-agent/AGENTS.md` — auto-discovered by `DefaultResourceLoader` (it is the
   `agentDir`). Created/edited by the user directly with pi or any tool. Not touched by
   the add-on server at all. Survives upgrades.

3. `/data/pi-agent/agents-options.md` — injected via `agentsFilesOverride`. Regenerated
   on every container start from the add-on `agents_md_append` option (a textarea in the
   HA add-on UI). Allows quick config (language, persona, preferred model) without needing
   to edit files.

### Skill loading order

1. `/app/bundled-skills/` — read-only, always the versions from the current image.
   Loaded via `skillsOverride` in the SDK ResourceLoader.

2. `/data/pi-agent/skills/` — user-installed skills (e.g. via `pi install` from within
   a pi session). Loaded automatically by `DefaultResourceLoader` because it is under
   `agentDir`.

Both sets are active simultaneously. If a user installs a skill with the same name as a
bundled one their version takes precedence (later entries win in pi's skill discovery).

---

## Bundled Skills

| Skill | Source | Notes |
|---|---|---|
| `using-superpowers` | `~/.pi/agent/skills/using-superpowers/` (obra / badlogic) | Copy into image at build time |
| `find-skills` | `~/.agents/skills/find-skills/` | Copy into image at build time |
| `home-assistant` | `ha-skillset` (`/src/llm/ha-skillset/skills/home-assistant/`) | Requires `ha-helper` in container; HA_URL/HA_TOKEN preset |

No skills from the `hagent` project are included. The `home-assistant-best-practices` skill
is intentionally left out for now — it can be installed by the user via `find-skills` if
wanted.

---

## `base-agents.md` content (hardcoded)

```markdown
# Pi Agent — Home Assistant Add-on

## Environment

- Working directory: `/data/workspace`
- Home Assistant REST API: `http://supervisor/core` (env vars HA_URL and HA_TOKEN are
  pre-configured — do not prompt the user for credentials)
- `ha-helper` is installed and ready to use

## Skill roster

The following skills are always available:
- `using-superpowers` — read this at the start of EVERY conversation
- `home-assistant` — use for any HA operation (entities, services, automations, dashboards)
- `find-skills` — use when the user asks for capabilities that might exist as a skill

## Startup rule

At the very start of each new conversation, invoke the `using-superpowers` skill.
```

---

## Add-on Options (config.yaml schema)

```yaml
options:
  anthropic_api_key: ""
  openai_api_key: ""
  google_api_key: ""
  provider: "anthropic"
  model: "claude-sonnet-4-5-20250929"
  log_level: "info"
  agents_md_append: ""

schema:
  anthropic_api_key: password?
  openai_api_key: password?
  google_api_key: password?
  provider: str
  model: str
  log_level: list(debug|info|warn|error)
  agents_md_append: str?
```

`agents_md_append` is a freeform string (YAML textarea in the HA UI). Its value is written
to `/data/pi-agent/agents-options.md` on every container start.

---

## Repository Structure

```
ha-pi-agent/
├── config.yaml
├── build.yaml                  ← multi-arch: amd64 + aarch64
├── Dockerfile
├── run.sh                      ← container entrypoint
├── README.md
├── DOCS.md
├── CHANGELOG.md
│
├── package.json
├── tsconfig.json               ← server TypeScript config
├── tsconfig.frontend.json      ← frontend TypeScript config
├── esbuild.frontend.mjs        ← bundles frontend/app.ts → public/app.js
│
├── src/                        ← server-side TypeScript
│   ├── server.ts               ← Express (static files) + WebSocket server
│   ├── agent-manager.ts        ← pi-coding-agent SDK session factory
│   ├── ws-handler.ts           ← maps AgentSessionEvents ↔ WS JSON protocol
│   ├── resource-loader.ts      ← custom DefaultResourceLoader (bundled skills + AGENTS.md)
│   └── options.ts              ← reads /data/options.json; writes agents-options.md
│
├── frontend/                   ← browser-side TypeScript (compiled to public/)
│   ├── app.ts                  ← WS client, chat state machine
│   ├── renderer.ts             ← markdown + code-highlight rendering
│   └── style.css
│
├── public/                     ← served as static files (generated, not committed)
│   ├── index.html
│   ├── app.js                  ← bundled frontend
│   └── app.css
│
└── bundled-skills/             ← copied at build time from source locations
    ├── using-superpowers/
    │   └── SKILL.md
    ├── find-skills/
    │   └── SKILL.md
    └── home-assistant/
        ├── SKILL.md
        └── references/
            └── (all ref files from ha-skillset)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      HAOS Container                            │
│                                                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  Node.js Backend                         │  │
│  │                                                           │  │
│  │  ┌─────────────────────────┐  ┌────────────────────────┐  │  │
│  │  │  pi-coding-agent SDK    │  │  Express HTTP Server   │  │  │
│  │  │  AgentSession           │  │  - GET /  → index.html │  │  │
│  │  │  - cwd: /data/workspace │  │  - static /public/     │  │  │
│  │  │  - agentDir: /data/pi-  │  │  - WS /ws              │  │  │
│  │  │    agent/               │◄─┤                        │  │  │
│  │  │  - tools: bash/read/    │  └────────────────────────┘  │  │
│  │  │    write/edit           │             │                 │  │
│  │  │  - skills: bundled +    │             │ WebSocket       │  │
│  │  │    user                 │             │                 │  │
│  │  └─────────────────────────┘             │                 │  │
│  │              │                           │                 │  │
│  │      bash tool calls                     │                 │  │
│  │              ▼                           │                 │  │
│  │       ha-helper CLI                      │                 │  │
│  │  HA_URL=http://supervisor/core           │                 │  │
│  │  HA_TOKEN=$SUPERVISOR_TOKEN              │                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                │
│  /data/pi-agent/   /data/workspace/   /data/ha-helper/         │
└─────────────────────────────────────────────────────────────────┘
                │ HTTP Ingress (HA proxy)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│               HA Web UI (browser) — Ingress Panel              │
│                                                                │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │                  Chat UI (custom)                       │  │
│   │  - Message list (streaming, markdown, tool blocks)      │  │
│   │  - Input + send/abort                                   │  │
│   │  - Session selector / new session                       │  │
│   │  - Model & thinking-level display                       │  │
│   └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## WebSocket Protocol

### Client → Server

```jsonc
{ "type": "prompt",         "text": "Turn off all lights" }
{ "type": "abort" }
{ "type": "new_session" }
{ "type": "switch_session", "sessionFile": "abc.jsonl" }
{ "type": "get_sessions" }
{ "type": "get_state" }
```

### Server → Client

```jsonc
{ "type": "agent_start" }
{ "type": "text_delta",    "delta": "Turning..." }
{ "type": "thinking_delta","delta": "..." }
{ "type": "tool_start",    "id": "...", "name": "bash", "args": {"command": "..."} }
{ "type": "tool_result",   "id": "...", "name": "bash", "output": "...", "isError": false }
{ "type": "agent_end" }
{ "type": "error",         "message": "..." }
{ "type": "state",         "isStreaming": false, "model": "...", "sessionId": "..." }
{ "type": "sessions",      "sessions": [ {"id":"...", "file":"...", "name":"...", "date":"..."} ] }
```

---

## Key Files

### `config.yaml` highlights

```yaml
name: "Pi Agent"
description: "AI coding agent with Home Assistant integration"
version: "0.1.0"
slug: "pi-agent"
init: false
homeassistant_api: true     # injects SUPERVISOR_TOKEN
ingress: true
ingress_port: 3000
panel_icon: mdi:robot
panel_title: "Pi Agent"
arch:
  - aarch64
  - amd64
map:
  - data:rw               # /data is persistent and backed up
```

### `Dockerfile` highlights

```dockerfile
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-nodejs:22
FROM ${BUILD_FROM}

# Install pi globally
RUN npm install -g @mariozechner/pi-coding-agent

# Build and install ha-helper from ha-skillset source
COPY ha-skillset-src/ /tmp/ha-skillset/
RUN cd /tmp/ha-skillset && npm ci && npm run build && npm link
RUN ln -s $(which ha-helper) /usr/local/bin/ha-helper

# Copy app
COPY dist/ /app/dist/
COPY public/ /app/public/
COPY bundled-skills/ /app/bundled-skills/
COPY base-agents.md /app/base-agents.md
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
```

> Note: `build.yaml` maps `BUILD_FROM` per arch so the same Dockerfile works for aarch64
> and amd64. The `ghcr.io/home-assistant/<arch>-base-nodejs:22` images cover both.

### `run.sh` highlights

```bash
#!/usr/bin/env bashio

# Read add-on options
PROVIDER=$(bashio::config 'provider')
MODEL=$(bashio::config 'model')
LOG_LEVEL=$(bashio::config 'log_level')
AGENTS_APPEND=$(bashio::config 'agents_md_append')

# Set API key for the chosen provider
case "$PROVIDER" in
  anthropic) export ANTHROPIC_API_KEY=$(bashio::config 'anthropic_api_key') ;;
  openai)    export OPENAI_API_KEY=$(bashio::config 'openai_api_key') ;;
  google)    export GOOGLE_API_KEY=$(bashio::config 'google_api_key') ;;
esac

# HA API access (provided automatically by HAOS when homeassistant_api: true)
export HA_URL="http://supervisor/core"
export HA_TOKEN="${SUPERVISOR_TOKEN}"

# Point pi at persistent storage
export PI_CODING_AGENT_DIR="/data/pi-agent"

# Write user options append to file (overwrite each start)
mkdir -p /data/pi-agent
if [ -n "$AGENTS_APPEND" ]; then
  echo "$AGENTS_APPEND" > /data/pi-agent/agents-options.md
else
  rm -f /data/pi-agent/agents-options.md
fi

# Ensure workspace exists
mkdir -p /data/workspace
mkdir -p /data/ha-helper

# Start server
exec node /app/dist/server.js \
  --provider "$PROVIDER" \
  --model "$MODEL" \
  --log-level "$LOG_LEVEL"
```

### `src/resource-loader.ts`

Creates a `DefaultResourceLoader` with:

```typescript
const loader = new DefaultResourceLoader({
  cwd: "/data/workspace",
  agentDir: "/data/pi-agent",   // PI_CODING_AGENT_DIR
  agentsFilesOverride: (discovered) => ({
    agentsFiles: [
      // 1. Hardcoded base (always first)
      { path: "/app/base-agents.md", content: readFileSync("/app/base-agents.md", "utf8") },
      // 2. Options-generated append (if present)
      ...(existsSync("/data/pi-agent/agents-options.md")
        ? [{ path: "/data/pi-agent/agents-options.md",
             content: readFileSync("/data/pi-agent/agents-options.md", "utf8") }]
        : []),
      // 3. User's own AGENTS.md (auto-discovered, appended last)
      ...discovered.agentsFiles,
    ],
  }),
  skillsOverride: (discovered) => ({
    skills: [
      // Bundled skills from image (always present)
      ...loadBundledSkills("/app/bundled-skills"),
      // User-installed skills (override bundled if same name)
      ...discovered.skills,
    ],
    diagnostics: discovered.diagnostics,
  }),
});
```

### `src/agent-manager.ts`

```typescript
const { session } = await createAgentSession({
  cwd: "/data/workspace",
  agentDir: "/data/pi-agent",
  model,
  authStorage: AuthStorage.create("/data/pi-agent/auth.json"),
  modelRegistry: ModelRegistry.create(authStorage),
  tools: createCodingTools("/data/workspace"),
  resourceLoader: loader,
  sessionManager: SessionManager.create("/data/workspace"),
  settingsManager: SettingsManager.create("/data/workspace", "/data/pi-agent"),
});
```

---

## Implementation Phases

### Phase 1 — Skeleton & HAOS wiring
- [ ] `config.yaml`, `build.yaml` (amd64 first, aarch64 after)
- [ ] `Dockerfile` (base-nodejs:22, install pi globally)
- [ ] `run.sh` (read options, set env vars, start server)
- [ ] `package.json` + `tsconfig.json`
- [ ] `src/options.ts` — parse `/data/options.json`, write `agents-options.md`
- [ ] Verify add-on loads in HA dev environment (empty HTTP server)

### Phase 2 — Backend server
- [ ] `src/resource-loader.ts` — bundled skills + AGENTS.md injection
- [ ] `src/agent-manager.ts` — pi-coding-agent SDK session factory
- [ ] `src/ws-handler.ts` — protocol bridge (AgentSessionEvents ↔ WS messages)
- [ ] `src/server.ts` — Express static + WebSocket endpoint + ingress base-path handling

### Phase 3 — Frontend chat UI
- [ ] `frontend/index.html` — shell, no framework
- [ ] `frontend/app.ts` — WebSocket client, chat state, message rendering dispatch
- [ ] `frontend/renderer.ts` — marked + highlight.js, DOMPurify sanitise
- [ ] `frontend/style.css` — dark theme, mobile-friendly, HA-like palette
- [ ] `esbuild.frontend.mjs` — bundle to `public/app.js` + `public/app.css`
- [ ] Features: streaming text, thinking blocks (collapsed), tool call blocks (collapsible),
     session selector, new session, abort button, auto-scroll

### Phase 4 — Skills & AGENTS.md
- [ ] Copy `using-superpowers` skill from `~/.pi/agent/skills/using-superpowers/`
- [ ] Copy `find-skills` skill from `~/.agents/skills/find-skills/`
- [ ] Copy `home-assistant` skill + all references from `ha-skillset`
- [ ] Write `base-agents.md` with: env info, skill roster, startup rule
- [ ] Wire ha-helper in Dockerfile (build from ha-skillset source or install as global npm)

### Phase 5 — ha-helper integration
- [ ] Decide build approach: copy from local path (CI) vs npm install when published
- [ ] Set `HA_URL=http://supervisor/core` and `HA_TOKEN=$SUPERVISOR_TOKEN` in run.sh
- [ ] Verify `ha-helper system.capabilities` works from inside a running container
- [ ] Set `HA_HELPER_CACHE=/data/ha-helper/cache.json` etc. so audit/cache go to `/data`

### Phase 6 — Polish & first release
- [ ] `README.md` — installation, first use, customising AGENTS.md
- [ ] `DOCS.md` — all add-on options explained
- [ ] `CHANGELOG.md`
- [ ] Add aarch64 to `build.yaml` and test on Raspberry Pi
- [ ] GitHub repo + Actions workflow (build + push to GHCR)
- [ ] HA custom repository metadata (`repository.yaml` at repo root)

---

## Open Questions

1. **ha-helper build approach** — *Suggested*: at Docker build time, copy the ha-skillset
   source into the image and `npm ci && npm run build && npm link`. This avoids publishing
   ha-skillset to npm. Once it is published, switch to `npm install -g pi-homeassistant`.
   *Tradeoff*: local build couples the image to the ha-skillset source path; a published
   npm package would be cleaner but requires the extra publish step.

2. **Multi-arch start** — *Suggested*: ship amd64 only for v0.1 (most HAOS installs are
   x86 NUCs or VMs). Add aarch64 (Raspberry Pi) in v0.2. Both use the same Dockerfile via
   `build.yaml` `BUILD_FROM` substitution.
   *Tradeoff*: skipping aarch64 immediately excludes RPi users.

3. **Session per browser tab** — *Suggested*: a single shared session across all browser
   tabs (one conversation at a time, matching the terminal pi experience). Multiple
   simultaneous sessions can be added later.
   *Tradeoff*: multiple tabs see the same conversation, which can be confusing.

4. **pi-web-ui (future v0.2)** — If the richer interface (artifacts panel, attachment
   preview, model selector dialog) is wanted, we can implement a `RemoteAgent` bridge class
   that implements the `pi-agent-core` `Agent` interface, proxies LLM calls to the backend
   via `streamProxy`, and forwards tool calls to a server-side execution API. The pi-web-ui
   `ChatPanel` component then plugs in directly. Worth a separate planning session.

5. **API key storage** — *Suggested*: `run.sh` reads keys from `options.json` on every
   start and exports them as env vars; the pi `AuthStorage` reads them from env vars
   automatically. Keys are NOT written to `auth.json` (that file is for OAuth tokens).
   *Tradeoff*: keys in env vars are visible to any process in the container. Acceptable for
   a single-user add-on.
