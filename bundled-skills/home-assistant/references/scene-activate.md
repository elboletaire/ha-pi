---
name: scene-activate
description: Activate a scene with confirmation and verify room/device state changes.
when_to_use: User requests applying a known scene.
mutability: mutating
required_helper_commands:
  - scene.list
  - scene.activate
  - state.get
risk_level: medium
---

## Input checklist

- `scene.entity_id`

## Steps

1. Confirm scene exists:
   - `ha-helper scene.list`
2. Dry run:
   - `ha-helper scene.activate --dry-run --confirm --input '{"entity_id":"scene.movie_time"}'`
3. Execute:
   - `ha-helper scene.activate --confirm --input '{"entity_id":"scene.movie_time"}'`
4. Validate key entity states in the affected area.
