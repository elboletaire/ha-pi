# Runtime Information Injection

The Pi Agent add-on automatically detects and injects runtime metadata into the agent's system prompt. This helps the agent understand its deployment context.

## What Gets Injected

The agent receives the following information at the start of each session:

| Field | Description | Source |
|-------|-------------|--------|
| Home Assistant | HA Core version | Supervisor API `/api/config` |
| Pi Agent Add-on | Add-on version | Build-time injection / env override |
| Access | `ingress` or `direct` | Presence of `SUPERVISOR_TOKEN` |
| Deployment | `HAOS Add-on`, `Supervised`, or `Standalone` | Environment detection |
| Architecture | CPU architecture | `ARCH` env or `process.arch` |

## Example Output

The agent sees this in its system prompt:

```markdown
## Runtime Environment

**System Information:**
- Home Assistant: 2026.4.0
- Pi Agent Add-on: 0.7.1
- Access: ingress
- Deployment: HAOS Add-on
- Architecture: aarch64

---
```

## Customization

### Override Add-on Version

Set the `ADDON_VERSION` environment variable to override the detected version:

```bash
docker run -e ADDON_VERSION=1.2.3 ghcr.io/elboletaire/ha-pi:latest
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ADDON_VERSION` | Override add-on version | Build-time value |
| `HA_TOKEN` | Auth for Supervisor API | Set by HAOS |
| `HA_URL` | Supervisor API base URL | `http://supervisor/core` |
| `ARCH` | Override architecture | `process.arch` |

## Troubleshooting

### "Home Assistant: unknown"

This means the agent couldn't fetch the HA version. Check:

1. **HA_TOKEN is set**: `echo $HA_TOKEN` in the container
2. **HA_URL is correct**: Should be `http://supervisor/core`
3. **Supervisor API accessible**: `curl -H "Authorization: Bearer $HA_TOKEN" $HA_URL/api/config`

### "Pi Agent Add-on: unknown"

The version wasn't injected at build time. This shouldn't happen in official releases. If building locally:

1. Ensure `scripts/esbuild.server.mjs` has the `define` block for version injection
2. Or set `ADDON_VERSION` environment variable

## For Developers

Runtime info is generated in `src/runtime-info.ts` and injected via `src/resource-loader.ts`.

**Injection order in agent prompt:**
1. `pi/base-agents.md` — hardcoded system prompt
2. Runtime info — dynamically generated (this feature)
3. `agents-options.md` — from add-on configuration
4. User's `AGENTS.md` — custom instructions

**Build-time version injection:**
The version is read from `package.json` and injected via esbuild's `define` feature in `scripts/esbuild.server.mjs`. This avoids runtime file reads.
