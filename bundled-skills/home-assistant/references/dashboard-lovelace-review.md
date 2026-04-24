---
name: dashboard-lovelace-review
description: Review dashboard entity usage and usability risks based on current HA state/topology.
when_to_use: User asks for dashboard health/usability review or suspects stale cards/entities.
mutability: read_only
required_helper_commands:
  - state.list
  - registry.entities
  - registry.areas
risk_level: low
---

## Input checklist

- Optional dashboard/view focus area

## Steps

1. Gather current entities and area topology.
   - Unavailable entities list:
     - `ha-helper state.list | jq '.data.states[] | select(.state=="unavailable" or .state=="unknown") | {entity_id,state}'`
2. Identify candidate dashboard risks:
   - unavailable entities likely shown on cards
   - inconsistent area naming vs room grouping
   - missing key controls per area
3. Report practical UI suggestions:
   - consolidate by area
   - expose high-frequency controls first
   - surface diagnostics for flaky entities

## Output checklist

- Dashboard health summary
- Suggested card/entity reorganizations
- Priority fixes list
