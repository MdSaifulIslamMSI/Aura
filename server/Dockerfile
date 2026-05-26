FROM node:22-alpine AS deps

WORKDIR /app

RUN apk upgrade --no-cache \
    && npm install -g npm@11.6.2

COPY package*.json ./
COPY vendor ./vendor
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# hadolint ignore=DL3018
RUN apk upgrade --no-cache \
    && apk add --no-cache yara \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p uploads && chown -R node:node /app

EXPOSE 5000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "scripts/start_api_runtime.js"]
