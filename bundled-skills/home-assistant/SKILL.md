---
name: home-assistant
description: Home Assistant operations router for ha-helper. Use for entity inspection, topology checks, service calls, automations, scripts, scenes, history/logbook/statistics analysis, registry metadata edits, dashboard workflows, and Zigbee2MQTT rename migrations.
---

# Home Assistant Router Skill

Use this as the single entrypoint for HA tasks.

## Rule: Load only what is needed

Do **not** read every reference file.

1. Identify the task category.
2. Read only the one most relevant reference file from `references/`.
3. If needed, read one additional reference file for a follow-up step.

## Preconditions

- Prefer using `ha-helper` commands over ad-hoc HA calls.
- For filtering/projection of JSON responses, prefer `jq` pipelines (see `references/jq-recipes.md`) over ad-hoc Python.
- For mutating actions, run `--dry-run` first when available.
- Require `--confirm` for real mutating execution.

## Reference map

### Inspection / Discovery
- `references/jq-recipes.md` (cross-cutting filters)
- `references/entity-inspect.md`
- `references/entity-search-and-normalize.md`
- `references/topology-explore.md`
- `references/room-capability-audit.md`
- `references/state-snapshot.md`
- `references/state-subscribe-monitor.md`

### Service / Control
- `references/service-call-safe.md`
- `references/service-call-multi-step.md`

### Automation
- `references/automation-inspect.md`
- `references/automation-diagnose-not-firing.md`
- `references/automation-trigger.md`
- `references/automation-enable-disable-reload.md`
- `references/automation-quality-review.md`

### Scripts / Scenes
- `references/script-run.md`
- `references/script-stop-and-recover.md`
- `references/scene-activate.md`

### History / Analysis
- `references/history-query.md`
- `references/statistics-query.md`
- `references/history-root-cause-analysis.md`
- `references/ha-setup-improvement-plan.md`

### Registry / Refactoring
- `references/registry-metadata-edit-safe.md`
- `references/entity-refactor-safe.md`
- `references/rename-z2m-devices.md`

### Dashboard / Lovelace
- `references/dashboard-lovelace-review.md`
- `references/lovelace-dashboard-edit.md`

## Output behavior

When executing a user request:
- State which reference file you selected and why.
- Execute the relevant `ha-helper` workflow.
- For mutating tasks, include preflight, confirmation, and verification.
