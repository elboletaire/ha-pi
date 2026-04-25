#!/bin/bash
set -e

OPTIONS_FILE="/data/options.json"

# ---------------------------------------------------------------------------
# Helper: read a value from the HAOS options file
# ---------------------------------------------------------------------------
get_option() {
  local key="$1"
  local default="${2:-}"
  local value
  value=$(jq -r --arg k "$key" '.[$k] // empty' "$OPTIONS_FILE" 2>/dev/null)
  echo "${value:-$default}"
}

log_info() { echo "[pi-agent] $*"; }
log_warn() { echo "[pi-agent] WARN: $*" >&2; }

# ---------------------------------------------------------------------------
# Read add-on options
# ---------------------------------------------------------------------------
PROVIDER=$(get_option 'provider' 'anthropic')
MODEL=$(get_option 'model' 'claude-sonnet-4-5-20250929')
LOG_LEVEL=$(get_option 'log_level' 'info')
AGENTS_APPEND=$(get_option 'agents_md_append' '')

# Telegram configuration
TELEGRAM_ENABLED=$(get_option 'telegram_enabled' 'false')
TELEGRAM_TOKEN=$(get_option 'telegram_bot_token' '')
TELEGRAM_CHAT_IDS=$(get_option 'telegram_allowed_chat_ids' '')

# ---------------------------------------------------------------------------
# Legacy API key options → auth.json migration
# We now keep API credentials in /data/pi-agent/auth.json so the web UI can
# manage them directly. Older installs may still have the keys in /data/options.json;
# seed auth.json from those values once so upgrades keep working.
# ---------------------------------------------------------------------------
AUTH_FILE="/data/pi-agent/auth.json"

seed_api_key_from_legacy_option() {
  local provider="$1" option="$2" value
  value=$(get_option "$option" '')
  if [ -z "$value" ]; then
    return 0
  fi

  if python3 - "$AUTH_FILE" "$provider" "$value" <<'PY'
import json
import os
import sys

path, provider, value = sys.argv[1:]

try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
        if not isinstance(data, dict):
            data = {}
except FileNotFoundError:
    data = {}
except json.JSONDecodeError:
    data = {}

if provider not in data:
    data[provider] = {"type": "api_key", "key": value}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")
    os.replace(tmp_path, path)
    os.chmod(path, 0o600)
    print("1")
PY
  then
    log_info "Migrated legacy ${option} into auth.json"
  fi
}

seed_api_key_from_legacy_option anthropic 'anthropic_api_key'
seed_api_key_from_legacy_option openai 'openai_api_key'
seed_api_key_from_legacy_option google 'google_api_key'

# ---------------------------------------------------------------------------
# Home Assistant API — available for direct use if needed (e.g. curl calls)
# SUPERVISOR_TOKEN is injected automatically by HAOS (homeassistant_api: true)
# ---------------------------------------------------------------------------
export HA_URL="http://supervisor/core"
export HA_TOKEN="${SUPERVISOR_TOKEN}"

# ---------------------------------------------------------------------------
# Point pi at persistent storage on /data
# ---------------------------------------------------------------------------
export PI_CODING_AGENT_DIR="/data/pi-agent"

# ---------------------------------------------------------------------------
# Ensure required directories exist
# ---------------------------------------------------------------------------
mkdir -p /data/pi-agent
mkdir -p /data/workspace

# ---------------------------------------------------------------------------
# Write the options-sourced AGENTS.md append file
# (overwritten on every start so it always reflects current options)
# ---------------------------------------------------------------------------
if [ -n "$AGENTS_APPEND" ]; then
  echo "$AGENTS_APPEND" > /data/pi-agent/agents-options.md
  log_info "Wrote agents_md_append to /data/pi-agent/agents-options.md"
else
  rm -f /data/pi-agent/agents-options.md
fi

# ---------------------------------------------------------------------------
# Start the Node.js server
# ---------------------------------------------------------------------------
log_info "Starting Pi Agent server (provider=${PROVIDER}, model=${MODEL})"

# Build Telegram flags if enabled
TELEGRAM_ARGS=()
if [ "$TELEGRAM_ENABLED" = "true" ]; then
  TELEGRAM_ARGS+=(--telegram-enabled true)

  if [ -n "$TELEGRAM_TOKEN" ]; then
    TELEGRAM_ARGS+=(--telegram-bot-token "$TELEGRAM_TOKEN")
  else
    log_warn "Telegram enabled but no bot token provided. Bridge will not start."
  fi

  if [ -n "$TELEGRAM_CHAT_IDS" ]; then
    TELEGRAM_ARGS+=(--telegram-allowed-chat-ids "$TELEGRAM_CHAT_IDS")
  else
    log_info "Telegram enabled with no allowed chat IDs (all chats permitted)"
  fi
else
  log_info "Telegram bridge disabled in configuration"
fi

exec node /app/dist/server.js \
  --provider "${PROVIDER}" \
  --model "${MODEL}" \
  --log-level "${LOG_LEVEL}" \
  "${TELEGRAM_ARGS[@]}"
