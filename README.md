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
- 👥 Unified Providers modal for OAuth logins and API-key providers
- ⌨️ Shortcut legend modal in the header, with browser-safe hotkeys
- 💾 Sessions, skills, settings, and direct Home Assistant config access persist through the add-on mounts
- 📜 Sessions can be resumed from the web UI, their visible chat history is restored, and each saved session can be deleted from the history list
- 🔧 Ask the bot to "find and install this skill" from chat using the bundled `find-skills` skill
- 📝 Customise the agent persona via the `agents_md_append` add-on option
- 🪪 Built-in agent instructions make the assistant describe its Home Assistant-embedded role, workspace access, boundaries, and preferred HA service-call pattern clearly

## Installation

1. Add this repository to your HA add-on store
2. Install **Pi Agent**
3. Start the add-on
4. Click **Open Web UI** or find **Pi Agent** in your sidebar
5. Open the Providers modal in the web UI and add API keys or sign in with OAuth providers

## Configuration

| Option             | Description                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- |
| `log_level`        | Server log verbosity (`debug`, `info`, `warn`, `error`)                                |
| `agents_md_append` | Free-form extra instructions appended to the agent's context (e.g. `Speak in Catalan`) |

API keys and OAuth tokens are managed from the web UI's Providers modal and stored in `/data/pi-agent/auth.json`.

The active chat model can be changed from the web UI. Only authenticated models are shown, and the selection persists via pi's saved settings.

The session picker behaves like `/resume`: selecting a session restores its visible chat history into the conversation view.

This add-on mounts `/data` and `/config` read/write, so the agent can work directly with Home Assistant files in addition to using the HA API. The runtime image also includes `curl` and `python3` for direct HA API/service-call workflows.

The built-in agent instructions also explain what the assistant is, what it can access, and what it cannot directly modify.

## Persistent customisation

Everything in `/data/pi-agent/` persists across container upgrades and is backed up by HA:

- **Install skills**: ask the bot to "find and install this skill" from a chat session
- **Edit agent instructions**: create or edit `/data/pi-agent/AGENTS.md`
- **Working files**: created by the agent in `/data/workspace/`

## Support

Open an issue on GitHub.
