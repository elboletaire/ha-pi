---
name: script-run
description: Execute a script safely with optional variables and validate resulting state.
when_to_use: User asks to run an existing script or test script behavior.
mutability: mutating
required_helper_commands:
  - script.run
  - state.get
risk_level: medium
---

## Input checklist

- `script.entity_id`
- Optional `variables`

## Steps

1. Dry run first:
   - `ha-helper script.run --dry-run --confirm --input '{"entity_id":"script.evening_routine"}'`
2. Execute:
   - `ha-helper script.run --confirm --input '{"entity_id":"script.evening_routine"}'`
3. Validate key entities changed as expected.

## Stop conditions

- `CONFIRMATION_REQUIRED`
- `PERMISSION_DENIED`
- `NOT_FOUND`
