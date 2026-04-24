# Global ARG — must be declared before any FROM so it is available to FROM lines.
# Docker resets ARG scope at each stage; only pre-FROM ARGs survive into FROM itself.
ARG BUILD_FROM=node:22-alpine

# ─── Stage 1: build ──────────────────────────────────────────────────────────
# $BUILDPLATFORM is set by Docker buildx to the runner's native platform so the
# builder stage always runs natively (fast) regardless of the target arch.
FROM --platform=${BUILDPLATFORM} node:22-alpine AS builder

# ── Build ha-pi-agent server + frontend ──────────────────────────────────────
WORKDIR /build/app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json esbuild.frontend.mjs ./
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY public/index.html public/index.css ./public/
RUN npm run build

# ── Build ha-helper ───────────────────────────────────────────────────────────
WORKDIR /build/ha-helper

COPY ha-helper/package*.json ./
RUN npm ci

COPY ha-helper/tsconfig.json ./
COPY ha-helper/src/ ./src/
RUN npm run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
# node:22-alpine is a multi-arch image; Docker buildx pulls the correct variant
# (amd64 or arm64) automatically based on the --platform flag passed at build time.
FROM ${BUILD_FROM}

# bash: required by run.sh  jq: used to parse /data/options.json (HAOS add-on options)
RUN apk add --no-cache bash jq

WORKDIR /app

# Install production dependencies (express, ws)
COPY package*.json ./
RUN npm ci --omit=dev

# Install pi coding agent globally
RUN npm install -g @mariozechner/pi-coding-agent

# Install ha-helper:
# - package.json + lock from source (for dep resolution)
# - compiled dist/ from builder stage
COPY ha-helper/package*.json /tmp/ha-helper/
COPY --from=builder /build/ha-helper/dist/ /tmp/ha-helper/dist/
RUN npm install -g /tmp/ha-helper && rm -rf /tmp/ha-helper

# Copy compiled server
COPY --from=builder /build/app/dist/ /app/dist/

# Copy bundled frontend
COPY --from=builder /build/app/public/ /app/public/

# Copy static assets
COPY bundled-skills/ /app/bundled-skills/
COPY base-agents.md /app/base-agents.md
COPY run.sh /app/run.sh

RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
