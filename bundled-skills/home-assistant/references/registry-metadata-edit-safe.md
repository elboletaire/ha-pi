---
name: registry-metadata-edit-safe
description: Update entity/device registry metadata with preflight, confirmation, and cache refresh.
when_to_use: Renaming entities/devices, moving area assignments, or updating registry labels safely.
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

- Target type: `entity` or `device`
- Canonical ID (`entity_id` or `device_id`)
- `changes` object (only the fields intended to modify)

## Steps

1. Preflight discovery snapshot:
   - `ha-helper registry.entities`
   - `ha-helper registry.devices`
   - Filter target scope with `jq` before any mutation:
     - `ha-helper registry.entities | jq '.data.entities[] | select(.entity_id=="light.kitchen")'`
     - `ha-helper registry.devices | jq '.data.devices[] | select(.id=="abcd1234")'`
2. Dry run update:
   - Entity example:
     - `ha-helper registry.entity.update --dry-run --confirm --input '{"entity_id":"light.kitchen","changes":{"name":"Kitchen Main"}}'`
   - Device example:
     - `ha-helper registry.device.update --dry-run --confirm --input '{"device_id":"abcd1234","changes":{"area_id":"kitchen"}}'`
3. Execute confirmed update:
   - `ha-helper registry.entity.update --confirm --input '{...}'`
   - or `ha-helper registry.device.update --confirm --input '{...}'`
4. Refresh discovery cache if needed:
   - `ha-helper system.cache.clear --input '{"prefix":"discovery:"}'`
5. Verify updated metadata via registry list commands.

## Stop conditions

- `CONFIRMATION_REQUIRED`
- `PERMISSION_DENIED`
- `CAPABILITY_UNAVAILABLE`
- `VALIDATION_ERROR` / `INVALID_INPUT`

## Rollback guidance

- Apply inverse registry update with original metadata values.
- Re-run registry listing and dependent workflow checks.
