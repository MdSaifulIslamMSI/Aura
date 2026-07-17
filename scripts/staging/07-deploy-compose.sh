#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_cmd git
need_cmd tar
need_env AWS_REGION
ensure_state

[ -f "$STATE_DIR/ssh_config" ] || die "Missing $STATE_DIR/ssh_config. Run 06-render-ssh-config.sh first."
if [ -z "${STAGING_BACKEND_IMAGE:-}" ] && [ ! -f "$REPO_ROOT/server/Dockerfile" ]; then
  die "Missing Dockerfile or STAGING_BACKEND_IMAGE. Provide one."
fi
backend_image="${STAGING_BACKEND_IMAGE:-aura-staging-backend:local}"
build_backend_locally="${STAGING_BUILD_BACKEND_LOCALLY:-}"
if [ -z "$build_backend_locally" ]; then
  if [ -z "${STAGING_BACKEND_IMAGE:-}" ]; then
    build_backend_locally=true
  else
    build_backend_locally=false
  fi
fi
if [ "$build_backend_locally" = "true" ]; then
  need_cmd docker
  need_cmd gzip
fi

ssm_get() {
  local name="$1"
  aws_cli ssm get-parameter --region "$AWS_REGION" --name "$STAGING_SSM_PREFIX/$name" --with-decryption --query 'Parameter.Value' --output text
}

ssm_get_optional() {
  local name="$1"
  aws_cli ssm get-parameter --region "$AWS_REGION" --name "$STAGING_SSM_PREFIX/$name" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || true
}

append_env_if_set() {
  local key="$1"
  local value="${2:-}"
  [ -n "$value" ] || return 0
  printf '%s=%s\n' "$key" "$value" >> "$env_file"
}

staging_api_url="$(state_get staging_api_base_url)"
staging_base_url="$(state_get staging_base_url)"
staging_health_url="$(state_get staging_health_url)"
bucket="$(state_get bucket)"
[ -n "$bucket" ] || bucket="$STAGING_BUCKET_NAME"

database_url="$(ssm_get DATABASE_URL)"
mongo_uri="$(ssm_get MONGO_URI)"
jwt_secret="$(ssm_get JWT_SECRET)"
postgres_password="$(ssm_get POSTGRES_PASSWORD)"
otp_flow_secret="$(ssm_get OTP_FLOW_SECRET)"
otp_challenge_secret="$(ssm_get OTP_CHALLENGE_SECRET)"
upload_signing_secret="$(ssm_get UPLOAD_SIGNING_SECRET)"
auth_vault_secret="$(ssm_get AUTH_VAULT_SECRET)"
duo_enabled="$(ssm_get_optional DUO_ENABLED)"
duo_client_id="$(ssm_get_optional DUO_CLIENT_ID)"
duo_client_secret="$(ssm_get_optional DUO_CLIENT_SECRET)"
duo_api_host="$(ssm_get_optional DUO_API_HOST)"
duo_oidc_issuer="$(ssm_get_optional DUO_OIDC_ISSUER)"
duo_discovery_url="$(ssm_get_optional DUO_DISCOVERY_URL)"
duo_redirect_uri="$(ssm_get_optional DUO_REDIRECT_URI)"
duo_oidc_state_secret="$(ssm_get_optional DUO_OIDC_STATE_SECRET)"
duo_fail_closed="$(ssm_get_optional DUO_FAIL_CLOSED)"
cors_origin="${STAGING_CORS_ORIGIN:-$staging_base_url}"

