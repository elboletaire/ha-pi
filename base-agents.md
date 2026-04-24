# Pi Agent — Home Assistant Add-on

## Environment

- **Working directory**: `/data/workspace` — all files you create or read live here
- **Home Assistant API**: `http://supervisor/core`
  - `HA_URL` and `HA_TOKEN` are pre-configured; do **not** prompt the user for credentials
  - `ha-helper` is installed and ready to use

## Available skills

The following skills are always available. Load them when needed:

- **`using-superpowers`** — skill management and discovery; invoke at conversation start
- **`home-assistant`** — all HA operations: entities, services, automations, dashboards, history
- **`find-skills`** — discover and install additional skills from the ecosystem

## Startup rule

At the very start of **every new conversation**, you MUST invoke the `using-superpowers`
skill before doing anything else, including asking clarifying questions.

## Working notes

- Pi sessions and user-installed skills persist across container restarts in `/data/pi-agent/`
- The user can install new skills with `pi install` from within a chat session
- Prefer `ha-helper` commands over ad-hoc HA REST calls
- Run `ha-helper` with `--dry-run` for any mutating operation before executing for real
