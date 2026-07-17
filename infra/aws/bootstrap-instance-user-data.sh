#!/usr/bin/env bash
set -euo pipefail

dnf update -y
dnf install -y docker jq awscli git tar gzip util-linux

mkdir -p /usr/local/lib/docker/cli-plugins
compose_arch="x86_64"
if [[ "$(uname -m)" == "aarch64" ]]; then
  compose_arch="aarch64"
fi
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${compose_arch}" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

systemctl enable --now docker
usermod -aG docker ec2-user || true

if ! swapon --show | grep -q '/swapfile'; then
  if ! fallocate -l 2G /swapfile 2>/dev/null; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi

mkdir -p /opt/aura/current /opt/aura/releases /opt/aura/shared

cat > /opt/aura/shared/base.env <<'EOF'
NODE_ENV=production
PORT=5000
WORKER_HEALTH_PORT=8080
SPLIT_RUNTIME_ENABLED=true
REDIS_ENABLED=true
REDIS_REQUIRED=true
REDIS_URL=redis://redis:6379
UPLOAD_STORAGE_DRIVER=s3
AWS_REGION=ap-south-1
AWS_PARAMETER_STORE_ENABLED=true
AWS_PARAMETER_STORE_PATH_PREFIX=/aura/prod
AWS_S3_REVIEW_BUCKET=replace-with-your-media-bucket
AWS_S3_REVIEW_PREFIX=review-media
CORS_ORIGIN=https://aurapilot.vercel.app,https://aurapilot.netlify.app,https://aura-mdsaifulislammsiss-projects.vercel.app
APP_PUBLIC_URL=https://aurapilot.vercel.app
AURA_BACKEND_PUBLIC_HOST=api.aurapilot.example.com
AUTH_SESSION_COOKIE_SECURE=true
AUTH_SESSION_SAME_SITE=none
AUTH_SESSION_ALLOW_MEMORY_FALLBACK=false
AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK=true
AUTH_WEBAUTHN_RP_ID=aurapilot.vercel.app
AUTH_WEBAUTHN_ORIGIN=https://aurapilot.vercel.app
AUTH_WEBAUTHN_USER_VERIFICATION=required
AUTH_RISK_IP_DENYLIST=
AUTH_RISK_IP_WATCHLIST=
PAYMENTS_ENABLED=false
PAYMENT_WEBHOOKS_ENABLED=false
PAYMENT_SAVED_METHODS_ENABLED=false
PAYMENT_REFUNDS_ENABLED=false
PAYMENT_DYNAMIC_ROUTING_ENABLED=false
PAYMENT_CHALLENGE_ENABLED=false
OTP_SMS_ENABLED=false
OTP_WHATSAPP_ENABLED=false
ORDER_EMAILS_ENABLED=false
ORDER_EMAIL_PROVIDER=disabled
COMPOSE_PROFILES=
AI_MODEL_PROVIDER=disabled
AI_MODEL_PROVIDER_FALLBACKS=
ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA=false
ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED=false
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_CHAT_MODEL=llama3.2:1b
OLLAMA_CHAT_MODEL_FALLBACKS=
OLLAMA_EMBED_MODEL=all-minilm
OLLAMA_TIMEOUT_MS=180000
OLLAMA_KEEP_ALIVE=15m
OLLAMA_CONTEXT_LENGTH=1024
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=2
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_NO_CLOUD=1
EOF

metadata_token="$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' || true)"
instance_public_ipv4=""
if [[ -n "${metadata_token}" ]]; then
  instance_public_ipv4="$(curl -fsS -H "X-aws-ec2-metadata-token: ${metadata_token}" http://169.254.169.254/latest/meta-data/public-ipv4 || true)"
fi

if [[ -n "${instance_public_ipv4}" ]]; then
  sed -i "s/^AURA_BACKEND_PUBLIC_HOST=.*/AURA_BACKEND_PUBLIC_HOST=${instance_public_ipv4}.sslip.io/" /opt/aura/shared/base.env
else
  echo "# AURA_BACKEND_PUBLIC_HOST remains the checked-in placeholder until DNS is assigned." >> /opt/aura/shared/base.env
fi

echo "# Deterministic commerce assistant mode is the production default; no model provider or Compose model profile is enabled." >> /opt/aura/shared/base.env
echo "# Re-enabling a model requires an explicit reviewed release contract change." >> /opt/aura/shared/base.env

touch /opt/aura/shared/runtime-secrets.env
touch /opt/aura/shared/release.env
chmod 600 /opt/aura/shared/base.env /opt/aura/shared/runtime-secrets.env /opt/aura/shared/release.env
