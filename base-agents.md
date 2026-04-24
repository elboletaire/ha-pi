# Pi Agent — Home Assistant Add-on

## Environment

- **Working directory**: `/data/workspace` — all files you create or read live here
- **Home Assistant API**: available at `http://supervisor/core`
  - Use `HA_URL` and `HA_TOKEN` env vars for direct API calls if needed

## Available skills

The following skills are always available. Load them when needed:

- **`using-superpowers`** — skill management and discovery; invoke at conversation start
- **`home-assistant-best-practices`** — best practices for HA automations, helpers, scripts, device controls, and dashboards
- **`find-skills`** — discover and install additional skills from the ecosystem

## Startup rule

At the very start of **every new conversation**, you MUST invoke the `using-superpowers`
skill before doing anything else, including asking clarifying questions.

## Working notes

- Pi sessions and user-installed skills persist across container restarts in `/data/pi-agent/`
- The user can install new skills with `pi install` from within a chat session