env_file="$STATE_DIR/.env.staging"
cat > "$env_file" <<ENV
APP_ENV=staging
NODE_ENV=production
FIREBASE_PROJECT_ID=aura-staging-smoke
STAGING_ALLOW_FIREBASE_ADMIN_STUB=true
PAYMENTS_ENABLED=false
PAYMENT_WEBHOOKS_ENABLED=false
PAYMENT_CHALLENGE_ENABLED=false
OTP_SMS_ENABLED=false
ORDER_EMAILS_ENABLED=false
REDIS_ENABLED=true
DISTRIBUTED_SECURITY_CONTROLS_ENABLED=false
AUTH_DEVICE_CHALLENGE_MODE=off
PORT=$STAGING_BACKEND_PORT
BACKEND_PORT=$STAGING_BACKEND_PORT
STAGING_SSM_PREFIX=$STAGING_SSM_PREFIX
AWS_PARAMETER_STORE_PATH_PREFIX=$STAGING_SSM_PREFIX
AWS_REGION=$AWS_REGION
S3_BUCKET=$bucket
AWS_S3_BUCKET=$bucket
DATABASE_URL=$database_url
MONGO_URI=$mongo_uri
MONGO_REQUIRE_TLS=false
REDIS_URL=redis://redis:6379
POSTGRES_PASSWORD=$postgres_password
JWT_SECRET=$jwt_secret
OTP_FLOW_SECRET=$otp_flow_secret
OTP_CHALLENGE_SECRET=$otp_challenge_secret
UPLOAD_SIGNING_SECRET=$upload_signing_secret
AUTH_VAULT_SECRET=$auth_vault_secret
AUTH_VAULT_SECRET_VERSION=staging-v1
CORS_ORIGIN=$cors_origin
STAGING_BASE_URL=$staging_base_url
STAGING_API_BASE_URL=$staging_api_url
STAGING_HEALTH_URL=$staging_health_url
UPLOAD_MALWARE_SCAN_ENABLED=true
UPLOAD_MALWARE_SCAN_FAIL_CLOSED=true
CLAMAV_ENABLED=true
CLAMAV_HOST=scanner
CLAMAV_PORT=3310
UPLOAD_SCANNER_HOST=scanner
UPLOAD_SCANNER_PORT=3310
STAGING_BACKEND_PORT=$STAGING_BACKEND_PORT
STAGING_BACKEND_IMAGE=$backend_image
ENV
append_env_if_set DUO_ENABLED "$duo_enabled"
append_env_if_set DUO_CLIENT_ID "$duo_client_id"
append_env_if_set DUO_CLIENT_SECRET "$duo_client_secret"
append_env_if_set DUO_API_HOST "$duo_api_host"
append_env_if_set DUO_OIDC_ISSUER "$duo_oidc_issuer"
append_env_if_set DUO_DISCOVERY_URL "$duo_discovery_url"
append_env_if_set DUO_REDIRECT_URI "$duo_redirect_uri"
append_env_if_set DUO_OIDC_STATE_SECRET "$duo_oidc_state_secret"
append_env_if_set DUO_FAIL_CLOSED "$duo_fail_closed"
chmod 600 "$env_file"

release_tar="$STATE_DIR/release.tar.gz"
backend_image_tar="$STATE_DIR/backend-image.tar.gz"
tar \
  --exclude='server/.assistant' \
  --exclude='server/.codex-runtime' \
  --exclude='server/.env' \
  --exclude='server/.env.*' \
  --exclude='server/.mongodb-binaries' \
  --exclude='server/.vercel' \
  --exclude='server/coverage' \
  --exclude='server/data/catalog_1m.jsonl' \
  --exclude='server/dev-server.log' \
  --exclude='server/evals' \
  --exclude='server/node_modules' \
  --exclude='server/tests' \
  --exclude='server/uploads' \
  --exclude='server/*.log' \
  --exclude='server/*.err.log' \
  --exclude='server/*.out.log' \
  -czf "$release_tar" \
  -C "$REPO_ROOT" \
  server \
  shared \
  infra/staging

if [ "$build_backend_locally" = "true" ]; then
  log "Building staging backend Docker image locally as $backend_image"
  docker build -f "$(node_path "$REPO_ROOT/server/Dockerfile")" -t "$backend_image" "$(node_path "$REPO_ROOT")"
  log "Saving staging backend Docker image artifact"
  docker save "$backend_image" | gzip -c > "$backend_image_tar"
fi

nginx_rendered="$STATE_DIR/nginx.conf"
server_name="$(nginx_staging_server_name "$staging_api_url")"
client_max_body_size="${STAGING_CLIENT_MAX_BODY_SIZE:-25m}"
sed \
  -e "s#__STAGING_BACKEND_PORT__#$STAGING_BACKEND_PORT#g" \
  -e "s#__SERVER_NAME__#$server_name#g" \
  -e "s#__CLIENT_MAX_BODY_SIZE__#$client_max_body_size#g" \
  "$REPO_ROOT/infra/staging/nginx.conf.template" > "$nginx_rendered"

aws_cli s3 cp "$(node_path "$release_tar")" "s3://$bucket/bootstrap/current/release.tar.gz" --region "$AWS_REGION" >/dev/null
aws_cli s3 cp "$(node_path "$env_file")" "s3://$bucket/bootstrap/current/aura-staging.env" --region "$AWS_REGION" >/dev/null
aws_cli s3 cp "$(node_path "$nginx_rendered")" "s3://$bucket/bootstrap/current/aura-staging-nginx.conf" --region "$AWS_REGION" >/dev/null
if [ -f "$backend_image_tar" ]; then
  aws_cli s3 cp "$(node_path "$backend_image_tar")" "s3://$bucket/bootstrap/current/backend-image.tar.gz" --region "$AWS_REGION" >/dev/null
fi
log "Uploaded staging bootstrap artifacts to s3://$bucket/bootstrap/current"

wait_for_ssh aura-staging

scp -F "$STATE_DIR/ssh_config" "$release_tar" aura-staging:/tmp/aura-staging-release.tar.gz >/dev/null
scp -F "$STATE_DIR/ssh_config" "$env_file" aura-staging:/tmp/aura-staging.env >/dev/null
scp -F "$STATE_DIR/ssh_config" "$nginx_rendered" aura-staging:/tmp/aura-staging-nginx.conf >/dev/null
if [ -f "$backend_image_tar" ]; then
  scp -F "$STATE_DIR/ssh_config" "$backend_image_tar" aura-staging:/tmp/aura-staging-backend-image.tar.gz >/dev/null
