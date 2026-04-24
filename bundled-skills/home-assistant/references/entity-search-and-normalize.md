---
name: entity-search-and-normalize
description: Resolve ambiguous entity names to canonical entity IDs and confirm domain/type.
when_to_use: User gives informal names ("kitchen light", "hall sensor") and you need exact entity IDs.
mutability: read_only
required_helper_commands:
  - state.list
  - registry.entities
risk_level: low
---

## Input checklist

- User-provided name/alias
- Optional expected domain (`light`, `sensor`, etc.)

## Steps

1. Pull runtime state list:
   - `ha-helper state.list`
2. Pull registry entities:
   - `ha-helper registry.entities`
3. Use `jq` to shortlist candidates by user text/domain (example for "kitchen" + `light`):
   - `ha-helper registry.entities | jq '.data.entities[] | select((.entity_id | startswith("light.")) and ((.name // .original_name // "") | test("kitchen"; "i"))) | {entity_id,name: (.name // .original_name)}'`
4. Match by:
   - `entity_id`
   - original name / friendly name
   - domain prefix
5. Return top candidates with confidence and ask for confirmation if ambiguous.

## Output checklist

- Canonical `entity_id`
- Domain confirmation
- Ambiguity note when multiple candidates exist
