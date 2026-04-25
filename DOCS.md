# Pi Agent — Documentation

## Options

### `log_level`

Controls how much the add-on logs to the HA log viewer. Use `debug` when troubleshooting.

### `agents_md_append`

Free-form text appended to the agent's system context on every start. Use this to:
- Set a language: `Always respond in Catalan.`
- Set a persona: `You are a concise, no-nonsense assistant.`
- Add house-specific context: `My main lights are in group.living_room.`

This is **separate** from `/data/pi-agent/AGENTS.md`. Both are loaded; the options value
is applied first, then the file. In the Home Assistant add-on UI, this field has a custom
label and helper text to explain its purpose.

## Providers modal

Open the **Providers** modal from the web UI to manage both OAuth logins and API keys.

- **OAuth providers** use the existing `/login` flow and store tokens in `/data/pi-agent/auth.json`
- **API key providers** are entered directly in the modal and saved to `/data/pi-agent/auth.json`
- API keys are available for Anthropic, OpenAI, and Google Gemini
- Saving an API key refreshes the available model list immediately
- Completing an OAuth login refreshes the available model list and retries agent initialization automatically when the add-on had no model yet
- If the add-on had no model yet, saving a key also retries agent initialization automatically

The web UI model selector handles provider/model switching at runtime. Only authenticated
models are shown, and the chosen model is saved via pi settings so it survives restarts.

## Persistent files

All files under `/data` are included in Home Assistant backups.

```
/data/
├── pi-agent/
│   ├── sessions/          ← conversation history
│   ├── skills/            ← user-installed skills
│   ├── extensions/        ← user-installed extensions
│   ├── auth.json          ← OAuth tokens and API keys
│   ├── settings.json      ← pi settings
│   └── AGENTS.md          ← your personal agent instructions (optional)
└── workspace/
    ├── (files the agent creates)
    └── .ha-helper/        ← ha-helper cache and audit log
```

The add-on also mounts `/config` read/write, so the agent can inspect and edit Home Assistant configuration files directly when needed.

## Installing extra skills

From within a chat session, ask pi to install a skill, for example:

```
Install the skill at git:someuser/some-skill
```

Or type it directly if you know the command:

```
pi install git:someuser/some-skill
```

Installed skills are stored in `/data/pi-agent/skills/` and survive upgrades.

## Customising agent instructions

Create the file `/data/pi-agent/AGENTS.md` (you can ask pi to do it for you):

```
Create the file /data/pi-agent/AGENTS.md with the content:
"Always respond in Italian. Refer to me as 'maestro'."
```

This file is loaded on every new conversation and merged with the built-in base instructions.

The built-in base instructions already describe Pi Agent as a Home Assistant-embedded assistant, including the writable workspace, persistent `/data/pi-agent` storage, the preferred Home Assistant service-call pattern, and the fact that the agent should be honest about its boundaries.

## Web UI session resume

- The session list in the web UI behaves like `/resume`
- Selecting a session restores the visible transcript for that session in the chat view
- The restored transcript is the current active branch, not the full `/tree` browser
- Each session row also has a delete button
- Deleting the current session starts a fresh empty session so the chat stays usable
- After restoration, new prompts continue from that session as normal

## Web UI model selector

- Open the selector with the 🧠 header button or `Alt+Shift+M`
- Only models with working auth are listed; unavailable models are hidden
- Use the arrow buttons in the selector or `Alt+Shift+,` / `Alt+Shift+.` to cycle models
- The currently selected model stays selected when auth changes
- The selected model persists in pi settings, so it remains active after a restart
- Open the shortcut legend with the ⌨️ header button or `Alt+Shift+H`

## Troubleshooting

### "No model available"
Check that the relevant API key or OAuth login is configured in the web UI's Providers modal.

### Agent doesn't know about my devices
The `home-assistant` skill uses `ha-helper` to query your HA instance. Try asking:
> "What lights do I have in the living room?"

### Skills I installed are gone after an upgrade
Skills installed via `pi install` are stored in `/data/pi-agent/skills/` which persists
across upgrades. If they are missing, check that your `/data` backup was restored correctly.
