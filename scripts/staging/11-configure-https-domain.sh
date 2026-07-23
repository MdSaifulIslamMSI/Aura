#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
ensure_state
validate_staging_https_mode

if [ "$ENABLE_STAGING_HTTPS" != "true" ]; then
  log "HTTPS activation skipped. Set ENABLE_STAGING_HTTPS=true after the staging HTTPS prerequisites exist."
  exit 0
fi

need_env AWS_REGION
need_env STAGING_API_HOST
require_dns_hostname STAGING_API_HOST "$STAGING_API_HOST"
[ -f "$STATE_DIR/ssh_config" ] || die "Missing $STATE_DIR/ssh_config. Run 06-render-ssh-config.sh first."

require_no_prod_value "STAGING_API_HOST" "$STAGING_API_HOST" "${PROD_API_BASE_URL:-}"

public_ip="$(state_get public_ip)"
[ -n "$public_ip" ] || die "Missing public_ip in $STATE_FILE. Run 05-launch-ec2.sh first."

configure_origin_tls() {
  local origin_host="$1"
  local resolved_ip
  resolved_ip="$(resolve_dns_ipv4 "$origin_host" || true)"
  [ -n "$resolved_ip" ] || die "Staging TLS origin does not resolve: $origin_host"
  [ "$resolved_ip" = "$public_ip" ] || die "Staging TLS origin resolves to $resolved_ip, expected staging EC2 public IP $public_ip"

  wait_for_ssh aura-staging

  require_dns_hostname STAGING_ORIGIN_HOST "$origin_host"
  printf -v remote_env 'STAGING_ORIGIN_HOST=%q STAGING_CERT_CONTACT_EMAIL=%q' "$origin_host" "${STAGING_ADMIN_EMAIL:-}"
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
certbot_args=(
  --nginx
  -d "$STAGING_ORIGIN_HOST"
  --non-interactive
  --agree-tos
  --redirect
  --keep-until-expiring
)
if [ -n "$STAGING_CERT_CONTACT_EMAIL" ]; then
  certbot_args+=(--email "$STAGING_CERT_CONTACT_EMAIL")
else
  certbot_args+=(--register-unsafely-without-email)
fi
sudo certbot "${certbot_args[@]}"
sudo nginx -t
sudo systemctl reload nginx
if systemctl list-unit-files certbot-renew.timer --no-legend 2>/dev/null | grep -q '^certbot-renew.timer'; then
  sudo systemctl enable --now certbot-renew.timer >/dev/null
elif systemctl list-unit-files certbot.timer --no-legend 2>/dev/null | grep -q '^certbot.timer'; then
  sudo systemctl enable --now certbot.timer >/dev/null
else
  echo 'Certbot renewal timer is unavailable' >&2
  exit 1
fi
REMOTE
}

if [ "$STAGING_HTTPS_MODE" = "direct" ]; then
  need_env STAGING_ADMIN_EMAIL
  configure_origin_tls "$STAGING_API_HOST"
  staging_url="https://$STAGING_API_HOST"
  state_set staging_api_base_url "$staging_url"
  state_set staging_health_url "$staging_url/health"
  state_set staging_base_url "${STAGING_BASE_URL:-$staging_url}"
  state_set staging_frontend_url "${STAGING_FRONTEND_URL:-$staging_url}"
  log "HTTPS is active for isolated staging host $STAGING_API_HOST"
  exit 0
fi

need_env STAGING_ORIGIN_HOST
need_env STAGING_CLOUDFRONT_DISTRIBUTION_ID
case "$STAGING_API_HOST" in
  d*.cloudfront.net) ;;
  *) die "STAGING_API_HOST must be a dedicated CloudFront hostname in cloudfront mode" ;;
esac
require_no_prod_value "STAGING_ORIGIN_HOST" "$STAGING_ORIGIN_HOST" "${PROD_API_BASE_URL:-}"

configure_origin_tls "$STAGING_ORIGIN_HOST"

distribution_domain="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DomainName' \
  --output text)"
[ "$distribution_domain" = "$STAGING_API_HOST" ] || die "CloudFront distribution hostname does not match STAGING_API_HOST"

distribution_status="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.Status' \
  --output text)"
