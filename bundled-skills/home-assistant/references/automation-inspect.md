---
name: automation-inspect
description: Inspect automation status and identify likely trigger/dependency issues.
when_to_use: User asks why an automation is not running or wants a quick automation inventory.
mutability: read_only
required_helper_commands:
  - automation.list
  - state.get
risk_level: low
---

## Input checklist

- Optional specific `automation.entity_id`

## Steps

1. List all automations:
   - `ha-helper automation.list`
   - Enabled-only view with `jq`:
     - `ha-helper automation.list | jq -r '.data.automations[] | select(.state != "off") | .entity_id'`
2. If a specific automation is requested, inspect it directly:
   - `ha-helper state.get --input '{"entity_id":"automation.some_name"}'`
3. Report:
   - enabled/disabled status
   - last triggered metadata (if available)
   - unavailable/unknown state flags

## Output checklist

- Automation status summary
- Suspected blockers and next check recommendation
