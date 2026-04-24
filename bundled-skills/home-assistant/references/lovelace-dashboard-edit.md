---
name: lovelace-dashboard-edit
description: Safe workflow to edit dashboard-related entity metadata and validate card dependencies indirectly.
when_to_use: Dashboard cleanup requiring entity naming/area metadata changes that impact cards.
mutability: mutating
required_helper_commands:
  - registry.entities
  - registry.entity.update
  - system.cache.clear
risk_level: high
---

## Input checklist

- Target entities
- Intended visible label/grouping changes

## Steps

1. Create timestamped temp file names:
   - `timestamp=$(date +%Y%m%dT%H%M%S)`
   - `before_file=/tmp/lovelace_${timestamp}.before.json`
   - `edit_file=/tmp/lovelace_${timestamp}.edit.json`
2. Snapshot entity registry before changes:
   - `ha-helper registry.entities > "$before_file"`
3. Prepare edit payload in temp file (`$edit_file`):
   - example payload:
     - `{"entity_id":"light.kitchen","changes":{"name":"Kitchen Main"}}`
4. Dry run using the edit file:
   - `ha-helper registry.entity.update --dry-run --confirm --input-file "$edit_file"`
5. Apply using the same file:
   - `ha-helper registry.entity.update --confirm --input-file "$edit_file"`
6. Clear discovery cache:
   - `ha-helper system.cache.clear --input '{"prefix":"discovery:"}'`
7. Re-check entity registry output and report follow-up dashboard checks.

## Rollback guidance

- Use `$before_file` as rollback reference.
- Build inverse payload file and apply with:
  - `ha-helper registry.entity.update --confirm --input-file /tmp/lovelace_${timestamp}.rollback.json`

## Stop conditions

- Ambiguous target IDs
- High-blast-radius update without explicit approval