distribution_enabled="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DistributionConfig.Enabled' \
  --output text | tr '[:upper:]' '[:lower:]')"
origin_domain="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DistributionConfig.Origins.Items[0].DomainName' \
  --output text)"
origin_protocol="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DistributionConfig.Origins.Items[0].CustomOriginConfig.OriginProtocolPolicy' \
  --output text)"
viewer_protocol="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy' \
  --output text)"
cache_policy="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DistributionConfig.DefaultCacheBehavior.CachePolicyId' \
  --output text)"
origin_request_policy="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DistributionConfig.DefaultCacheBehavior.OriginRequestPolicyId' \
  --output text)"
default_certificate="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DistributionConfig.ViewerCertificate.CloudFrontDefaultCertificate' \
  --output text | tr '[:upper:]' '[:lower:]')"
alias_count="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query 'Distribution.DistributionConfig.Aliases.Quantity' \
  --output text)"
origin_header_value="$(aws_cli cloudfront get-distribution \
  --id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" \
  --query "Distribution.DistributionConfig.Origins.Items[0].CustomHeaders.Items[?HeaderName=='X-Aura-Origin-Verify'].HeaderValue | [0]" \
  --output text)"
ssm_origin_secret="$(aws_cli ssm get-parameter \
  --region "$AWS_REGION" \
  --name "$STAGING_SSM_PREFIX/AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)"

[ "$distribution_status" = "Deployed" ] || die "CloudFront distribution is not deployed"
[ "$distribution_enabled" = "true" ] || die "CloudFront distribution is not enabled"
[ "$origin_domain" = "$STAGING_ORIGIN_HOST" ] || die "CloudFront origin does not match STAGING_ORIGIN_HOST"
[ "$origin_protocol" = "https-only" ] || die "CloudFront staging origin must use HTTPS only"
[ "$viewer_protocol" = "redirect-to-https" ] || die "CloudFront viewers must be redirected to HTTPS"
[ "$cache_policy" = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" ] || die "CloudFront staging traffic must use the managed CachingDisabled policy"
[ "$origin_request_policy" = "b689b0a8-53d0-40ab-baf2-68738e2966ac" ] || die "CloudFront staging traffic must use AllViewerExceptHostHeader"
[ "$default_certificate" = "true" ] || die "CloudFront staging must use the AWS-managed default certificate"
[ "$alias_count" = "0" ] || die "CloudFront staging must not attach a paid or external domain alias"
[ -n "$origin_header_value" ] && [ "$origin_header_value" != "None" ] || die "CloudFront staging origin verification header is missing"
[ "$origin_header_value" = "$ssm_origin_secret" ] || die "CloudFront and staging Parameter Store origin secrets do not match"
[ "${#ssm_origin_secret}" -ge 32 ] || die "CloudFront staging origin secret is not strong enough"

distribution_arn="arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${STAGING_CLOUDFRONT_DISTRIBUTION_ID}"
environment_tag="$(aws_cli cloudfront list-tags-for-resource \
  --resource "$distribution_arn" \
  --query "Tags.Items[?Key=='Environment'].Value | [0]" \
  --output text)"
managed_by_tag="$(aws_cli cloudfront list-tags-for-resource \
  --resource "$distribution_arn" \
  --query "Tags.Items[?Key=='ManagedBy'].Value | [0]" \
  --output text)"
assert_staging_tags "$STAGING_CLOUDFRONT_DISTRIBUTION_ID" "$environment_tag" "$managed_by_tag"

wait_for_cloudfront_deployed "$STAGING_CLOUDFRONT_DISTRIBUTION_ID"
staging_url="https://$STAGING_API_HOST"
retry 30 10 curl --fail --silent --show-error --max-time 15 "$staging_url/health" >/dev/null

state_set cloudfront_distribution_id "$STAGING_CLOUDFRONT_DISTRIBUTION_ID"
state_set staging_origin_host "$STAGING_ORIGIN_HOST"
state_set staging_api_base_url "$staging_url"
state_set staging_health_url "$staging_url/health"
state_set staging_base_url "$staging_url"
state_set staging_frontend_url "$staging_url"

log "AWS-managed HTTPS is active for isolated staging host $STAGING_API_HOST"
