---
name: automation-quality-review
description: Review automation set for reliability, maintainability, and safety improvements.
when_to_use: User asks for automation cleanup, quality audit, or best-practice recommendations.
mutability: read_only
required_helper_commands:
  - automation.list
  - state.list
  - registry.entities
risk_level: low
---

## Input checklist

- Optional scope (all automations, area-focused, specific naming prefix)

## Steps

1. List automations and status:
   - `ha-helper automation.list`
   - Disabled automations quick view:
     - `ha-helper automation.list | jq -r '.data.automations[] | select(.state == "off") | .entity_id'`
2. Cross-check related entities and availability:
   - `ha-helper state.list`
   - `ha-helper state.list | jq '.data.states[] | select(.state=="unavailable" or .state=="unknown") | .entity_id'`
   - `ha-helper registry.entities`
3. Identify quality issues:
   - disabled/stale automations
   - duplicated intent patterns
   - unclear naming/grouping
   - heavy fan-out targets (higher risk)
4. Produce prioritized recommendations:
   - quick wins
   - medium refactors
   - high-impact risky changes

## Output checklist

- Ranked findings
- Suggested action plan with risk labels
