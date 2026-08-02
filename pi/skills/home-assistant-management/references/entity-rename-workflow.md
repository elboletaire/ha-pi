---
name: entity-rename-workflow
description: >
  Use when the user asks to rename a Home Assistant entity or change an entity_id pattern.
  Entity renaming is a refactoring task: always perform impact analysis first, update all
  consumers in the same change set, and verify that no stale references remain afterward.
metadata:
  version: 1
---

# Entity Rename Workflow

Use this workflow whenever renaming a Home Assistant entity or changing an entity_id pattern.

---

## Step 1: Define the scope

Before making any change, determine:

- Which entity is being renamed.
- Whether only the **friendly name** changes or the **entity_id** also changes. Friendly
  name changes are safe; entity_id changes require the full workflow below.
- Whether **sibling entities** from the same device should be renamed for consistency.
  HA devices bundle 2–6 entities (e.g. `switch.*`, `sensor.*_energy`, `update.*`).
  Renaming the primary while leaving siblings on the old scheme creates inconsistency.

## Step 2: Search all consumers

Before renaming anything, search for every reference to the old entity_id across:

| Component                           | How to search                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automations                         | HA API or grep `automations.yaml`                                                                                                                                                                                                |
| Scripts                             | HA API or grep `scripts.yaml`                                                                                                                                                                                                    |
| Scenes                              | HA API or grep `scenes.yaml`                                                                                                                                                                                                     |
| Dashboards                          | HA API or grep `.storage/lovelace*`, `ui-lovelace.yaml` for the entity_id string — matches appear in `entity:`/`entities:` fields, `tap_action`/`hold_action` targets, conditional cards, template blocks, and `views[n].badges` |
| Helpers / config-entry integrations | `GET /api/config/config_entries/entry?type=config&domain=group` — group members in `options.entities` are **not** updated automatically by a registry rename                                                                     |
| Recorder filters                    | `recorder: exclude:/include:` lists store entity IDs literally; a rename silently starts or stops recording                                                                                                                      |
| Other                               | AppDaemon apps, Node-RED flows, Pyscript scripts, custom integrations                                                                                                                                                            |

Record every location found. This list becomes the update checklist for Step 4.

## Step 3: Check for conflicts

Before applying the rename, confirm:

- The target entity_id does **not** already exist in the entity registry.
- The new naming scheme does not collide with sibling entities on the same device.
- Any entity glob or pattern (e.g. in automations or recorder filters) will not
  accidentally include or exclude unintended entities after the rename.

If the target ID already exists, resolve the conflict first — do not proceed with a rename
that would silently overwrite or shadow an existing entity.

## Step 4: Apply the rename

Perform the rename only after the consumer search is complete. Update related configuration
at the same time:

- Dashboard entity references
- Automations and scripts
- Recorder `exclude:`/`include:` filter rules
- Config-entry group membership (update via the Options Flow)

## Step 5: Verify

After renaming:

1. Search for the **old** entity_id again — expect zero results across all component types.
2. Search for the **new** entity_id to confirm all expected locations reference it.
3. Reload affected components and confirm automations, dashboards, and recorder filters
   still work as intended.

## Step 6: Roll back if needed

If any stale references remain that cannot be updated safely:

- Revert the rename to restore the old entity_id.
- Document the blocking references.
- Do not leave the system in a partially migrated state.

## Related References

- **[SKILL.md](../SKILL.md)** — Overview of all Home Assistant management capabilities
