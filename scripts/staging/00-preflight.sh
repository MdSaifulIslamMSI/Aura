#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

log "Running staging bootstrap preflight"

if [ "${STAGING_PREFLIGHT_DRY_RUN:-false}" = "true" ]; then
  log "DRY-RUN: command, environment, and AWS identity checks are skipped"
  [ "$STAGING_SSM_PREFIX" = "/aura/staging" ] || die "STAGING_SSM_PREFIX must be /aura/staging"
  [ "${PROD_SSM_PREFIX:-/aura/prod}" = "/aura/prod" ] || die "PROD_SSM_PREFIX must be /aura/prod"
  [ "$ENABLE_EIP" = "false" ] || die "ENABLE_EIP=true is not implemented in the Free Tier bootstrap; leave it false"
  [ "$ENABLE_ROUTE53" = "false" ] || die "ENABLE_ROUTE53=true is not implemented in the Free Tier bootstrap; leave it false"
  require_no_prod_value "STAGING_BUCKET_NAME" "${STAGING_BUCKET_NAME:-aura-staging-uploads-dry-run}" ""
  log "DRY-RUN preflight passed"
  exit 0
fi

for cmd in aws curl ssh scp node npm gh openssl; do
  need_cmd "$cmd"
done

if ! command -v vercel >/dev/null 2>&1; then
  warn "Vercel CLI is not installed; scripts/staging/09-set-vercel-vars.sh will skip unless REQUIRE_VERCEL=true"
fi

while IFS= read -r env_name; do
  [ -n "$env_name" ] && need_env "$env_name"
done < <(required_bootstrap_env_vars)

[ "$STAGING_SSM_PREFIX" = "/aura/staging" ] || die "STAGING_SSM_PREFIX must be /aura/staging"
[ "$PROD_SSM_PREFIX" = "/aura/prod" ] || die "PROD_SSM_PREFIX must be /aura/prod"
[ "$ENABLE_EIP" = "false" ] || die "ENABLE_EIP=true is not implemented in the Free Tier bootstrap; leave it false"
[ "$ENABLE_ROUTE53" = "false" ] || die "ENABLE_ROUTE53=true is not implemented in the Free Tier bootstrap; leave it false"
require_no_prod_value "STAGING_BUCKET_NAME" "$STAGING_BUCKET_NAME" ""
require_no_prod_value "STAGING_BASE_URL" "${STAGING_BASE_URL:-}" "$PROD_BASE_URL"
require_no_prod_value "STAGING_API_BASE_URL" "${STAGING_API_BASE_URL:-}" "$PROD_API_BASE_URL"
require_no_prod_value "STAGING_HEALTH_URL" "${STAGING_HEALTH_URL:-}" "$PROD_API_BASE_URL"

case "$STAGING_ALLOWED_SSH_CIDR" in
  */*) ;;
  *) die "STAGING_ALLOWED_SSH_CIDR must be a CIDR such as 203.0.113.10/32" ;;
esac

identity_json="$(aws_cli sts get-caller-identity --output json)"
actual_account_id="$(node -e 'let input=""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(input).Account || ""));' <<< "$identity_json")"
[ "$actual_account_id" = "$AWS_ACCOUNT_ID" ] || die "AWS account mismatch: expected $AWS_ACCOUNT_ID, got $actual_account_id"

probe_aws_read() {
  local description="$1"
  shift
  if ! aws_cli "$@" >/tmp/aura-staging-preflight-aws.log 2>&1; then
    cat /tmp/aura-staging-preflight-aws.log >&2
    die "AWS preflight failed while checking $description. Fix the staging AWS profile before running bootstrap."
  fi
}

probe_aws_read "default VPC discovery" ec2 describe-vpcs --region "$AWS_REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text
if ! aws_cli ec2 describe-key-pairs --region "$AWS_REGION" --key-names "$STAGING_KEY_NAME" --query 'KeyPairs[0].KeyName' --output text >/tmp/aura-staging-preflight-aws.log 2>&1; then
  if grep -q 'InvalidKeyPair.NotFound' /tmp/aura-staging-preflight-aws.log; then
    warn "EC2 key pair $STAGING_KEY_NAME does not exist yet; bootstrap will create it under .staging/"
  else
    cat /tmp/aura-staging-preflight-aws.log >&2
    die "AWS preflight failed while checking staging EC2 key pair. Fix the staging AWS profile before running bootstrap."
  fi
fi
probe_aws_read "staging security group discovery" ec2 describe-security-groups --region "$AWS_REGION" --filters "Name=group-name,Values=$PROJECT_NAME-$STAGING_NAME-sg" --query 'SecurityGroups[].GroupId' --output text
probe_aws_read "staging EC2 instance profile" iam get-instance-profile --instance-profile-name "$STAGING_INSTANCE_PROFILE_NAME" --query 'InstanceProfile.InstanceProfileName' --output text
probe_aws_read "staging SSM prefix read" ssm get-parameters-by-path --region "$AWS_REGION" --path "$STAGING_SSM_PREFIX" --recursive --max-results 1 --query 'Parameters[].Name' --output text

log "AWS identity verified for account $actual_account_id in region $AWS_REGION"
log "Preflight passed"
