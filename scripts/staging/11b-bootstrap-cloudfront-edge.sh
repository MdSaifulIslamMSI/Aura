#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
ensure_state
need_cmd aws
need_cmd base64
need_cmd curl
need_cmd node
need_cmd openssl
need_env AWS_REGION

distribution_comment="Aura isolated staging HTTPS edge"
cache_policy_id="4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
origin_request_policy_id="b689b0a8-53d0-40ab-baf2-68738e2966ac"
response_headers_policy_id="67f7725c-6f97-4210-82d7-5512b31e9d03"
origin_secret_name="$STAGING_SSM_PREFIX/AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET"

caller_account="$(aws_cli sts get-caller-identity --query 'Account' --output text)"
if [ -n "${AWS_ACCOUNT_ID:-}" ] && [ "$AWS_ACCOUNT_ID" != "$caller_account" ]; then
  die "AWS_ACCOUNT_ID does not match the active AWS caller"
fi
AWS_ACCOUNT_ID="$caller_account"
export AWS_ACCOUNT_ID

instance_count="$(aws_cli ec2 describe-instances \
  --region "$AWS_REGION" \
  --filters \
    "Name=tag:Project,Values=$PROJECT_NAME" \
    "Name=tag:Environment,Values=staging" \
    "Name=tag:ManagedBy,Values=codex-staging-bootstrap" \
    "Name=instance-state-name,Values=running" \
  --query 'length(Reservations[].Instances[])' \
  --output text)"
[ "$instance_count" = "1" ] || die "Expected exactly one running, tagged staging EC2 instance; found $instance_count"

instance_id="$(aws_cli ec2 describe-instances \
  --region "$AWS_REGION" \
  --filters \
    "Name=tag:Project,Values=$PROJECT_NAME" \
    "Name=tag:Environment,Values=staging" \
    "Name=tag:ManagedBy,Values=codex-staging-bootstrap" \
    "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)"
public_ip="$(aws_cli ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$instance_id" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)"
public_dns="$(aws_cli ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$instance_id" \
  --query 'Reservations[0].Instances[0].PublicDnsName' \
  --output text)"
[ -n "$public_ip" ] && [ "$public_ip" != "None" ] || die "Staging EC2 does not have a public IPv4 address"
[ -n "$public_dns" ] && [ "$public_dns" != "None" ] || die "Staging EC2 does not have a public DNS name"

default_origin_host="${public_ip//./-}.sslip.io"
origin_host="${STAGING_ORIGIN_HOST:-$default_origin_host}"
require_dns_hostname STAGING_ORIGIN_HOST "$origin_host"
require_no_prod_value "STAGING_ORIGIN_HOST" "$origin_host" "${PROD_API_BASE_URL:-}"
case "$origin_host" in
  *.cloudfront.net|*.compute.amazonaws.com) die "STAGING_ORIGIN_HOST must be a separate public TLS hostname" ;;
esac
resolved_ip="$(resolve_dns_ipv4 "$origin_host" || true)"
[ "$resolved_ip" = "$public_ip" ] || die "STAGING_ORIGIN_HOST must resolve exactly to the staging EC2 public IP"

if [ "${STAGING_CLOUDFRONT_DRY_RUN:-false}" = "true" ]; then
  existing_count="$(aws_cli cloudfront list-distributions \
    --query "length(DistributionList.Items[?Comment=='$distribution_comment'])" \
    --output text)"
  case "$existing_count" in
    0|1) ;;
    *) die "Found multiple CloudFront distributions with the isolated staging comment" ;;
  esac
  log "CloudFront staging dry-run passed without mutation"
  printf 'STAGING_INSTANCE_ID=%s\n' "$instance_id"
  printf 'STAGING_ORIGIN_HOST=%s\n' "$origin_host"
  printf 'EXISTING_STAGING_DISTRIBUTIONS=%s\n' "$existing_count"
  exit 0
fi

log "Configuring free TLS on the isolated staging origin"
origin_host_escaped="$(printf '%q' "$origin_host")"
certificate_email_escaped="$(printf '%q' "${STAGING_ADMIN_EMAIL:-}")"
remote_script="$(cat <<REMOTE
set -euo pipefail
origin_host=$origin_host_escaped
certificate_email=$certificate_email_escaped
if ! command -v certbot >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y certbot python3-certbot-nginx
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y certbot python3-certbot-nginx
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y certbot python3-certbot-nginx
  else
    echo 'Unsupported staging image: cannot install certbot' >&2
    exit 1
  fi
fi
nginx_file=/etc/nginx/conf.d/aura-staging.conf
test -f "\$nginx_file"
sudo cp -an "\$nginx_file" "\${nginx_file}.pre-cloudfront-tls" || true
sudo sed -i -E "s/^[[:space:]]*server_name[[:space:]]+[^;]+;/    server_name \$origin_host;/" "\$nginx_file"
sudo nginx -t
certbot_args=(--nginx -d "\$origin_host" --non-interactive --agree-tos --redirect --keep-until-expiring)
if [ -n "\$certificate_email" ]; then
  certbot_args+=(--email "\$certificate_email")
