# syntax=docker/dockerfile:1.7

FROM node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS deps

WORKDIR /app

RUN apk upgrade --no-cache

COPY server/package*.json ./
COPY server/vendor ./vendor
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# hadolint ignore=DL3018
RUN apk upgrade --no-cache \
    && apk add --no-cache aws-cli yara \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server ./
COPY --chown=node:node shared/assistantCapabilities.json /shared/assistantCapabilities.json
COPY --chown=node:node config/desktopAuthLoopback.cjs /config/desktopAuthLoopback.cjs
RUN mkdir -p uploads && chown -R node:node /app

EXPOSE 5000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "scripts/start_api_runtime.js"]
