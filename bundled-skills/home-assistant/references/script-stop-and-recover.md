---
name: script-stop-and-recover
description: Stop a running script and validate system stabilization.
when_to_use: A script is stuck, misbehaving, or needs manual interruption.
mutability: mutating
required_helper_commands:
  - script.stop
  - state.get
  - history.query
risk_level: medium
---

## Input checklist

- `script.entity_id`
- Key entities expected to stabilize

## Steps

1. Dry run stop:
   - `ha-helper script.stop --dry-run --confirm --input '{"entity_id":"script.some_flow"}'`
2. Execute stop:
   - `ha-helper script.stop --confirm --input '{"entity_id":"script.some_flow"}'`
3. Validate key entities reach expected state (`state.get`).
4. Use `history.query` if side-effects continue.

## Output checklist

- Stop result
- Stabilization status
- Follow-up actions if drift persists
