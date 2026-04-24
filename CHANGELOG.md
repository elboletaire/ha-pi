# Changelog

## 0.1.2 — Fix missing runtime dependencies

- Install `express` and `ws` in the runtime stage via `npm ci --omit=dev`
  (they were only present in the builder stage)

- Replaced non-existent HA base-nodejs images with `node:22-alpine` (multi-arch)
- Replaced `bashio` calls in `run.sh` with plain `jq` — no HA base image dependency
- Fixed `ARG BUILD_FROM` scope in multi-stage Dockerfile
- Fixed `--platform` lint warning in builder stage

- Pi coding agent running inside Home Assistant OS
- Streaming chat UI accessible via HA Ingress
- Bundled skills: `using-superpowers`, `find-skills`, `home-assistant`
- Persistent sessions, skills, and settings in `/data` (backed up by HA)
- Customisable agent context via `agents_md_append` add-on option
- Support for Anthropic, OpenAI, and Google providers
