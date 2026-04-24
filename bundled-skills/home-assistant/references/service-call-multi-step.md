---
name: service-call-multi-step
description: Execute an ordered sequence of service calls with stop-on-failure checks.
when_to_use: User requests a routine requiring multiple actions in sequence.
mutability: mutating
required_helper_commands:
  - service.list
  - service.call
  - state.get
risk_level: medium
---

## Input checklist

- Ordered list of service operations
- Per-step target/data and expected post-state

## Steps

1. Validate all services exist:
   - `ha-helper service.list`
2. For each step:
   - dry run with `--dry-run --confirm`
   - execute with `--confirm`
   - validate expected state via `state.get`
3. Stop immediately if a step fails validation.

## Stop conditions

- `CONFIRMATION_REQUIRED`
- any failed command or failed post-state check

## Rollback guidance

- Execute inverse actions for completed steps when possible.
- Report exactly where sequence failed.
