---
name: home-assistant-log-debugging
description: >
  Use when the user asks to investigate Home Assistant errors, warnings, failed login attempts,
  authentication issues, unexpected requests, or suspicious behavior. The skill guides the agent
  to inspect logs and authentication-related storage first, instead of asking for logs or making
  assumptions.
metadata:
  version: 1
---

# Home Assistant Log Debugging

## Goal

When investigating Home Assistant errors, warnings, failed login attempts, authentication failures,
or unexpected requests, inspect the available local evidence first before asking the user for more
context or making guesses.

## Priority workflow

Follow this order:

### 1. Search for Home Assistant log files in `/config`

Check these locations first:

- `/config/home-assistant.log`
- `/config/home-assistant.log.*`
- `/config/*.log`
- `/config/home-assistant.log.fault`

If a normal log file exists, inspect the relevant time window around the reported incident.

If only `home-assistant.log.fault` exists, treat it as a crash artifact, not as a replacement for the
main runtime log.

### 2. If logs are missing or unhelpful, inspect authentication and diagnostic storage

Check these files next:

- `/config/.storage/auth`
- `/config/.storage/auth.session`
- `/config/.storage/http`
- `/config/.storage/core.logger`

These files can reveal useful clues such as:

- `last_used_at`
- `last_used_ip`
- `client_id`
- `token_type`
- logger configuration
- HTTP/auth settings

### 3. If file-based logs are unavailable, use the Home Assistant API or Supervisor APIs

Do not assume the presence of a local text log file if it is not there.

Prefer API-based inspection when possible instead of searching blindly through the filesystem.

### 4. State clearly what was found

If no useful log file exists, say so explicitly.

Do not waste time or the user's time searching for files that are absent or empty.

## Rules

- Do not ask the user to provide logs before checking whether logs are available locally.
- Do not assume an external attack when authentication data may point to a known client or device.
- Do not invent endpoints, file paths, or log locations.
- When relevant, explain which sources were checked and which were not available.
- Keep the investigation evidence-based and concise.

## Suggested investigation order

1. Find log files
2. Inspect the relevant time range
3. Check authentication storage
4. Check HTTP and logger configuration
5. Use API-based inspection if file logs are unavailable
6. Summarize findings clearly

## Related References

- **[SKILL.md](../SKILL.md)** - Overview of all Home Assistant management capabilities
