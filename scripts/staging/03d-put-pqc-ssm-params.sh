#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
need_cmd node
need_cmd openssl
need_env AWS_REGION

# Keys live in a sibling hierarchy, not under $STAGING_SSM_PREFIX. The AWS
# deploy renderer copies every parameter under the staging prefix into
# runtime-secrets.env, and a private key record must never be materialized
# there. GetParametersByPath is hierarchy-based, so a sibling path is not
# returned. The IAM wildcard parameter/aura/staging* still covers it.
PQC_SSM_PREFIX="${PQC_SSM_PREFIX:-${STAGING_SSM_PREFIX}-pqc}"
case "$PQC_SSM_PREFIX" in
  "${STAGING_SSM_PREFIX}-"*) ;;
  *) die "PQC_SSM_PREFIX must be a sibling of $STAGING_SSM_PREFIX (for example ${STAGING_SSM_PREFIX}-pqc)" ;;
esac

field_mode="${PQC_FIELD_MODE:-per-record}"
ledger_mode="${PQC_LEDGER_MODE:-require}"
case "$field_mode" in
  off|auto|key-wrap|per-record|require) ;;
  *) die "PQC_FIELD_MODE must be one of off, auto, key-wrap, per-record, require" ;;
esac
case "$ledger_mode" in
  off|auto|require) ;;
  *) die "PQC_LEDGER_MODE must be one of off, auto, require" ;;
esac

# Field encryption uses a KMS-held wrapping key. The service refuses a local
# master key under NODE_ENV=production, so staging activation must name a real
# KMS key instead of silently falling back.
field_kms_key_id="${FIELD_ENCRYPTION_KMS_KEY_ID:-}"
if [ "$field_mode" != "off" ] && [ -z "$field_kms_key_id" ]; then
  die "FIELD_ENCRYPTION_KMS_KEY_ID is required when PQC_FIELD_MODE=$field_mode (use a staging KMS key alias or ARN)"
fi

kem_parameter="$PQC_SSM_PREFIX/field-encryption-kem-key"
signing_parameter="$PQC_SSM_PREFIX/security-ledger-signing-key"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
chmod 700 "$tmp_dir"

parameter_exists() {
  aws_cli ssm get-parameter \
    --region "$AWS_REGION" \
    --name "$1" \
    --query 'Parameter.Name' \
    --output text >/dev/null 2>&1
}

generate_compact_key() {
  local type="$1"
  local out="$2"
  local summary key_id record_bytes

  # keygen prints metadata only, never private material.
  summary="$(node "$REPO_ROOT/scripts/security/pqc-keygen.mjs" --type "$type" --compact --out "$out")"
  key_id="$(printf '%s' "$summary" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => { console.log(JSON.parse(raw).keyId); });
')"
  record_bytes="$(wc -c < "$out" | tr -d '[:space:]')"
  log "Generated $type key $key_id (${record_bytes} bytes, compact)"
}

put_secure_parameter() {
  local name="$1"
  local file="$2"
  local size tier

  size="$(wc -c < "$file" | tr -d '[:space:]')"
  if [ "$size" -gt 8192 ]; then
    die "Key record for $name is ${size} bytes, above the SSM Advanced limit of 8192"
  fi
  if [ "$size" -gt 4096 ]; then
    tier=Advanced
  else
    tier=Standard
  fi

  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$name" \
    --type SecureString \
    --tier "$tier" \
    --value "$(aws_file_uri "$file")" \
    --overwrite >/dev/null
  log "SSM SecureString set: $name ($tier, ${size} bytes)"
}

put_string_parameter() {
  local name="$1"
  local value="$2"
  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$name" \
    --type String \
    --value "$value" \
    --overwrite >/dev/null
  log "SSM String set: $name"
}

put_secure_once() {
  local name="$1"
  local value="$2"
  local parameter="$STAGING_SSM_PREFIX/$name"

  if parameter_exists "$parameter"; then
    log "SSM SecureString retained: $parameter"
    return 0
  fi

  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$parameter" \
    --type SecureString \
    --value "$value" >/dev/null
  log "SSM SecureString created: $parameter"
}

