---
name: supervisor-api
description: >
  Reference for executing Supervisor API commands. Use when the user asks to
  restart Home Assistant, create backups, manage add-ons, check for updates,
  or get system information.
metadata:
  version: 1
---

# Supervisor API Reference

All requests require the authorization header:

```bash
-H "Authorization: Bearer $SUPERVISOR_TOKEN"
```

Base URL: `http://supervisor/`

---

## System Info

Get overall system status:

```bash
curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/info
```

Get Core status:

```bash
curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/core/info
```

Get host info (CPU, memory, disk):

```bash
curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/host/info
```

---

## Core Control

Restart Home Assistant Core:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/core/restart
```

Stop Core:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/core/stop
```

Check configuration validity:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/core/check
```

---

## Backups

List all backups:

```bash
curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/backups
```

Create a full backup:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Backup Name"}' \
  http://supervisor/backups/new/full
```

Create a partial backup (specific folders/add-ons):

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Partial", "folders": ["ssl", "share"], "addons": ["core_ssh"]}' \
  http://supervisor/backups/new/partial
```

Restore from backup:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" \
  http://supervisor/backups/{slug}/restore/full
```

Delete a backup:

```bash
curl -X DELETE -H "Authorization: Bearer $SUPERVISOR_TOKEN" \
  http://supervisor/backups/{slug}
```

---

## Add-ons

List installed add-ons:

```bash
curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/addons
```

Get add-on info:

```bash
curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/addons/{slug}/info
```

Start/stop/restart an add-on:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/addons/{slug}/start
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/addons/{slug}/stop
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/addons/{slug}/restart
```

---

## Updates

Check system info (includes version data):

```bash
curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/info | jq .data
```

Inspect the response to identify version fields and update availability.

Update Home Assistant Core:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/core/update
```

Update Supervisor:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/supervisor/update
```

Update OS:

```bash
curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/os/update
```

---

## Related References

- **[Home Assistant Log Debugging](home-assistant-log-debugging.md)** — Log inspection and troubleshooting
