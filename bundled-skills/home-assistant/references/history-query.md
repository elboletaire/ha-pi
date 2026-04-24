---
name: history-query
description: Query recent entity history/logbook data for diagnostics.
when_to_use: User asks what happened over time, event sequence, or root-cause timeline.
mutability: read_only
required_helper_commands:
  - history.query
  - logbook.query
risk_level: low
---

## Input checklist

- Optional `entity_id`
- Optional `start`/`end` ISO timestamps

## Steps

1. Query state history:
   - `ha-helper history.query --input '{"entity_id":"binary_sensor.front_door"}'`
2. Query logbook events for timeline context:
   - `ha-helper logbook.query --input '{"entity_id":"binary_sensor.front_door"}'`
3. Correlate key state transitions and automation/script actions.

## Output checklist

- Ordered timeline
- Notable gaps/unavailable periods
- Candidate root cause hypotheses
