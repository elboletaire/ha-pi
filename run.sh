#!/usr/bin/env bashio

# ---------------------------------------------------------------------------
# Read add-on options
# ---------------------------------------------------------------------------
PROVIDER=$(bashio::config 'provider')
MODEL=$(bashio::config 'model')
LOG_LEVEL=$(bashio::config 'log_level')
AGENTS_APPEND=$(bashio::config 'agents_md_append' '')

# ---------------------------------------------------------------------------
# API keys — only exported when non-empty so pi can fall back to auth.json
# (tokens stored there by /login survive container restarts via /data/pi-agent/)
# ---------------------------------------------------------------------------
set_key_if_nonempty() {
  local var="$1" val="$2"
  if [ -n "$val" ] && [ "$val" != "null" ]; then
    export "$var"="$val"
    bashio::log.info "Using API key for ${var}"
  fi
}

set_key_if_nonempty ANTHROPIC_API_KEY "$(bashio::config 'anthropic_api_key' '')"
set_key_if_nonempty OPENAI_API_KEY    "$(bashio::config 'openai_api_key' '')"
set_key_if_nonempty GOOGLE_API_KEY    "$(bashio::config 'google_api_key' '')"

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
if [ -n "$AGENTS_APPEND" ] && [ "$AGENTS_APPEND" != "null" ]; then
  echo "$AGENTS_APPEND" > /data/pi-agent/agents-options.md
  bashio::log.info "Wrote agents_md_append to /data/pi-agent/agents-options.md"
else
  rm -f /data/pi-agent/agents-options.md
fi

# ---------------------------------------------------------------------------
# Start the Node.js server
# ---------------------------------------------------------------------------
bashio::log.info "Starting Pi Agent server (provider=${PROVIDER}, model=${MODEL})"

exec node /app/dist/server.js \
  --provider "${PROVIDER}" \
  --model "${MODEL}" \
  --log-level "${LOG_LEVEL}"
