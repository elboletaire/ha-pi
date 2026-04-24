# jq recipes for ha-helper outputs

Use `jq` for local filtering/projection of `ha-helper` JSON output. Prefer this over ad-hoc Python scripts for quick transformations.

## Common patterns

### Registry entities for one device

```bash
ha-helper registry.entities \
| jq -r '.data.entities[] | select(.device_id=="<device_id>") | .entity_id'
```

### Devices by partial name (case-insensitive)

```bash
ha-helper registry.devices \
| jq '.data.devices[] | select((.name_by_user // .name // "") | test("interruptor"; "i"))'
```

### Entities by integration platform hint

```bash
ha-helper registry.entities \
| jq '.data.entities[] | select((.platform // "") == "zha")'
```

### Unavailable entities snapshot

```bash
ha-helper state.list \
| jq '.data.states[] | select(.state=="unavailable" or .state=="unknown") | {entity_id,state}'
```

### Enabled automations only

```bash
ha-helper automation.list \
| jq '.data.automations[] | select(.state != "off") | .entity_id'
```

### Simple compact table

```bash
ha-helper registry.entities \
| jq -r '.data.entities[] | [.entity_id, (.device_id // "-"), (.area_id // "-")] | @tsv'
```

## Notes

- Keep filters in shell/jq when possible; avoid introducing Python one-offs.
- If a query becomes too complex/reused, promote it into a documented jq snippet in this file.