else
  certbot_args+=(--register-unsafely-without-email)
fi
sudo certbot "\${certbot_args[@]}"
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
)"
encoded_remote_script="$(printf '%s' "$remote_script" | base64 | tr -d '\r\n')"
remote_command="echo $encoded_remote_script | base64 -d | bash"
ssm_parameters="$(node -e 'process.stdout.write(JSON.stringify({ commands: [process.argv[1]] }))' "$remote_command")"
command_id="$(aws_cli ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$instance_id" \
  --document-name AWS-RunShellScript \
  --parameters "$ssm_parameters" \
  --query 'Command.CommandId' \
  --output text)"
[ -n "$command_id" ] && [ "$command_id" != "None" ] || die "Could not start the staging origin TLS command"

command_status="Pending"
for _ in $(seq 1 90); do
  command_status="$(aws_cli ssm get-command-invocation \
    --region "$AWS_REGION" \
    --command-id "$command_id" \
    --instance-id "$instance_id" \
    --query 'Status' \
    --output text 2>/dev/null || true)"
  case "$command_status" in
    Success) break ;;
    Failed|Cancelled|TimedOut) break ;;
  esac
  sleep 5
done
if [ "$command_status" != "Success" ]; then
  aws_cli ssm get-command-invocation \
    --region "$AWS_REGION" \
    --command-id "$command_id" \
    --instance-id "$instance_id" \
    --query '{Status:Status,StatusDetails:StatusDetails,StandardErrorContent:StandardErrorContent}' \
    --output json >&2 || true
  die "Staging origin TLS configuration failed with status $command_status"
fi
retry 30 10 curl --fail --silent --show-error --max-time 15 "https://$origin_host/health" >/dev/null

origin_secret="$(aws_cli ssm get-parameter \
  --region "$AWS_REGION" \
  --name "$origin_secret_name" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text 2>/dev/null || true)"
if [ -z "$origin_secret" ] || [ "$origin_secret" = "None" ]; then
  origin_secret="$(openssl rand -hex 32)"
  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$origin_secret_name" \
    --type SecureString \
    --value "$origin_secret" >/dev/null
  log "Created the staging-only CloudFront origin verification secret"
else
  log "Retained the existing staging-only CloudFront origin verification secret"
fi
[ "${#origin_secret}" -ge 32 ] || die "Staging CloudFront origin verification secret is not strong enough"

distribution_count="$(aws_cli cloudfront list-distributions \
  --query "length(DistributionList.Items[?Comment=='$distribution_comment'])" \
  --output text)"
case "$distribution_count" in
  0|1) ;;
  *) die "Found multiple CloudFront distributions with the isolated staging comment" ;;
esac

if [ "$distribution_count" = "0" ]; then
  umask 077
  distribution_config_file="$STATE_DIR/cloudfront-distribution-config.json"
  trap 'rm -f "$distribution_config_file"' EXIT
  ORIGIN_HOST="$origin_host" \
  ORIGIN_SECRET="$origin_secret" \
  DISTRIBUTION_COMMENT="$distribution_comment" \
  CACHE_POLICY_ID="$cache_policy_id" \
  ORIGIN_REQUEST_POLICY_ID="$origin_request_policy_id" \
  RESPONSE_HEADERS_POLICY_ID="$response_headers_policy_id" \
  node - "$(node_path "$distribution_config_file")" <<'NODE'
