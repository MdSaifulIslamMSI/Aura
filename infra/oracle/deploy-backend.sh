#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/aura}"
APP_USER="${APP_USER:-aura}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
SERVICE_NAME="${SERVICE_NAME:-aura-api}"

install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0755 "${APP_ROOT}/server"
install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0755 "${APP_ROOT}/infra/oracle"

chown -R "${APP_USER}:${APP_GROUP}" "${APP_ROOT}/server" "${APP_ROOT}/infra"

sudo -u "${APP_USER}" bash -lc "cd '${APP_ROOT}/server' && npm ci --omit=dev"

systemctl daemon-reload
systemctl restart "${SERVICE_NAME}"
nginx -t
systemctl reload nginx

echo "Deploy complete."