# Field encryption recovers the same DEK after a restart by reading this
# parameter. Pre-creating it keeps the EC2 instance role read-only for SSM:
# the role never needs ssm:PutParameter just to boot.
ensure_wrapped_dek() {
  local name="$STAGING_SSM_PREFIX/FIELD_ENCRYPTION_WRAPPED_DEK"
  local ciphertext_b64 wrapped key_version record

  if parameter_exists "$name"; then
    log "Wrapped DEK retained: $name"
    return 0
  fi

  ciphertext_b64="$(aws_cli kms generate-data-key \
    --region "$AWS_REGION" \
    --key-id "$field_kms_key_id" \
    --key-spec AES_256 \
    --query 'CiphertextBlob' \
    --output text)"
  if [ -z "$ciphertext_b64" ] || [ "$ciphertext_b64" = "None" ]; then
    die "KMS GenerateDataKey returned no ciphertext for $field_kms_key_id"
  fi

  wrapped="$(printf '%s' "$ciphertext_b64" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  console.log(Buffer.from(raw.trim(), "base64").toString("base64url"));
});
')"
  key_version="k$(date -u +%Y%m%dT%H%M%SZ)"
  record="$(node -e '
console.log(JSON.stringify({ keyVersion: process.argv[1], wrapped: process.argv[2] }));
' "$key_version" "$wrapped")"

  aws_cli ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$name" \
    --type SecureString \
    --tier Standard \
    --value "$record" \
    --overwrite >/dev/null
  log "SSM SecureString set: $name (wrapped DEK)"
}

if parameter_exists "$kem_parameter"; then
  log "Keeping existing PQC KEM key: $kem_parameter"
elif [ "$field_mode" != "off" ]; then
  generate_compact_key hybrid-kem "$tmp_dir/field-kem.json"
  put_secure_parameter "$kem_parameter" "$tmp_dir/field-kem.json"
  rm -f "$tmp_dir/field-kem.json"
fi

if parameter_exists "$signing_parameter"; then
  log "Keeping existing PQC signing key: $signing_parameter"
elif [ "$ledger_mode" != "off" ]; then
  generate_compact_key hybrid-signature "$tmp_dir/ledger-signing.json"
  put_secure_parameter "$signing_parameter" "$tmp_dir/ledger-signing.json"
  rm -f "$tmp_dir/ledger-signing.json"
fi

# These parameters are plain configuration: the container receives references,
# then loads the private records directly from the sibling hierarchy at startup.
put_string_parameter "$STAGING_SSM_PREFIX/FIELD_ENCRYPTION_PQC_MODE" "$field_mode"
put_string_parameter "$STAGING_SSM_PREFIX/SECURITY_EVENT_LEDGER_PQC_MODE" "$ledger_mode"

# Keep references when the key exists even in "off" mode: decrypt-only rollback
# still needs them to read records written while PQC was active.
if parameter_exists "$kem_parameter"; then
  put_string_parameter "$STAGING_SSM_PREFIX/FIELD_ENCRYPTION_PQC_KEM_KEY_REF" "ssm:$kem_parameter"
fi
if parameter_exists "$signing_parameter"; then
  put_string_parameter "$STAGING_SSM_PREFIX/SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF" "ssm:$signing_parameter"
fi

# Enabling the PQC mode is inert unless the feature flag is also on. The KMS
# key + pre-created wrapped DEK satisfy the production encryption contract.
if [ "$field_mode" != "off" ]; then
  put_string_parameter "$STAGING_SSM_PREFIX/FIELD_ENCRYPTION_ENABLED" "true"
  put_string_parameter "$STAGING_SSM_PREFIX/FIELD_ENCRYPTION_KMS_KEY_ID" "$field_kms_key_id"
  ensure_wrapped_dek
fi

if [ "$ledger_mode" != "off" ]; then
  put_secure_once SECURITY_EVENT_LEDGER_SECRET "$(openssl rand -hex 32)"
  put_string_parameter "$STAGING_SSM_PREFIX/SECURITY_EVENT_LEDGER_ENABLED" "true"
fi

log "Staging PQC configuration ready (field=$field_mode, ledger=$ledger_mode)"
log "Next: run 07-deploy-compose.sh. PQC env vars are forwarded into .env.staging."
