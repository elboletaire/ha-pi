ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-nodejs:22
FROM ${BUILD_FROM}

WORKDIR /app

# Install pi coding agent globally
RUN npm install -g @mariozechner/pi-coding-agent

# Build ha-helper from ha-skillset source
# The ha-skillset source is copied in at build time; once published to npm
# this can be replaced with: npm install -g pi-homeassistant
COPY ha-skillset-src/ /tmp/ha-skillset/
RUN cd /tmp/ha-skillset \
    && npm ci \
    && npm run build \
    && npm install -g .

# Copy compiled server and frontend assets
COPY dist/ /app/dist/
COPY public/ /app/public/
COPY bundled-skills/ /app/bundled-skills/
COPY base-agents.md /app/base-agents.md
COPY run.sh /app/run.sh

RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
