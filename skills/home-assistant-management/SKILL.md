---
name: home-assistant-management
description: >
  Manage and troubleshoot Home Assistant instances. Use when the user asks to debug errors,
  investigate issues, manage entities, configure automations, or interact with the local
  Home Assistant instance. Provides knowledge about log inspection, API usage, and common
  troubleshooting patterns.
license: MIT
allowed-tools: Bash, Read
---

# Home Assistant Management

## Overview

This skill provides comprehensive guidance for managing and troubleshooting Home Assistant instances.
It includes knowledge about debugging errors, inspecting logs, using the API, and understanding
Home Assistant's internal storage and configuration.

## Core Capabilities

- **Log Debugging**: Investigate errors, warnings, authentication issues
- **API Interactions**: Use Home Assistant API and Supervisor APIs
- **Storage Inspection**: Check authentication, HTTP, and logger configuration
- **Entity Management**: Understand and manage entities
- **Automation Debugging**: Troubleshoot automation issues

## Available Reference Topics

### Debugging & Investigation

1. **[Home Assistant Log Debugging](references/home-assistant-log-debugging.md)** - Guide for investigating errors, warnings, authentication issues, and suspicious behavior by inspecting local logs and storage files first.

### Additional References (Coming Soon)

- Entity management and troubleshooting
- Automation debugging patterns
- Integration troubleshooting
- Configuration validation

## Quick Start Example

When asked to debug a Home Assistant issue:

```bash
# 1. Check for log files
ls -la /config/home-assistant.log*

# 2. Inspect recent logs if available
tail -n 100 /config/home-assistant.log

# 3. Check authentication storage if logs are missing
cat /config/.storage/auth

# 4. Use API for more detailed inspection
curl -s http://homeassistant.local:8123/api/states \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

## Usage Pattern

When the user asks about Home Assistant issues:

1. **Invoke this skill** to get context about available debugging approaches
2. **Select appropriate reference** based on the issue type
3. **Follow the priority workflow** outlined in each reference
4. **Use API-based methods** when file access is unavailable

## Notes

- Always check local evidence first before asking users for information
- Prefer API-based inspection over blind filesystem searching
- Keep investigations evidence-based and concise
- Document which sources were checked and which were unavailable
