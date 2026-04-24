---
name: automation-enable-disable-reload
description: Safely enable, disable, or reload automations with confirmations.
when_to_use: User asks to toggle automation state or reload automations after changes.
mutability: mutating
required_helper_commands:
  - automation.list
  - automation.enable
  - automation.disable
  - automation.reload
risk_level: high
---

## Input checklist

- Target automation IDs (or explicit all/reload intent)
- Desired action: enable / disable / reload

## Steps

1. Preflight current status:
   - `ha-helper automation.list`
2. Dry run selected action:
   - `ha-helper automation.enable --dry-run --confirm --input '{"entity_ids":["automation.a"]}'`
3. Execute with explicit confirm.
4. Verify new status via `automation.list`.

## Stop conditions

- high target count not explicitly approved
- `CONFIRMATION_REQUIRED`
- partial failures in results
