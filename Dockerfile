# ─── Stage 1: build ──────────────────────────────────────────────────────────
# Use a plain node image so this stage is always native (fast on all runners).
# The compiled JS output is arch-agnostic, so no need to cross-compile here.
FROM --platform=linux/amd64 node:22-alpine AS builder

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
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-nodejs:22
FROM ${BUILD_FROM}

WORKDIR /app

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
