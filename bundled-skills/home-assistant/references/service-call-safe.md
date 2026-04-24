---
name: service-call-safe
description: Safely execute a Home Assistant service call with preflight + validation.
when_to_use: User requests an explicit action (turn on/off, set value, etc.) via service call.
mutability: mutating
required_helper_commands:
  - service.list
  - service.call
  - state.get
risk_level: medium
---

## Input checklist

- Domain + service (`light.turn_on`)
- Target (`entity_id`, optionally array)
- Optional `service_data`

## Steps

1. Confirm service exists:
   - `ha-helper service.list`
2. (Optional) dry run first:
   - `ha-helper service.call --dry-run --confirm --input '{"domain":"light","service":"turn_on","target":{"entity_id":"light.kitchen"}}'`
3. Execute with confirmation:
   - `ha-helper service.call --confirm --input '{"domain":"light","service":"turn_on","target":{"entity_id":"light.kitchen"}}'`
4. Validate expected state:
   - `ha-helper state.get --input '{"entity_id":"light.kitchen"}'`

## Stop conditions

- `AUTH_ERROR` / `PERMISSION_DENIED`
- `CAPABILITY_UNAVAILABLE`
- `CONFIRMATION_REQUIRED`

## Rollback guidance

- Use inverse service call when available (e.g. `light.turn_off`).
- Re-check final state and report mismatches.
