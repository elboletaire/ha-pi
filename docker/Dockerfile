# Global ARG — must be declared before any FROM so it is available to FROM lines.
# Docker resets ARG scope at each stage; only pre-FROM ARGs survive into FROM itself.
#
# The runtime is Debian-based (slim), not Alpine, because RTK ships no musl build
# for arm64 — only rtk-aarch64-unknown-linux-gnu. That binary is the correct CPU
# architecture but links against glibc, so on musl it dies at load time with
# "Error relocating: fcntl64: symbol not found" (see rtk-ai/rtk#1331; gcompat and
# libc6-compat do not resolve it). Debian also puts Node on its Tier 1 platform
# (linux/arm64 + glibc); linux/musl is only Experimental and arm64+musl is not in
# Node's support matrix at all. Costs ~21MB compressed over alpine.
ARG BUILD_FROM=node:22-slim

# ─── Stage 1: build ──────────────────────────────────────────────────────────
# $BUILDPLATFORM is set by Docker buildx to the runner's native platform so the
# builder stage always runs natively (fast) regardless of the target arch.
#
# Intentionally still Alpine even though the runtime is Debian: only compiled
# JavaScript crosses the stage boundary, never native artifacts, so the builder's
# libc is irrelevant to the runtime.
FROM --platform=${BUILDPLATFORM} node:22-alpine AS builder

# Install git (required for skill installation)
RUN apk add --no-cache git

WORKDIR /build/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY pi/skills/ ./pi/skills/
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY public/index.html public/index.css ./public/
RUN pnpm run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
# node:22-slim is a multi-arch image; Docker buildx pulls the correct variant
# (amd64 or arm64) automatically based on the --platform flag passed at build time.
FROM ${BUILD_FROM}

# bash: required by run.sh
# jq: used to parse /data/options.json (HAOS add-on options)
# git: used by many skill installers and git-based skill fetches
# curl/python3: used for direct Home Assistant API/service-call workflows
# ripgrep: several RTK filters shell out to `rg` and warn if it is absent
# ca-certificates: needed for HTTPS from curl and from the agent itself
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash jq git curl python3 ripgrep ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ─── RTK — token-reducing bash proxy ─────────────────────────────────────────
# Bump RTK_VERSION to upgrade; the weekly update workflow rewrites this default.
# TARGETARCH is supplied automatically by buildx (amd64 | arm64).
ARG RTK_VERSION=v0.44.2
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) rtk_target='x86_64-unknown-linux-musl' ;; \
      arm64) rtk_target='aarch64-unknown-linux-gnu' ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/rtk-ai/rtk/releases/download/${RTK_VERSION}"; \
    archive="rtk-${rtk_target}.tar.gz"; \
    cd /tmp; \
    curl -fsSL -o "${archive}" "${base}/${archive}"; \
    curl -fsSL -o checksums.txt "${base}/checksums.txt"; \
    grep " ${archive}\$" checksums.txt | sha256sum -c -; \
    tar -xzf "${archive}" -C /usr/local/bin rtk; \
    chmod +x /usr/local/bin/rtk; \
    rm -f "${archive}" checksums.txt; \
    rtk --version

WORKDIR /app

# Install production dependencies (express, ws)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile --prod

# Copy compiled server
COPY --from=builder /build/app/dist/ /app/dist/

# Copy bundled frontend
COPY --from=builder /build/app/public/ /app/public/

# Copy skills (both external and custom) from builder, which merged
# downloaded external skills with the committed custom ones
COPY --from=builder /build/app/pi/skills/ /app/skills/
COPY pi/base-agents.md /app/base-agents.md
COPY docker/run.sh /app/run.sh

RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
