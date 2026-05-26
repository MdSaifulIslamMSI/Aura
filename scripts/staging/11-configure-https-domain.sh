#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
ensure_state

if [ "$ENABLE_STAGING_HTTPS" != "true" ]; then
  log "HTTPS/domain activation skipped. Set ENABLE_STAGING_HTTPS=true after a real staging host points at the EC2 public IP."
  exit 0
fi

need_env AWS_REGION
need_env STAGING_API_HOST
need_env STAGING_ADMIN_EMAIL
[ -f "$STATE_DIR/ssh_config" ] || die "Missing $STATE_DIR/ssh_config. Run 06-render-ssh-config.sh first."

require_no_prod_value "STAGING_API_HOST" "$STAGING_API_HOST" "${PROD_API_BASE_URL:-}"

public_ip="$(state_get public_ip)"
[ -n "$public_ip" ] || die "Missing public_ip in $STATE_FILE. Run 05-launch-ec2.sh first."

resolved_ip="$(resolve_dns_ipv4 "$STAGING_API_HOST" || true)"
[ -n "$resolved_ip" ] || die "STAGING_API_HOST does not resolve: $STAGING_API_HOST"
[ "$resolved_ip" = "$public_ip" ] || die "STAGING_API_HOST resolves to $resolved_ip, expected staging EC2 public IP $public_ip"

wait_for_ssh aura-staging

remote_env="STAGING_API_HOST='$STAGING_API_HOST' STAGING_ADMIN_EMAIL='$STAGING_ADMIN_EMAIL'"
ssh -F "$STATE_DIR/ssh_config" aura-staging "$remote_env bash -s" <<'REMOTE'
set -euo pipefail
install_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y certbot python3-certbot-nginx
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y certbot python3-certbot-nginx
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y certbot python3-certbot-nginx
  else
    echo "Unsupported staging image: cannot install certbot" >&2
    exit 1
  fi
}

install_certbot
sudo nginx -t
sudo certbot --nginx \
  -d "$STAGING_API_HOST" \
  --non-interactive \
  --agree-tos \
  -m "$STAGING_ADMIN_EMAIL" \
  --redirect
sudo nginx -t
sudo systemctl reload nginx
REMOTE

staging_url="https://$STAGING_API_HOST"
state_set staging_api_base_url "$staging_url"
state_set staging_health_url "$staging_url/health"
state_set staging_base_url "${STAGING_BASE_URL:-$staging_url}"
state_set staging_frontend_url "${STAGING_FRONTEND_URL:-$staging_url}"

log "HTTPS is active for isolated staging host $STAGING_API_HOST"
