#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

install_with_apt() {
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg jq nginx awscli openssl
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if [ "${ENABLE_CERTBOT:-false}" = "true" ]; then
    apt-get install -y certbot python3-certbot-nginx
  fi
}

install_with_dnf() {
  dnf update -y
  dnf install -y docker nginx jq awscli openssl amazon-ssm-agent
  install_buildx
  if ! docker compose version >/dev/null 2>&1; then
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
  if [ "${ENABLE_CERTBOT:-false}" = "true" ]; then
    dnf install -y certbot python3-certbot-nginx || true
  fi
}

install_buildx() {
  local arch buildx_arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64) buildx_arch="amd64" ;;
    aarch64|arm64) buildx_arch="arm64" ;;
    *) echo "Unsupported architecture for Docker Buildx: $arch" >&2; exit 1 ;;
  esac
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-$buildx_arch" -o /usr/local/lib/docker/cli-plugins/docker-buildx
  chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
}

configure_swap() {
  local swap_gb="${STAGING_SWAP_GB:-2}"
  case "$swap_gb" in
    ''|0|false|False|FALSE) return 0 ;;
  esac
  if swapon --show=NAME | grep -qx '/swapfile'; then
    return 0
  fi
  fallocate -l "${swap_gb}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="$((swap_gb * 1024))"
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
}

if command -v apt-get >/dev/null 2>&1; then
  install_with_apt
elif command -v dnf >/dev/null 2>&1; then
  install_with_dnf
elif command -v yum >/dev/null 2>&1; then
  yum update -y
  yum install -y docker nginx curl jq awscli openssl
else
  echo "Unsupported image: no apt, dnf, or yum found" >&2
  exit 1
fi

configure_swap

id aura >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash aura
usermod -aG docker aura || true

mkdir -p /opt/aura-staging/compose /opt/aura-staging/env /opt/aura-staging/logs /opt/aura-staging/src
chown -R aura:aura /opt/aura-staging

systemctl enable --now docker
systemctl enable --now nginx
systemctl enable --now amazon-ssm-agent 2>/dev/null || true

deploy_from_staging_bucket() {
  local bucket prefix backend_port image_loaded
  bucket="$(aws ssm get-parameter --region "${AWS_REGION:-ap-south-1}" --name /aura/staging/S3_BUCKET --query 'Parameter.Value' --output text 2>/dev/null || true)"
  backend_port="$(aws ssm get-parameter --region "${AWS_REGION:-ap-south-1}" --name /aura/staging/BACKEND_PORT --query 'Parameter.Value' --output text 2>/dev/null || true)"
  prefix="${STAGING_BOOTSTRAP_S3_PREFIX:-bootstrap/current}"
  backend_port="${backend_port:-3000}"
  image_loaded=false

  [ -n "$bucket" ] || return 0
  aws s3 cp "s3://$bucket/$prefix/release.tar.gz" /tmp/aura-staging-release.tar.gz || return 0
  aws s3 cp "s3://$bucket/$prefix/aura-staging.env" /tmp/aura-staging.env
  aws s3 cp "s3://$bucket/$prefix/aura-staging-nginx.conf" /tmp/aura-staging-nginx.conf
  if aws s3 cp "s3://$bucket/$prefix/backend-image.tar.gz" /tmp/aura-staging-backend-image.tar.gz; then
    gzip -dc /tmp/aura-staging-backend-image.tar.gz | docker load
    image_loaded=true
  fi

  rm -rf /opt/aura-staging/src
  mkdir -p /opt/aura-staging/src /opt/aura-staging/logs
  tar -xzf /tmp/aura-staging-release.tar.gz -C /opt/aura-staging/src
  cp /tmp/aura-staging.env /opt/aura-staging/src/infra/staging/.env.staging
  cp /tmp/aura-staging.env /opt/aura-staging/src/infra/staging/.env
  chmod 600 /opt/aura-staging/src/infra/staging/.env.staging /opt/aura-staging/src/infra/staging/.env
  chown -R aura:aura /opt/aura-staging

  cd /opt/aura-staging/src/infra/staging
  if [ "$image_loaded" = "true" ]; then
    docker compose pull postgres mongo redis scanner || true
    docker compose up -d --no-build
  else
    docker compose build backend
    docker compose up -d
  fi
  docker compose ps
  for attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${backend_port}/health" > /opt/aura-staging/logs/local-health.json; then
      break
    fi
    if [ "$attempt" -eq 30 ]; then
      docker compose logs --tail=160 backend >&2 || true
      return 1
    fi
    sleep 5
  done
  cp /tmp/aura-staging-nginx.conf /etc/nginx/conf.d/aura-staging.conf
  nginx -t
  systemctl reload nginx
}

deploy_from_staging_bucket > /opt/aura-staging/logs/cloud-init-deploy.log 2>&1 || {
  echo "staging deploy failed; see /opt/aura-staging/logs/cloud-init-deploy.log" >&2
}

if [ -f /etc/ssh/sshd_config ]; then
  sed -i 's/^[#[:space:]]*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true
fi
