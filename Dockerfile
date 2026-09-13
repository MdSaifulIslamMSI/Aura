# syntax=docker/dockerfile:1.7

FROM node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS deps

WORKDIR /app/server

COPY server/package*.json ./
COPY server/vendor ./vendor
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS runtime

WORKDIR /app/server

ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=5000 \
    HEALTHCHECK_PATH=/health/live \
    LOG_LEVEL=info

# hadolint ignore=DL3017,DL3018
RUN apk upgrade --no-cache libcrypto3 libssl3 \
    && apk add --no-cache tini yara \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=deps --chown=node:node /app/server/node_modules ./node_modules
COPY --chown=node:node server ./
COPY --chown=node:node shared/assistantCapabilities.json /app/shared/assistantCapabilities.json
COPY --chown=node:node config/desktopAuthLoopback.cjs /app/config/desktopAuthLoopback.cjs
COPY --chown=node:node config/security /app/config/security
RUN mkdir -p uploads /tmp/aura \
    && chown -R node:node uploads /tmp/aura

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "const path=process.env.HEALTHCHECK_PATH||'/health/live'; fetch('http://127.0.0.1:'+(process.env.PORT||5000)+path).then((response)=>{ if(!response.ok) process.exit(1); }).catch(()=>process.exit(1));"

ENTRYPOINT ["tini", "--"]
CMD ["node", "scripts/start_api_runtime.js"]
