---
name: entity-refactor-safe
description: Safe workflow for entity metadata refactors with dependency checks and rollback.
when_to_use: Renaming entities/devices, changing area assignment, metadata cleanup.
mutability: mutating
required_helper_commands:
  - registry.entities
  - registry.devices
  - registry.entity.update
  - registry.device.update
  - system.cache.clear
risk_level: high
---

## Input checklist

- Target IDs and exact metadata changes
- Expected impacted automations/scripts/dashboards (if known)

## Steps

1. Capture preflight registry state:
   - `ha-helper registry.entities`
   - `ha-helper registry.devices`
   - Narrow the exact entities/devices with `jq` (avoid broad refactors):
     - `ha-helper registry.entities | jq '.data.entities[] | select(.device_id=="<device_id>") | {entity_id,name}'`
2. Execute dry run update with `--dry-run --confirm`.
3. Apply update with `--confirm`.
4. Clear discovery cache:
   - `ha-helper system.cache.clear --input '{"prefix":"discovery:"}'`
5. Re-read registry and verify expected metadata.

## Rollback guidance

- Reapply previous metadata values using inverse update payload.
- Re-verify downstream behavior on affected entities.
