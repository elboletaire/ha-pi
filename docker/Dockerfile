# Global ARG — must be declared before any FROM so it is available to FROM lines.
# Docker resets ARG scope at each stage; only pre-FROM ARGs survive into FROM itself.
ARG BUILD_FROM=node:22-alpine

# ─── Stage 1: build ──────────────────────────────────────────────────────────
# $BUILDPLATFORM is set by Docker buildx to the runner's native platform so the
# builder stage always runs natively (fast) regardless of the target arch.
FROM --platform=${BUILDPLATFORM} node:22-alpine AS builder

# Install git (required for skill installation)
RUN apk add --no-cache git

WORKDIR /build/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY skills/ ./skills/
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY public/index.html public/index.css ./public/
RUN pnpm run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
# node:22-alpine is a multi-arch image; Docker buildx pulls the correct variant
# (amd64 or arm64) automatically based on the --platform flag passed at build time.
FROM ${BUILD_FROM}

# bash: required by run.sh
# jq: used to parse /data/options.json (HAOS add-on options)
# git: used by many skill installers and git-based skill fetches
# curl/python3: used for direct Home Assistant API/service-call workflows
RUN apk add --no-cache bash jq git curl python3

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
COPY --from=builder /build/app/skills/ /app/skills/
COPY base-agents.md /app/base-agents.md
COPY docker/run.sh /app/run.sh

RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
