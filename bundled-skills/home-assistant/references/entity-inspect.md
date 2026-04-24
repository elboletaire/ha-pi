---
name: entity-inspect
description: Inspect an entity state, attributes, and related topology context.
when_to_use: User asks what an entity is doing, why it is unavailable, or what related devices/areas exist.
mutability: read_only
required_helper_commands:
  - state.get
  - registry.entities
  - registry.devices
  - registry.areas
risk_level: low
---

## Input checklist

- Canonical `entity_id`

## Steps

1. Read entity state:
   - `ha-helper state.get --input '{"entity_id":"light.kitchen"}'`
2. Read entity registry entries:
   - `ha-helper registry.entities`
3. Match registry entry to device and area:
   - `ha-helper registry.entities | jq '.data.entities[] | select(.entity_id=="light.kitchen")'`
   - `ha-helper registry.devices`
   - `ha-helper registry.areas`
4. Summarize:
   - current state
   - availability hints (`unavailable`, `unknown`)
   - area/device relationship

## Output checklist

- Confirmed canonical entity ID
- State + key attributes
- Device + area context
- Any blockers (permissions, capability unavailable, missing entity)
