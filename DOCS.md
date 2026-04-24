# Pi Agent — Documentation

## Options

### `anthropic_api_key` / `openai_api_key` / `google_api_key`

API keys for LLM providers. These are for **API key access** only (pay-per-use).
All three are optional — only set the key for the provider you chose in `provider`.

Keys are stored securely as add-on secrets and exported as environment variables at
startup. They are only set when non-empty, so pi's own auth falls through to
`/data/pi-agent/auth.json` if no key is present.

**For subscription-based providers** (Claude Pro/Max, ChatGPT Plus, GitHub Copilot,
Gemini CLI, etc.) leave all keys blank and use `/login` inside a chat session instead.
pi stores the OAuth token in `/data/pi-agent/auth.json`, which persists across container
restarts and upgrades.

### `provider`

The default provider to use at startup. This is used to select which model is initially
configured. Must be one of:
- `anthropic` — Anthropic API key or Claude Pro/Max subscription
- `openai` — OpenAI API key or ChatGPT Plus/Pro subscription
- `google` — Google API key or Gemini CLI subscription

For other providers supported by pi (Groq, Mistral, xAI, Bedrock, etc.), leave this as
the closest equivalent, start the add-on, then use `/model` inside the chat to switch.

### `model`

The model ID. Examples:
- Anthropic: `claude-sonnet-4-5-20250929`, `claude-opus-4-5`
- OpenAI: `gpt-4o`, `o3`
- Google: `gemini-2.0-flash`, `gemini-2.5-pro`

The web UI can switch models at runtime. Only authenticated models are shown in the selector, and the chosen model is saved via pi settings so it survives restarts.

### `log_level`

Controls how much the add-on logs to the HA log viewer. Use `debug` when troubleshooting.

### `agents_md_append`

Freeform text appended to the agent's system context on every start. Use this to:
- Set a language: `Always respond in Catalan.`
- Set a persona: `You are a concise, no-nonsense assistant.`
- Add house-specific context: `My main lights are in group.living_room.`

This is **separate** from `/data/pi-agent/AGENTS.md`. Both are loaded; the options value
is applied first, then the file.

## Persistent files

All files under `/data` are included in Home Assistant backups.

```
/data/
├── pi-agent/
│   ├── sessions/          ← conversation history
│   ├── skills/            ← user-installed skills
│   ├── extensions/        ← user-installed extensions
│   ├── auth.json          ← OAuth tokens (if you log in via /login)
│   ├── settings.json      ← pi settings
│   └── AGENTS.md          ← your personal agent instructions (optional)
└── workspace/
    ├── (files the agent creates)
    └── .ha-helper/        ← ha-helper cache and audit log
```

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

The built-in base instructions already describe Pi Agent as a Home Assistant-embedded assistant, including the writable workspace, persistent `/data/pi-agent` storage, and the fact that the agent should be honest about its boundaries.

## Web UI model selector

- Open the selector with the 🧠 header button or `Alt+Shift+M`
- Only models with working auth are listed; unavailable models are hidden
- Use the arrow buttons in the selector or `Alt+Shift+,` / `Alt+Shift+.` to cycle models
- The currently selected model stays selected when auth changes
- The selected model persists in pi settings, so it remains active after a restart
- Open the shortcut legend with the ⌨️ header button or `Alt+Shift+H`

## Troubleshooting

### "No model available"
Check that the API key for the chosen provider is set correctly in add-on options.

### Agent doesn't know about my devices
The `home-assistant` skill uses `ha-helper` to query your HA instance. Try asking:
> "What lights do I have in the living room?"

### Skills I installed are gone after an upgrade
Skills installed via `pi install` are stored in `/data/pi-agent/skills/` which persists
across upgrades. If they are missing, check that your `/data` backup was restored correctly.
