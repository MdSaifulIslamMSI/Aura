#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
need_cmd openssl
need_env AWS_REGION

put_secure_once() {
  local name="$1"
  if aws_cli ssm get-parameter \
    --region "$AWS_REGION" \
    --name "$STAGING_SSM_PREFIX/$name" \
    --query 'Parameter.Name' \
    --output text >/dev/null 2>&1; then
    log "SSM SecureString retained: $STAGING_SSM_PREFIX/$name"
    return 0
  fi

  local value
  value="$(openssl rand -hex 32)"
  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$STAGING_SSM_PREFIX/$name" \
    --type SecureString \
    --value "$value" >/dev/null
  unset value
  log "SSM SecureString created: $STAGING_SSM_PREFIX/$name"
}

for name in \
  SESSION_SECRET \
  SESSION_HASH_SECRET \
  ACCOUNT_CURSOR_SIGNING_SECRET \
  OBSERVABILITY_HASH_SECRET \
  METRICS_SECRET; do
  put_secure_once "$name"
done

log "Account Center staging secrets are present without rotating existing values"
