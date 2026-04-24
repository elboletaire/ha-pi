---
name: topology-explore
description: Explore area, device, and entity relationships for a room/device audit.
when_to_use: User asks what devices/entities exist in an area, or needs topology mapping before changes.
mutability: read_only
required_helper_commands:
  - registry.areas
  - registry.devices
  - registry.entities
  - registry.labels
  - registry.floors
risk_level: low
---

## Input checklist

- Optional area name or area ID hint

## Steps

1. List areas:
   - `ha-helper registry.areas`
2. List devices:
   - `ha-helper registry.devices`
3. List entities:
   - `ha-helper registry.entities`
4. Optionally collect labels/floors if supported:
   - `ha-helper registry.labels`
   - `ha-helper registry.floors`
5. Build mapping summary:
   - area → devices → entities
   - include orphan devices/entities without area
   - use `jq` for quick extraction (example device-to-entity map):
     - `ha-helper registry.entities | jq -r '.data.entities[] | [.entity_id, (.device_id // "-"), (.area_id // "-")] | @tsv'`

## Output checklist

- Target area resolution (if requested)
- Device and entity counts
- Missing assignments and topology anomalies
