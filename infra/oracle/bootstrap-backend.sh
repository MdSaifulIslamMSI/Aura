#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/aura}"
APP_USER="${APP_USER:-aura}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
APP_ENV_DIR="${APP_ENV_DIR:-/etc/aura}"
APP_ENV_FILE="${APP_ENV_FILE:-$APP_ENV_DIR/server.env}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/aura/uploads/reviews}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg nginx rsync build-essential

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq '^v22\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0755 "${APP_ROOT}"
install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0755 "${APP_ROOT}/server"
install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0755 "${APP_ROOT}/infra/oracle"
install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0755 "${UPLOAD_DIR}"
install -d -m 0755 "${APP_ENV_DIR}"

rsync -a --delete "${REPO_ROOT}/server/" "${APP_ROOT}/server/"
rsync -a --delete "${REPO_ROOT}/infra/oracle/" "${APP_ROOT}/infra/oracle/"
chown -R "${APP_USER}:${APP_GROUP}" "${APP_ROOT}" "$(dirname "${UPLOAD_DIR}")"

if [[ ! -f "${APP_ENV_FILE}" ]]; then
  cat > "${APP_ENV_FILE}" <<EOF
NODE_ENV=production
PORT=5000
CORS_ORIGIN=https://your-frontend-domain.vercel.app
APP_PUBLIC_URL=https://your-frontend-domain.vercel.app
SPLIT_RUNTIME_ENABLED=true
REDIS_ENABLED=true
REDIS_REQUIRED=true
UPLOAD_STORAGE_DRIVER=local
REVIEW_UPLOAD_DIR=${UPLOAD_DIR}
MONGO_URI=
REDIS_URL=
BYTEZ_API_KEY=
UPLOAD_SIGNING_SECRET=
EOF
  chmod 0600 "${APP_ENV_FILE}"
fi

install -m 0644 "${REPO_ROOT}/infra/oracle/aura-api.service" /etc/systemd/system/aura-api.service
install -m 0644 "${REPO_ROOT}/infra/oracle/nginx-aura-api.conf" /etc/nginx/sites-available/aura-api
ln -sfn /etc/nginx/sites-available/aura-api /etc/nginx/sites-enabled/aura-api
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable aura-api
systemctl enable nginx

sudo -u "${APP_USER}" bash -lc "cd '${APP_ROOT}/server' && npm ci"

nginx -t
systemctl restart nginx

echo "Bootstrap complete."
echo "Next: edit ${APP_ENV_FILE}, then run: sudo systemctl restart aura-api"
