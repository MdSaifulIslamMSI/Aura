#!/usr/bin/env bash
set -euo pipefail

dnf update -y
dnf install -y docker jq awscli git tar gzip

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
CORS_ORIGIN=https://aurapilot.vercel.app,https://aura-mdsaifulislammsiss-projects.vercel.app
APP_PUBLIC_URL=https://aurapilot.vercel.app
AUTH_SESSION_COOKIE_SECURE=true
AUTH_SESSION_SAME_SITE=none
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
EOF

touch /opt/aura/shared/runtime-secrets.env
touch /opt/aura/shared/release.env
chmod 600 /opt/aura/shared/base.env /opt/aura/shared/runtime-secrets.env /opt/aura/shared/release.env
