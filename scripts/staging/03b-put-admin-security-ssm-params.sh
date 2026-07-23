#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
validate_staging_admin_security_phase
staging_admin_security_enabled || die "Admin security qualification parameters are not written in the legacy phase"
need_cmd openssl
need_env AWS_REGION

put_string() {
  local name="$1"
  local value="$2"
  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$STAGING_SSM_PREFIX/$name" \
    --type String \
    --value "$value" \
    --overwrite >/dev/null
  log "SSM String set: $STAGING_SSM_PREFIX/$name"
}

put_secure() {
  local name="$1"
  local value="$2"
  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$STAGING_SSM_PREFIX/$name" \
    --type SecureString \
    --value "$value" \
    --overwrite >/dev/null
  log "SSM SecureString set: $STAGING_SSM_PREFIX/$name"
}

put_secure_once() {
  local name="$1"
  local value="$2"
  if aws_cli ssm get-parameter \
    --region "$AWS_REGION" \
    --name "$STAGING_SSM_PREFIX/$name" \
    --query 'Parameter.Name' \
    --output text >/dev/null 2>&1; then
    log "SSM SecureString retained: $STAGING_SSM_PREFIX/$name"
    return 0
  fi
  [ "${#value}" -ge 32 ] || die "$name must be at least 32 characters before it is created"
  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$STAGING_SSM_PREFIX/$name" \
    --type SecureString \
    --value "$value" >/dev/null
  log "SSM SecureString created: $STAGING_SSM_PREFIX/$name"
}

backend_enabled=false
duo_provider=false
if staging_admin_security_backend_enabled; then
  backend_enabled=true
  duo_provider="$STAGING_ADMIN_DUO_PROVIDER"
fi

if staging_admin_security_requires_isolated_firebase; then
  firebase_service_account="$(printf '%s' "$STAGING_FIREBASE_SERVICE_ACCOUNT" | node -e 'let input = ""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.stringify(JSON.parse(input))));')"
  put_string FIREBASE_PROJECT_ID "$STAGING_FIREBASE_PROJECT_ID"
  put_string STAGING_ALLOW_FIREBASE_ADMIN_STUB false
  put_secure FIREBASE_SERVICE_ACCOUNT "$firebase_service_account"
else
  put_string FIREBASE_PROJECT_ID aura-staging-smoke
  put_string STAGING_ALLOW_FIREBASE_ADMIN_STUB true
fi

put_string OTP_EMAIL_FAIL_CLOSED true
if staging_admin_security_frontend_enabled; then
  put_string ORDER_EMAIL_PROVIDER "$STAGING_EMAIL_PROVIDER"
  case "$STAGING_EMAIL_PROVIDER" in
    gmail)
      gmail_app_password="$(printf '%s' "$STAGING_GMAIL_APP_PASSWORD" | tr -d '[:space:]')"
      put_secure GMAIL_USER "$STAGING_GMAIL_USER"
      put_secure GMAIL_APP_PASSWORD "$gmail_app_password"
      put_secure ORDER_EMAIL_FROM_ADDRESS "$STAGING_GMAIL_USER"
      ;;
    resend)
      put_secure RESEND_API_KEY "$STAGING_RESEND_API_KEY"
      put_secure ORDER_EMAIL_FROM_ADDRESS "$STAGING_EMAIL_FROM_ADDRESS"
      ;;
  esac
else
  put_string ORDER_EMAIL_PROVIDER null
fi

origin="$(staging_admin_security_origin)"
put_string ADMIN_SECURITY_ROLLOUT_PHASE "$STAGING_ADMIN_SECURITY_PHASE"
put_string AUTH_DEVICE_CHALLENGE_MODE admin
put_string AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK false
put_string AUTH_DEVICE_CHALLENGE_SECRET_VERSION staging-v1
put_string ADMIN_REQUIRE_2FA true
put_string ADMIN_REQUIRE_PASSKEY true
put_string ADMIN_REQUIRE_ALLOWLIST true
put_secure ADMIN_ALLOWLIST_EMAILS "$STAGING_ADMIN_ALLOWLIST_EMAILS"
put_string AUTH_SESSION_ALLOW_MEMORY_FALLBACK false
put_string MFA_ENABLED true
put_string MFA_PASSKEY_ENABLED true
put_string AUTH_WEBAUTHN_RP_ID "$STAGING_API_HOST"
put_string AUTH_WEBAUTHN_ORIGIN "$origin"
put_string AUTH_WEBAUTHN_USER_VERIFICATION required
put_string ADMIN_SECURITY_STATE_ENGINE_V2 "$backend_enabled"
put_string ADMIN_PASSKEY_ENROLLMENT "$backend_enabled"
put_string ADMIN_PASSKEY_CHALLENGE "$backend_enabled"
put_string ADMIN_DUO_PROVIDER "$duo_provider"
put_string ADMIN_RECOVERY_GRANTS "$backend_enabled"
put_string ADMIN_ASSURANCE_ENFORCEMENT "$backend_enabled"
put_string ADMIN_ACTION_BOUND_ASSURANCE "$backend_enabled"
put_string ADMIN_LEGACY_FACTOR_READ true
put_string ADMIN_RECOVERY_TWO_PERSON_REQUIRED "$STAGING_ADMIN_RECOVERY_TWO_PERSON_REQUIRED"
put_secure_once ADMIN_SECURITY_HASH_SECRET "${STAGING_ADMIN_SECURITY_HASH_SECRET:-$(openssl rand -hex 32)}"
put_secure_once AUTH_DEVICE_CHALLENGE_SECRET "${STAGING_AUTH_DEVICE_CHALLENGE_SECRET:-$(openssl rand -hex 32)}"

log "Staging admin security parameters are configured for phase $STAGING_ADMIN_SECURITY_PHASE"
