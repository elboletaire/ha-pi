---
name: state-snapshot
description: Capture a state snapshot for diagnostics before/after changes.
when_to_use: Troubleshooting, change validation, baseline capture.
mutability: read_only
required_helper_commands:
  - state.list
  - state.get
risk_level: low
---

## Input checklist

- Optional list of focus entity IDs

## Steps

1. Capture global snapshot:
   - `ha-helper state.list`
   - Optional reduced snapshot with `jq`:
     - `ha-helper state.list | jq '.data.states[] | {entity_id,state,last_changed}'`
2. Capture focused entities for high-signal diff:
   - `ha-helper state.get --input '{"entity_id":"light.kitchen"}'`
3. Save/label snapshot as pre-change or post-change.
4. Compare deltas and report unexpected changes.

## Output checklist

- Timestamped snapshot summary
- Focus entity diffs
- Unexpected/unavailable entities
