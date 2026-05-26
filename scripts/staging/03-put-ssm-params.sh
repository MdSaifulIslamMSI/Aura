#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_cmd openssl
need_env AWS_REGION
need_env STAGING_BUCKET_NAME
[ "$STAGING_SSM_PREFIX" = "/aura/staging" ] || die "STAGING_SSM_PREFIX must be /aura/staging"

db_password="${STAGING_DATABASE_PASSWORD:-$(openssl rand -hex 24)}"
jwt_secret="${STAGING_JWT_SECRET:-$(openssl rand -hex 32)}"
otp_flow_secret="${STAGING_OTP_FLOW_SECRET:-$(openssl rand -hex 32)}"
otp_challenge_secret="${STAGING_OTP_CHALLENGE_SECRET:-$(openssl rand -hex 32)}"
upload_signing_secret="${STAGING_UPLOAD_SIGNING_SECRET:-$(openssl rand -hex 32)}"
auth_vault_secret="${STAGING_AUTH_VAULT_SECRET:-$(openssl rand -hex 32)}"
database_url="postgres://aura_staging:${db_password}@postgres:5432/aura_staging"
cors_origin="${STAGING_CORS_ORIGIN:-${STAGING_BASE_URL:-http://localhost:$STAGING_BACKEND_PORT}}"

put_string() {
  local name="$1"
  local value="$2"
  aws_cli ssm put-parameter --region "$AWS_REGION" --name "$STAGING_SSM_PREFIX/$name" --type String --value "$value" --overwrite >/dev/null
  log "SSM String set: $STAGING_SSM_PREFIX/$name"
}

put_secure() {
  local name="$1"
  local value="$2"
  aws_cli ssm put-parameter --region "$AWS_REGION" --name "$STAGING_SSM_PREFIX/$name" --type SecureString --value "$value" --overwrite >/dev/null
  log "SSM SecureString set: $STAGING_SSM_PREFIX/$name"
}

put_string APP_ENV staging
put_string NODE_ENV production
put_string FIREBASE_PROJECT_ID aura-staging-smoke
put_string STAGING_ALLOW_FIREBASE_ADMIN_STUB true
put_string PAYMENTS_ENABLED false
put_string PAYMENT_WEBHOOKS_ENABLED false
put_string PAYMENT_CHALLENGE_ENABLED false
put_string OTP_SMS_ENABLED false
put_string ORDER_EMAILS_ENABLED false
put_string REDIS_ENABLED true
put_string DISTRIBUTED_SECURITY_CONTROLS_ENABLED false
put_string AUTH_DEVICE_CHALLENGE_MODE off
put_string STAGING_SSM_PREFIX "$STAGING_SSM_PREFIX"
put_string AWS_PARAMETER_STORE_PATH_PREFIX "$STAGING_SSM_PREFIX"
put_string S3_BUCKET "$STAGING_BUCKET_NAME"
put_string BACKEND_PORT "$STAGING_BACKEND_PORT"
put_secure DATABASE_URL "$database_url"
put_string MONGO_URI mongodb://mongo:27017/aura_staging
put_string REDIS_URL redis://redis:6379
put_string UPLOAD_SCANNER_HOST scanner
put_string UPLOAD_SCANNER_PORT 3310
put_string CLAMAV_HOST scanner
put_string CLAMAV_PORT 3310
put_string CLAMAV_ENABLED true
put_string UPLOAD_MALWARE_SCAN_ENABLED true
put_string UPLOAD_MALWARE_SCAN_FAIL_CLOSED true
put_string CORS_ORIGIN "$cors_origin"
put_secure JWT_SECRET "$jwt_secret"
put_secure POSTGRES_PASSWORD "$db_password"
put_secure OTP_FLOW_SECRET "$otp_flow_secret"
put_secure OTP_CHALLENGE_SECRET "$otp_challenge_secret"
put_secure UPLOAD_SIGNING_SECRET "$upload_signing_secret"
put_secure AUTH_VAULT_SECRET "$auth_vault_secret"

state_set ssm_prefix "$STAGING_SSM_PREFIX"
log "Staging SSM parameters are configured under $STAGING_SSM_PREFIX"