fi

remote_env="STAGING_BACKEND_IMAGE='$backend_image' STAGING_BACKEND_PORT='$STAGING_BACKEND_PORT' ENABLE_CERTBOT='$ENABLE_CERTBOT' STAGING_API_HOST='${STAGING_API_HOST:-}' STAGING_ADMIN_EMAIL='${STAGING_ADMIN_EMAIL:-}'"

ssh -F "$STATE_DIR/ssh_config" aura-staging "$remote_env bash -s" <<'REMOTE'
set -euo pipefail
install_runtime() {
  buildx_is_new_enough() {
    local version major minor
    version="$(docker buildx version 2>/dev/null | awk '{print $2}' | sed 's/^v//')"
    major="${version%%.*}"
    minor="${version#*.}"
    minor="${minor%%.*}"
    [ -n "$major" ] && [ -n "$minor" ] || return 1
    [ "$major" -gt 0 ] || [ "$minor" -ge 17 ]
  }

  install_buildx() {
    local arch buildx_arch
    arch="$(uname -m)"
    case "$arch" in
      x86_64) buildx_arch="amd64" ;;
      aarch64|arm64) buildx_arch="arm64" ;;
      *) echo "Unsupported architecture for Docker Buildx: $arch" >&2; exit 1 ;;
    esac
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-$buildx_arch" -o /tmp/docker-buildx
    sudo mv /tmp/docker-buildx /usr/local/lib/docker/cli-plugins/docker-buildx
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
  }

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && command -v nginx >/dev/null 2>&1; then
    buildx_is_new_enough || install_buildx
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg jq nginx awscli openssl
    sudo install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      sudo chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y docker nginx jq awscli openssl amazon-ssm-agent
    if ! docker compose version >/dev/null 2>&1; then
      sudo mkdir -p /usr/local/lib/docker/cli-plugins
      curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" -o /tmp/docker-compose
      sudo mv /tmp/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
      sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    fi
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y docker nginx curl jq awscli openssl
  else
    echo "Unsupported staging image: no apt, dnf, or yum found" >&2
    exit 1
  fi

  sudo systemctl enable --now docker
  sudo systemctl enable --now nginx
  sudo systemctl enable --now amazon-ssm-agent 2>/dev/null || true
  buildx_is_new_enough || install_buildx
}

install_runtime
if ! id aura >/dev/null 2>&1; then
  sudo useradd --system --create-home --shell /bin/bash aura
fi
sudo usermod -aG docker aura || true
sudo mkdir -p /opt/aura-staging/src /opt/aura-staging/logs
sudo rm -rf /opt/aura-staging/src
sudo mkdir -p /opt/aura-staging/src
sudo tar -xzf /tmp/aura-staging-release.tar.gz -C /opt/aura-staging/src
sudo cp /tmp/aura-staging.env /opt/aura-staging/src/infra/staging/.env.staging
sudo cp /tmp/aura-staging.env /opt/aura-staging/src/infra/staging/.env
sudo chmod 600 /opt/aura-staging/src/infra/staging/.env.staging
sudo chmod 600 /opt/aura-staging/src/infra/staging/.env
sudo chown -R aura:aura /opt/aura-staging
cd /opt/aura-staging/src/infra/staging
backend_image_loaded=false
if [ -f /tmp/aura-staging-backend-image.tar.gz ]; then
  gzip -dc /tmp/aura-staging-backend-image.tar.gz | sudo docker load
  backend_image_loaded=true
fi
if [ "$backend_image_loaded" = "true" ]; then
  sudo docker compose pull postgres mongo redis scanner || true
  sudo docker compose up -d --no-build
elif [ -n "$STAGING_BACKEND_IMAGE" ]; then
  sudo docker compose pull || true
  sudo docker compose up -d --no-build
else
  sudo docker compose build backend
sudo docker compose up -d
fi
sudo docker compose ps
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${STAGING_BACKEND_PORT}/health" >/tmp/aura-staging-local-health.json 2>/dev/null; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    sudo docker compose logs --tail=160 backend >&2 || true
    exit 1
  fi
  sleep 5
done
sudo cp /tmp/aura-staging-nginx.conf /etc/nginx/conf.d/aura-staging.conf
sudo nginx -t
sudo systemctl reload nginx
if [ "$ENABLE_CERTBOT" = "true" ]; then
  [ -n "$STAGING_API_HOST" ] || { echo "STAGING_API_HOST is required for Certbot" >&2; exit 1; }
  [ -n "$STAGING_ADMIN_EMAIL" ] || { echo "STAGING_ADMIN_EMAIL is required for Certbot" >&2; exit 1; }
  sudo certbot --nginx -d "$STAGING_API_HOST" --non-interactive --agree-tos -m "$STAGING_ADMIN_EMAIL"
fi
REMOTE

log "Compose deployment completed without printing secret values"