const fs = require('fs');
const output = process.argv[2];
const config = {
  CallerReference: `aura-staging-edge-${Date.now()}`,
  Comment: process.env.DISTRIBUTION_COMMENT,
  Enabled: true,
  IsIPV6Enabled: true,
  PriceClass: 'PriceClass_100',
  HttpVersion: 'http2and3',
  Aliases: { Quantity: 0 },
  Origins: {
    Quantity: 1,
    Items: [{
      Id: 'aura-staging-ec2-origin',
      DomainName: process.env.ORIGIN_HOST,
      OriginPath: '',
      CustomHeaders: {
        Quantity: 1,
        Items: [{
          HeaderName: 'X-Aura-Origin-Verify',
          HeaderValue: process.env.ORIGIN_SECRET,
        }],
      },
      CustomOriginConfig: {
        HTTPPort: 80,
        HTTPSPort: 443,
        OriginProtocolPolicy: 'https-only',
        OriginSslProtocols: { Quantity: 1, Items: ['TLSv1.2'] },
        OriginReadTimeout: 60,
        OriginKeepaliveTimeout: 60,
      },
      OriginShield: { Enabled: false },
      ConnectionAttempts: 3,
      ConnectionTimeout: 10,
    }],
  },
  DefaultCacheBehavior: {
    TargetOriginId: 'aura-staging-ec2-origin',
    ViewerProtocolPolicy: 'redirect-to-https',
    CachePolicyId: process.env.CACHE_POLICY_ID,
    OriginRequestPolicyId: process.env.ORIGIN_REQUEST_POLICY_ID,
    ResponseHeadersPolicyId: process.env.RESPONSE_HEADERS_POLICY_ID,
    SmoothStreaming: false,
    Compress: true,
    AllowedMethods: {
      Quantity: 7,
      Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
      CachedMethods: { Quantity: 3, Items: ['GET', 'HEAD', 'OPTIONS'] },
    },
    TrustedSigners: { Enabled: false, Quantity: 0 },
    TrustedKeyGroups: { Enabled: false, Quantity: 0 },
    LambdaFunctionAssociations: { Quantity: 0 },
    FunctionAssociations: { Quantity: 0 },
    FieldLevelEncryptionId: '',
  },
  CacheBehaviors: { Quantity: 0 },
  CustomErrorResponses: { Quantity: 0 },
  ViewerCertificate: { CloudFrontDefaultCertificate: true },
  Restrictions: { GeoRestriction: { RestrictionType: 'none', Quantity: 0 } },
};
fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
NODE

  if command -v cygpath >/dev/null 2>&1; then
    distribution_config_uri="file://$(cygpath -m "$distribution_config_file")"
  else
    distribution_config_uri="file://$distribution_config_file"
  fi
  [ -s "$distribution_config_file" ] || die "Generated CloudFront distribution config is empty"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$(node_path "$distribution_config_file")"
  log "Validated the protected CloudFront distribution config"
  created_distribution="$(MSYS_NO_PATHCONV=1 aws_cli cloudfront create-distribution \
    --distribution-config "$distribution_config_uri" \
    --query 'Distribution.[Id,DomainName,ARN]' \
    --output text)"
  read -r distribution_id distribution_domain distribution_arn <<<"$created_distribution"
  [ -n "$distribution_id" ] && [ -n "$distribution_domain" ] && [ -n "$distribution_arn" ] || die "CloudFront did not return the new staging distribution identifiers"
  log "Created the dedicated staging CloudFront distribution"
else
  distribution_id="$(aws_cli cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='$distribution_comment'].Id | [0]" \
    --output text)"
  distribution_domain="$(aws_cli cloudfront get-distribution \
    --id "$distribution_id" \
    --query 'Distribution.DomainName' \
    --output text)"
  distribution_arn="arn:aws:cloudfront::$AWS_ACCOUNT_ID:distribution/$distribution_id"
  existing_origin="$(aws_cli cloudfront get-distribution \
    --id "$distribution_id" \
    --query 'Distribution.DistributionConfig.Origins.Items[0].DomainName' \
    --output text)"
  existing_origin_secret="$(aws_cli cloudfront get-distribution \
    --id "$distribution_id" \
    --query "Distribution.DistributionConfig.Origins.Items[0].CustomHeaders.Items[?HeaderName=='X-Aura-Origin-Verify'].HeaderValue | [0]" \
    --output text)"
  [ "$existing_origin" = "$origin_host" ] || die "Existing isolated staging distribution points to a different origin"
  [ "$existing_origin_secret" = "$origin_secret" ] || die "Existing isolated staging distribution origin secret differs from Parameter Store"
  log "Retained the existing dedicated staging CloudFront distribution"
fi

require_no_prod_value "STAGING_API_HOST" "$distribution_domain" "${PROD_API_BASE_URL:-}"
aws_cli cloudfront tag-resource \
  --resource "$distribution_arn" \
  --tags "Items=[{Key=Project,Value=$PROJECT_NAME},{Key=Environment,Value=staging},{Key=ManagedBy,Value=codex-staging-bootstrap},{Key=CostProfile,Value=free-cloudfront-default-domain}]" >/dev/null

environment_tag="$(aws_cli cloudfront list-tags-for-resource \
  --resource "$distribution_arn" \
  --query "Tags.Items[?Key=='Environment'].Value | [0]" \
  --output text)"
managed_by_tag="$(aws_cli cloudfront list-tags-for-resource \
  --resource "$distribution_arn" \
  --query "Tags.Items[?Key=='ManagedBy'].Value | [0]" \
  --output text)"
assert_staging_tags "$distribution_id" "$environment_tag" "$managed_by_tag"

wait_for_cloudfront_deployed "$distribution_id"
retry 45 10 curl --fail --silent --show-error --max-time 15 "https://$distribution_domain/health" >/dev/null

state_set instance_id "$instance_id"
state_set public_ip "$public_ip"
state_set public_dns "$public_dns"
state_set cloudfront_distribution_id "$distribution_id"
state_set staging_origin_host "$origin_host"
state_set staging_base_url "https://$distribution_domain"
state_set staging_frontend_url "https://$distribution_domain"
state_set staging_api_base_url "https://$distribution_domain"
state_set staging_health_url "https://$distribution_domain/health"

log "CloudFront staging edge is ready"
printf 'STAGING_CLOUDFRONT_DISTRIBUTION_ID=%s\n' "$distribution_id"
printf 'STAGING_API_HOST=%s\n' "$distribution_domain"
printf 'STAGING_ORIGIN_HOST=%s\n' "$origin_host"
printf 'STAGING_BASE_URL=https://%s\n' "$distribution_domain"
