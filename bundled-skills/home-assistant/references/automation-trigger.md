---
name: automation-trigger
description: Trigger an automation safely with optional variables and verify effect.
when_to_use: User requests explicit test execution or one-off automation run.
mutability: mutating
required_helper_commands:
  - automation.trigger
  - state.get
risk_level: medium
---

## Input checklist

- `automation.entity_id`
- Optional `variables` payload

## Steps

1. Optional dry run:
   - `ha-helper automation.trigger --dry-run --confirm --input '{"entity_id":"automation.some_name"}'`
2. Execute:
   - `ha-helper automation.trigger --confirm --input '{"entity_id":"automation.some_name"}'`
3. Validate expected outcome by checking affected entities:
   - `ha-helper state.get --input '{"entity_id":"light.kitchen"}'`

## Stop conditions

- `CONFIRMATION_REQUIRED`
- `PERMISSION_DENIED`
- `NOT_FOUND`

## Rollback guidance

- Reverse side effects with explicit service calls when possible.
