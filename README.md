# Pi Agent

[![Open your Home Assistant instance and show the add add-on repository dialog.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Felboletaire%2Fha-pi)

A [pi coding agent](https://github.com/badlogic/pi-mono) add-on for Home Assistant OS.

Chat with an AI coding agent directly from the Home Assistant web UI. The agent can inspect
and control your HA installation, manage files, run shell commands, and be extended with
additional skills.

## Features

- 🤖 Full [pi coding agent](https://pi.dev) inside your HA instance
- 🏠 Bundled `home-assistant` skill — inspect entities, run services, edit automations
- 🔍 Bundled `find-skills` skill — discover and install additional skills from the ecosystem
- 💬 Streaming chat UI accessible via the HA sidebar
- 🧠 Dynamic model selector that only shows currently available models
- ⌨️ Shortcut legend modal in the header, with browser-safe hotkeys
- 💾 Sessions, skills, and settings persist in `/data` (included in HA backups)
- 🔧 Extend with new skills from within a chat session: `pi install git:...`
- 📝 Customise the agent persona via add-on options

## Installation

1. Add this repository to your HA add-on store
2. Install **Pi Agent**
3. Configure at least one API key (Anthropic recommended)
4. Start the add-on
5. Click **Open Web UI** or find **Pi Agent** in your sidebar

## Configuration

| Option | Description |
|--------|-------------|
| `anthropic_api_key` | Anthropic API key (recommended) |
| `openai_api_key` | OpenAI API key |
| `google_api_key` | Google Gemini API key |
| `provider` | Which provider to use (`anthropic`, `openai`, `google`) |
| `model` | Model ID to use (e.g. `claude-sonnet-4-5-20250929`) |
| `log_level` | Server log verbosity (`debug`, `info`, `warn`, `error`) |
| `agents_md_append` | Extra instructions appended to the agent's context (e.g. `Speak in Catalan`) |

The active chat model can be changed from the web UI. Only authenticated models are shown, and the selection persists via pi's saved settings.

## Persistent customisation

Everything in `/data/pi-agent/` persists across container upgrades and is backed up by HA:

- **Install skills**: from a chat session, run `pi install git:owner/repo`
- **Edit agent instructions**: create or edit `/data/pi-agent/AGENTS.md`
- **Working files**: created by the agent in `/data/workspace/`

## Support

Open an issue on GitHub.
