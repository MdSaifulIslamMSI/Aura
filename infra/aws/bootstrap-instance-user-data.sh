#!/usr/bin/env bash
set -euo pipefail

dnf update -y
dnf install -y docker docker-compose-plugin jq awscli curl git tar gzip

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
CORS_ORIGIN=https://your-vercel-project.vercel.app
APP_PUBLIC_URL=https://your-vercel-project.vercel.app
AUTH_SESSION_COOKIE_SECURE=true
AUTH_SESSION_SAME_SITE=none
EOF

touch /opt/aura/shared/runtime-secrets.env
touch /opt/aura/shared/release.env
chmod 600 /opt/aura/shared/base.env /opt/aura/shared/runtime-secrets.env /opt/aura/shared/release.env
