---
name: ha-setup-improvement-plan
description: Produce a prioritized improvement plan for the whole HA setup.
when_to_use: User asks "what should I improve next?" across automations, entities, and control model.
mutability: read_only
required_helper_commands:
  - system.capabilities
  - automation.list
  - registry.areas
  - registry.devices
  - registry.entities
  - state.list
risk_level: low
---

## Input checklist

- Constraints (time, risk tolerance, focus areas)

## Steps

1. Gather capability snapshot:
   - `ha-helper system.capabilities`
2. Inventory topology and entities:
   - `ha-helper registry.areas`
   - `ha-helper registry.devices`
   - `ha-helper registry.entities`
3. Inventory automations and runtime signals:
   - `ha-helper automation.list`
   - `ha-helper state.list`
4. Build phased plan:
   - Phase A: low-risk high-value cleanup
   - Phase B: reliability and observability
   - Phase C: larger refactors

## Output checklist

- Prioritized backlog with rationale
- Risk + effort estimate per item
- Suggested execution order
