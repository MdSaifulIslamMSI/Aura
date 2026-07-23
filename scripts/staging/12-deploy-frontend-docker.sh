#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_cmd npm
need_cmd tar
need_env AWS_REGION
ensure_state
validate_staging_admin_security_phase

[ -f "$STATE_DIR/ssh_config" ] || die "Missing $STATE_DIR/ssh_config. Run 06-render-ssh-config.sh first."
[ "$STAGING_SSM_PREFIX" = "/aura/staging" ] || die "STAGING_SSM_PREFIX must be /aura/staging"

staging_api_url="$(state_get staging_api_base_url)"
staging_health_url="$(state_get staging_health_url)"
[ -n "$staging_api_url" ] || staging_api_url="${STAGING_API_BASE_URL:-}"
[ -n "$staging_health_url" ] || staging_health_url="${STAGING_HEALTH_URL:-$staging_api_url/health}"
[ -n "$staging_api_url" ] || die "Missing staging API base URL in state or STAGING_API_BASE_URL"
if staging_admin_security_enabled; then
  staging_api_url="$STAGING_API_BASE_URL"
  staging_health_url="$STAGING_HEALTH_URL"
fi

frontend_port="${STAGING_FRONTEND_CONTAINER_PORT:-8080}"
frontend_url="${STAGING_FRONTEND_URL:-$staging_api_url}"
require_no_prod_value STAGING_FRONTEND_URL "$frontend_url" "${PROD_BASE_URL:-}"
require_no_prod_value STAGING_API_BASE_URL "$staging_api_url" "${PROD_API_BASE_URL:-}"

frontend_admin_security_v2=false
if staging_admin_security_frontend_enabled; then
  frontend_admin_security_v2=true
fi
firebase_web_config=""
if staging_admin_security_requires_isolated_firebase; then
  firebase_web_config="$(printf '%s' "$STAGING_FIREBASE_WEB_CONFIG" | node -e 'let input = ""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.stringify(JSON.parse(input))));')"
fi
if staging_admin_security_enabled && [ "${STAGING_FRONTEND_SKIP_BUILD:-false}" = "true" ]; then
  die "STAGING_FRONTEND_SKIP_BUILD=true is not allowed during admin security qualification"
fi

if [ "${STAGING_FRONTEND_SKIP_BUILD:-false}" = "true" ] && [ -f "$REPO_ROOT/app/dist/index.html" ]; then
  log "Using existing app/dist for staging frontend deploy"
else
  log "Building staging frontend with same-origin API proxy"
  (
    cd "$REPO_ROOT/app"
    VITE_API_URL=/api \
    VITE_DEPLOY_TARGET=docker-staging \
    VITE_RELEASE_CHANNEL=staging \
    VITE_ADMIN_SECURITY_STATE_ENGINE_V2="$frontend_admin_security_v2" \
    VITE_FIREBASE_CONFIG="$firebase_web_config" \
    AURA_SKIP_FRONTEND_AUTH_ENV_VALIDATION=true \
    npm run build
  )
fi

node - "$(node_path "$REPO_ROOT/app/dist/index.html")" <<'NODE'
const fs = require('fs');
const indexPath = process.argv[2];
let html = fs.readFileSync(indexPath, 'utf8');
const sanitized = html
  .replace(/\s+https:\/\/dbtrhsolhec1s\.cloudfront\.net\b/g, '')
  .replace(/\s+wss:\/\/dbtrhsolhec1s\.cloudfront\.net\b/g, '');
if (sanitized !== html) {
  fs.writeFileSync(indexPath, sanitized);
}
NODE

node - "$(node_path "$REPO_ROOT/app/dist")" <<'NODE'
const fs = require('fs');
const path = require('path');
const dist = process.argv[2];
const forbidden = [
  'dbtrhsolhec1s.cloudfront.net',
  '/aura/prod',
];
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:html|js|css)$/i.test(entry.name)) files.push(full);
  }
};
walk(dist);
const findings = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const value of forbidden) {
    if (text.includes(value)) findings.push(`${path.relative(dist, file)} contains ${value}`);
  }
}
if (findings.length) {
  console.error('Refusing to deploy staging frontend with production signals:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
NODE

frontend_tar="$STATE_DIR/frontend-dist.tar.gz"
container_nginx="$REPO_ROOT/infra/staging/frontend-container-nginx.conf"
host_nginx="$STATE_DIR/nginx-frontend.conf"

tar -czf "$frontend_tar" -C "$REPO_ROOT/app/dist" .

server_name="$(nginx_staging_server_name "$frontend_url")"
client_max_body_size="${STAGING_CLIENT_MAX_BODY_SIZE:-25m}"
sed \
  -e "s#__STAGING_BACKEND_PORT__#$STAGING_BACKEND_PORT#g" \
  -e "s#__STAGING_FRONTEND_PORT__#$frontend_port#g" \
  -e "s#__SERVER_NAME__#$server_name#g" \
  -e "s#__CLIENT_MAX_BODY_SIZE__#$client_max_body_size#g" \
  "$REPO_ROOT/infra/staging/nginx-frontend.conf.template" > "$host_nginx"

wait_for_ssh aura-staging

scp -F "$STATE_DIR/ssh_config" "$frontend_tar" aura-staging:/tmp/aura-staging-frontend-dist.tar.gz >/dev/null
scp -F "$STATE_DIR/ssh_config" "$container_nginx" aura-staging:/tmp/aura-staging-frontend-container-nginx.conf >/dev/null
scp -F "$STATE_DIR/ssh_config" "$host_nginx" aura-staging:/tmp/aura-staging-host-nginx.conf >/dev/null

remote_env="STAGING_FRONTEND_PORT='$frontend_port'"
ssh -F "$STATE_DIR/ssh_config" aura-staging "$remote_env bash -s" <<'REMOTE'
set -euo pipefail
sudo mkdir -p /opt/aura-staging/frontend-dist
sudo rm -rf /opt/aura-staging/frontend-dist/*
sudo tar -xzf /tmp/aura-staging-frontend-dist.tar.gz -C /opt/aura-staging/frontend-dist
sudo cp /tmp/aura-staging-frontend-container-nginx.conf /opt/aura-staging/frontend-container-nginx.conf
sudo docker rm -f aura-staging-frontend >/dev/null 2>&1 || true
sudo docker pull nginx:alpine >/dev/null
sudo docker run -d \
  --name aura-staging-frontend \
  --restart unless-stopped \
  -p "127.0.0.1:${STAGING_FRONTEND_PORT}:80" \
  -v /opt/aura-staging/frontend-dist:/usr/share/nginx/html:ro \
  -v /opt/aura-staging/frontend-container-nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine >/dev/null
for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${STAGING_FRONTEND_PORT}/" >/dev/null 2>/dev/null; then
    break
  fi
  if [ "$attempt" -eq 20 ]; then
    sudo docker logs --tail=100 aura-staging-frontend >&2 || true
    exit 1
  fi
  sleep 2
done
sudo cp /tmp/aura-staging-host-nginx.conf /etc/nginx/conf.d/aura-staging.conf
sudo nginx -t
sudo systemctl reload nginx
REMOTE

state_set staging_frontend_url "$frontend_url"
log "Docker staging frontend is available at $frontend_url"
log "Backend staging remains $staging_api_url and health remains $staging_health_url"
