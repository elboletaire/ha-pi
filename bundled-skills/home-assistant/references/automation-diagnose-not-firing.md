---
name: automation-diagnose-not-firing
description: Structured troubleshooting workflow for automations that do not run.
when_to_use: User reports an automation should have triggered but didn't.
mutability: read_only
required_helper_commands:
  - automation.list
  - state.get
  - history.query
  - logbook.query
risk_level: low
---

## Input checklist

- `automation.entity_id`
- Approximate failure time window

## Steps

1. Inspect automation state:
   - `ha-helper state.get --input '{"entity_id":"automation.example"}'`
2. Confirm it is enabled in `automation.list`.
3. Inspect trigger-related entities around failure time:
   - `ha-helper history.query --input '{"entity_id":"binary_sensor.x","start":"...","end":"..."}'`
4. Correlate with logbook timeline:
   - `ha-helper logbook.query --input '{"start":"...","end":"..."}'`
5. Summarize likely failure points:
   - trigger not fired
   - condition not satisfied
   - action side-effect missing

## Output checklist

- Diagnosis summary
- Most likely root cause
- Next verification step
