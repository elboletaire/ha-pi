---
name: rename-z2m-devices
description: Rename Zigbee2MQTT devices with Home Assistant entity-id cascade and verification.
when_to_use: Zigbee migrations, naming cleanups, replacing old friendly names in Z2M and HA.
mutability: mutating
required_helper_commands:
  - z2m.device.rename
  - registry.devices
  - registry.entities
  - registry.device.update
risk_level: high
---

## Key behavior

- Zigbee2MQTT `friendly_name` drives both:
  - Z2M UI displayed device name
  - MQTT topic suffix (`<topic_prefix>/<friendly_name>`)
- Use `z2m.device.rename` to change Z2M `friendly_name` and request HA entity-id cascade.
- You can set a user-friendly `to` name with spaces/punctuation (e.g. `Radiador sala d'estar (est)`) if your Z2M setup accepts it.
- HA entity IDs remain normalized/sluggified; they may not mirror punctuation exactly.

## Input checklist

- Current Z2M name (or source IEEE), e.g. `radiador_sala_d_estar_est` or `0xa4c...`
- New Z2M slug, e.g. `radiador_sala_d_estar`
- Target HA `device_id` (recommended to force verification)
- Optional `topic_prefix` override when needed (e.g. `zigbee2mqtt_home`)
- Optional UI label with punctuation, e.g. `Radiador sala d'estar (est)`

## Steps

1. Snapshot current entities bound to the device:
   - `ha-helper registry.entities | jq -r '.data.entities[] | select(.device_id=="<device_id>") | .entity_id' | sort > /tmp/z2m_before.txt`
2. Dry-run rename command:
   - `ha-helper z2m.device.rename --dry-run --confirm --input '{"from":"<old>","to":"<new>","device_id":"<device_id>","homeassistant_rename":true}'`
3. Execute rename:
   - `ha-helper z2m.device.rename --confirm --input '{"from":"<old>","to":"<new>","device_id":"<device_id>","homeassistant_rename":true}'`
   - If needed, force your environment prefix explicitly (example):
     - `ha-helper z2m.device.rename --confirm --input '{"from":"<old>","to":"<new>","device_id":"<device_id>","homeassistant_rename":true,"topic_prefix":"zigbee2mqtt_home"}'`
4. Verify Z2M/MQTT-facing name changed (this is the friendly_name used by Z2M UI and MQTT topics):
   - `ha-helper registry.devices | jq '.data.devices[] | select(.id=="<device_id>") | {name,name_by_user}'`
   - Expected: `.name == "<new>"`
   - MQTT topic base expected: `<topic_prefix>/<new>`
5. Verify HA entity IDs changed:
   - `ha-helper registry.entities | jq -r '.data.entities[] | select(.device_id=="<device_id>") | .entity_id' | sort > /tmp/z2m_after.txt`
   - `diff /tmp/z2m_before.txt /tmp/z2m_after.txt`
   - (The helper clears discovery cache automatically on success.)
6. Optionally set HA UI display label with punctuation:
   - `ha-helper registry.device.update --confirm --input '{"device_id":"<device_id>","changes":{"name_by_user":"Radiador sala d\'estar (est)"}}'`

## Stop conditions

- Rename command reports success but IDs do not change after propagation window.
- New slug collides with existing Z2M friendly name.
- Device disappears from registry listings.

## Rollback guidance

- Run `z2m.device.rename` again reversing `from` and `to`.
- Re-check entity IDs and restore expected HA `name_by_user`.
