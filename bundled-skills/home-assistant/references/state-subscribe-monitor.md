---
name: state-subscribe-monitor
description: Monitor live HA events for a short window to debug trigger chains.
when_to_use: User reports intermittent behavior and needs real-time event observation.
mutability: read_only
required_helper_commands:
  - state.subscribe
risk_level: low
---

## Input checklist

- Optional `event_type` filter
- Observation duration (seconds)
- Optional max event count

## Steps

1. Start subscription capture:
   - `ha-helper state.subscribe --input '{"event_type":"state_changed","duration_seconds":30,"max_events":100}'`
2. Inspect returned events and order.
3. Correlate with expected trigger/action sequence.

## Output checklist

- Event count and event type
- Notable missing or delayed events
- Follow-up diagnosis action
