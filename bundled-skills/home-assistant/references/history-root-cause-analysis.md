---
name: history-root-cause-analysis
description: Build a timeline-first root cause analysis from history/logbook and state topology.
when_to_use: Intermittent failures, race conditions, unexplained toggles, or delayed actions.
mutability: read_only
required_helper_commands:
  - history.query
  - logbook.query
  - state.get
  - automation.list
risk_level: low
---

## Input checklist

- Impacted entities
- Failure window (start/end)

## Steps

1. Pull history for impacted entities in the incident window.
2. Pull logbook entries for the same window.
3. Build event sequence (trigger → condition evidence → action outcomes).
4. Validate current state of impacted entities.
5. Produce root cause hypotheses ranked by confidence.

## Output checklist

- Ordered event timeline
- Probable root cause(s)
- Verification experiments and next fixes
