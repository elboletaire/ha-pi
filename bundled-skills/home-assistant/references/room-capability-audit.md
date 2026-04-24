---
name: room-capability-audit
description: Summarize controls and sensors available in one area/room.
when_to_use: User asks what can be automated/controlled in a specific room.
mutability: read_only
required_helper_commands:
  - registry.areas
  - registry.devices
  - registry.entities
  - state.get
risk_level: low
---

## Input checklist

- Room/area name

## Steps

1. Resolve area from `registry.areas`.
   - `ha-helper registry.areas | jq '.data.areas[] | select((.name // "") | test("kitchen"; "i")) | {area_id,name}'`
2. Build area graph via `registry.devices` and `registry.entities`.
   - `ha-helper registry.entities | jq '.data.entities[] | select(.area_id=="<area_id>") | {entity_id,device_id,domain: (.entity_id | split(".")[0])}'`
3. Group entities by capability category:
   - lighting
   - climate
   - media
   - binary sensors / presence
   - covers / switches
4. Spot-check key entities with `state.get` for availability.

## Output checklist

- Capability matrix for the room
- Missing/unknown/unavailable entities
- Suggested automation opportunities (low-risk first)
