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

# ---------------------------------------------------------------------------
# API keys — only exported when non-empty so pi can fall back to auth.json
# (tokens stored there by /login survive container restarts via /data/pi-agent/)
# ---------------------------------------------------------------------------
set_key_if_nonempty() {
  local var="$1" val="$2"
  if [ -n "$val" ]; then
    export "$var"="$val"
    log_info "Using API key for ${var}"
  fi
}

set_key_if_nonempty ANTHROPIC_API_KEY "$(get_option 'anthropic_api_key' '')"
set_key_if_nonempty OPENAI_API_KEY    "$(get_option 'openai_api_key' '')"
set_key_if_nonempty GOOGLE_API_KEY    "$(get_option 'google_api_key' '')"

# ---------------------------------------------------------------------------
# Home Assistant API access
# SUPERVISOR_TOKEN is injected automatically by HAOS (homeassistant_api: true)
# ---------------------------------------------------------------------------
export HA_URL="http://supervisor/core"
export HA_TOKEN="${SUPERVISOR_TOKEN}"

# ha-helper uses paths relative to cwd (/data/workspace/.ha-helper/)
# No extra env vars needed — defaults resolve correctly under cwd

# ---------------------------------------------------------------------------
# Point pi at persistent storage on /data
# ---------------------------------------------------------------------------
export PI_CODING_AGENT_DIR="/data/pi-agent"

# ---------------------------------------------------------------------------
# Ensure required directories exist
# ---------------------------------------------------------------------------
mkdir -p /data/pi-agent
mkdir -p /data/workspace
mkdir -p /data/workspace/.ha-helper

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

exec node /app/dist/server.js \
  --provider "${PROVIDER}" \
  --model "${MODEL}" \
  --log-level "${LOG_LEVEL}"
