#!/usr/bin/env bash
set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$COMMON_DIR/../../.." && pwd)"
STATE_DIR="$REPO_ROOT/.staging"
STATE_FILE="$STATE_DIR/state.json"

: "${PROJECT_NAME:=aura}"
: "${STAGING_NAME:=staging}"
: "${STAGING_SSM_PREFIX:=/aura/staging}"
: "${STAGING_INSTANCE_TYPE:=t3.micro}"
: "${STAGING_ROOT_VOLUME_GB:=20}"
: "${STAGING_BACKEND_PORT:=3000}"
: "${STAGING_SWAP_GB:=2}"
: "${STAGING_INSTANCE_PROFILE_NAME:=${PROJECT_NAME}-${STAGING_NAME}-ec2-profile}"
: "${VERCEL_TARGET:=staging}"
: "${ENABLE_CERTBOT:=false}"
: "${ENABLE_EIP:=false}"
: "${ENABLE_ROUTE53:=false}"
: "${ENABLE_STAGING_HTTPS:=false}"
: "${ENABLE_CLOUDWATCH_AGENT:=false}"
: "${STAGING_BACKUP_RETENTION_DAYS:=14}"
: "${STAGING_DEPLOY_ENABLED:=false}"
: "${STAGING_ADMIN_SECURITY_PHASE:=legacy}"

log() {
  printf '[staging] %s\n' "$*" >&2
}

warn() {
  printf '[staging][warn] %s\n' "$*" >&2
}

die() {
  printf '[staging][error] %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

need_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    die "Missing required environment variable: $name"
  fi
}

require_boolean_value() {
  local name="$1"
  local value="${2:-}"
  case "$value" in
    true|false) ;;
    *) die "$name must be true or false" ;;
  esac
}

staging_admin_security_enabled() {
  [ "$STAGING_ADMIN_SECURITY_PHASE" != "legacy" ]
}

staging_admin_security_backend_enabled() {
  case "$STAGING_ADMIN_SECURITY_PHASE" in
    backend|frontend) return 0 ;;
    *) return 1 ;;
  esac
}

staging_admin_security_frontend_enabled() {
  [ "$STAGING_ADMIN_SECURITY_PHASE" = "frontend" ]
}

staging_admin_security_origin() {
  printf 'https://%s' "$STAGING_API_HOST"
}

validate_staging_admin_security_phase() {
  case "$STAGING_ADMIN_SECURITY_PHASE" in
    legacy|baseline|backend|frontend) ;;
    *) die "STAGING_ADMIN_SECURITY_PHASE must be legacy, baseline, backend, or frontend" ;;
  esac

  staging_admin_security_enabled || return 0

  [ "$ENABLE_STAGING_HTTPS" = "true" ] || die "ENABLE_STAGING_HTTPS=true is required outside the legacy admin security phase"
  need_env STAGING_API_HOST
  need_env STAGING_ADMIN_EMAIL
  need_env STAGING_ADMIN_ALLOWLIST_EMAILS
  need_env STAGING_ADMIN_DUO_PROVIDER
  need_env STAGING_ADMIN_RECOVERY_TWO_PERSON_REQUIRED
  need_env STAGING_BASE_URL
  need_env STAGING_FRONTEND_URL
  need_env STAGING_API_BASE_URL
  need_env STAGING_HEALTH_URL
  require_boolean_value STAGING_ADMIN_DUO_PROVIDER "$STAGING_ADMIN_DUO_PROVIDER"
  require_boolean_value STAGING_ADMIN_RECOVERY_TWO_PERSON_REQUIRED "$STAGING_ADMIN_RECOVERY_TWO_PERSON_REQUIRED"
  require_no_prod_value STAGING_API_HOST "$STAGING_API_HOST" "${PROD_API_BASE_URL:-}"

  node - \
    "$STAGING_API_HOST" \
    "$STAGING_ADMIN_EMAIL" \
    "$STAGING_ADMIN_ALLOWLIST_EMAILS" \
    "$STAGING_BASE_URL" \
    "$STAGING_FRONTEND_URL" \
    "$STAGING_API_BASE_URL" \
    "$STAGING_HEALTH_URL" \
    "${STAGING_CORS_ORIGIN:-}" \
    "${PROD_BASE_URL:-}" \
    "${PROD_API_BASE_URL:-}" <<'NODE'
const [
  host,
  certificateEmail,
  allowlist,
  baseUrl,
  frontendUrl,
  apiUrl,
  healthUrl,
  corsOrigin,
  prodBaseUrl,
  prodApiUrl,
] = process.argv.slice(2);

const fail = (message) => {
  console.error(`[staging][error] ${message}`);
  process.exit(1);
};
const normalizedHost = String(host || '').trim().toLowerCase();
const hostLabels = normalizedHost.split('.');
const validHostname = hostLabels.length >= 2 && hostLabels.every((label) => (
  label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
));
if (
  host !== normalizedHost
  ||
  !validHostname
  || normalizedHost.endsWith('.compute.amazonaws.com')
) {
  fail('STAGING_API_HOST must be a dedicated DNS hostname that can receive a public certificate');
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(certificateEmail || '').trim())) {
  fail('STAGING_ADMIN_EMAIL must be a valid certificate contact address');
}
const emails = String(allowlist || '').split(',').map((value) => value.trim()).filter(Boolean);
if (!emails.length || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
  fail('STAGING_ADMIN_ALLOWLIST_EMAILS must be a comma-separated list of valid email addresses');
}
const expectedOrigin = `https://${normalizedHost}`;
const requiredUrls = new Map([
  ['STAGING_BASE_URL', baseUrl],
  ['STAGING_FRONTEND_URL', frontendUrl],
  ['STAGING_API_BASE_URL', apiUrl],
]);
for (const [name, value] of requiredUrls) {
  if (String(value || '').replace(/\/+$/, '') !== expectedOrigin) {
    fail(`${name} must equal the dedicated HTTPS staging origin`);
  }
}
if (String(healthUrl || '').replace(/\/+$/, '') !== `${expectedOrigin}/health`) {
  fail('STAGING_HEALTH_URL must use the dedicated HTTPS staging origin');
}
if (corsOrigin && String(corsOrigin).replace(/\/+$/, '') !== expectedOrigin) {
  fail('STAGING_CORS_ORIGIN must equal the dedicated HTTPS staging origin when set');
}
for (const productionUrl of [prodBaseUrl, prodApiUrl]) {
  if (!productionUrl) continue;
  try {
    if (new URL(productionUrl).hostname.toLowerCase() === normalizedHost) {
      fail('STAGING_API_HOST must not reuse a production hostname');
    }
  } catch {
    fail('Production comparison URL is invalid');
  }
}
NODE
}

aws_cli() {
  if [ -n "${AWS_PROFILE:-}" ]; then
    aws --profile "$AWS_PROFILE" "$@"
  else
    aws "$@"
  fi
}

aws_file_uri() {
  local file_path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    printf 'file://%s' "$(cygpath -w "$file_path")"
  else
    printf 'file://%s' "$file_path"
  fi
}

node_path() {
  local file_path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$file_path"
  else
    printf '%s' "$file_path"
  fi
}

json_get() {
  local filter="$1"
  local file="$2"
  node -e '
const fs = require("fs");
const filter = process.argv[1].replace(/\s*\/\/\s*empty\s*$/, "");
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const key = filter.replace(/^\./, "");
const value = key ? data[key] : data;
if (value !== undefined && value !== null) process.stdout.write(String(value));
' "$filter" "$(node_path "$file")"
}

mask() {
  local value="${1:-}"
  local length=${#value}
  if [ "$length" -le 8 ]; then
    printf '<set:%s-chars>' "$length"
  else
    printf '%s...%s' "${value:0:4}" "${value: -4}"
  fi
}

normalize_url() {
  printf '%s' "${1:-}" | sed -E 's#/*$##'
}

require_no_prod_value() {
  local name="$1"
  local value="${2:-}"
  local prod_value="${3:-}"
  local lower
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"

  [ -z "$value" ] && return 0
  if [ -n "$prod_value" ] && [ "$(normalize_url "$value")" = "$(normalize_url "$prod_value")" ]; then
    die "$name must not equal a production value"
  fi
  case "$lower" in
    *"/aura/prod"*|*"production"*|*"prod-"*|*"-prod"*|*"prod."*|*".prod"*)
      die "$name looks production-like: $value"
      ;;
  esac
}

assert_staging_prefix() {
  [ "${STAGING_SSM_PREFIX:-}" = "/aura/staging" ] || die "STAGING_SSM_PREFIX must be /aura/staging"
  [ "${PROD_SSM_PREFIX:-/aura/prod}" = "/aura/prod" ] || die "PROD_SSM_PREFIX must be /aura/prod"
}

assert_staging_bucket_safe() {
  local bucket="$1"
  require_no_prod_value "STAGING_BUCKET_NAME" "$bucket" ""
  local env_tag managed_tag
  env_tag="$(aws_cli s3api get-bucket-tagging --bucket "$bucket" --query "TagSet[?Key=='Environment'].Value | [0]" --output text 2>/dev/null || true)"
  managed_tag="$(aws_cli s3api get-bucket-tagging --bucket "$bucket" --query "TagSet[?Key=='ManagedBy'].Value | [0]" --output text 2>/dev/null || true)"
  [ "$env_tag" = "staging" ] || die "Refusing to use bucket $bucket because Environment tag is not staging"
  [ "$managed_tag" = "codex-staging-bootstrap" ] || die "Refusing to use bucket $bucket because ManagedBy tag is not codex-staging-bootstrap"
}

resolve_dns_ipv4() {
  local host="$1"
  node -e '
const dns = require("dns");
dns.lookup(process.argv[1], { family: 4 }, (error, address) => {
  if (error) process.exit(1);
  process.stdout.write(address || "");
});
' "$host"
}

nginx_staging_server_name() {
  local explicit="${STAGING_API_HOST:-}"
  local source_url="${1:-}"
  local host

  if [ -n "$explicit" ] && [ "$explicit" != "_" ]; then
    printf '%s' "$explicit"
    return 0
  fi

  host="$(node -e '
const input = process.argv[1] || "";
try {
  const host = new URL(input).hostname;
  const ec2PublicDns = host.match(/^ec2-(\d+)-(\d+)-(\d+)-(\d+)\./);
  if (ec2PublicDns) {
    process.stdout.write(ec2PublicDns.slice(1).join("."));
  } else if (host) {
    process.stdout.write(host);
  }
} catch {
  // Fail below with the staging script error message.
}
' "$source_url")"
  [ -n "$host" ] || die "Could not derive concrete Nginx server_name; set STAGING_API_HOST or a staging URL with a host."
  printf '%s' "$host"
}

ensure_state() {
  mkdir -p "$STATE_DIR"
  if [ ! -f "$STATE_FILE" ]; then
    printf '{}\n' > "$STATE_FILE"
  fi
}

state_get() {
  ensure_state
  json_get ".$1" "$STATE_FILE"
}

state_set() {
  ensure_state
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  node -e '
const fs = require("fs");
const [file, key, value] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
data[key] = value;
fs.writeFileSync(process.argv[4], `${JSON.stringify(data, null, 2)}\n`);
' "$(node_path "$STATE_FILE")" "$key" "$value" "$(node_path "$tmp")"
  mv "$tmp" "$STATE_FILE"
}

state_set_json() {
  ensure_state
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  node -e '
const fs = require("fs");
const [file, key, rawValue, output] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
data[key] = JSON.parse(rawValue);
fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`);
' "$(node_path "$STATE_FILE")" "$key" "$value" "$(node_path "$tmp")"
  mv "$tmp" "$STATE_FILE"
}

retry() {
  local attempts="$1"
  local delay="$2"
  shift 2
  local count=1
  until "$@"; do
    if [ "$count" -ge "$attempts" ]; then
      return 1
    fi
    sleep "$delay"
    count=$((count + 1))
  done
}

wait_for_ssh() {
  local host_alias="${1:-aura-staging}"
  local attempts="${2:-40}"
  log "Waiting for SSH on $host_alias"
  retry "$attempts" 10 ssh -F "$STATE_DIR/ssh_config" -o BatchMode=yes -o ConnectTimeout=5 "$host_alias" true
}

required_bootstrap_env_vars() {
  cat <<'VARS'
AWS_REGION
AWS_ACCOUNT_ID
PROJECT_NAME
STAGING_NAME
STAGING_SSM_PREFIX
STAGING_BUCKET_NAME
STAGING_KEY_NAME
STAGING_ALLOWED_SSH_CIDR
STAGING_INSTANCE_TYPE
STAGING_ROOT_VOLUME_GB
STAGING_BUDGET_EMAIL
STAGING_MONTHLY_BUDGET_USD
GH_REPO
VERCEL_PROJECT_DIR
PROD_BASE_URL
PROD_API_BASE_URL
PROD_SSM_PREFIX
VARS
}

required_verify_env_vars() {
  cat <<'VARS'
AWS_REGION
AWS_ACCOUNT_ID
PROJECT_NAME
STAGING_NAME
STAGING_SSM_PREFIX
STAGING_BUCKET_NAME
STAGING_KEY_NAME
STAGING_ALLOWED_SSH_CIDR
GH_REPO
VERCEL_PROJECT_DIR
PROD_BASE_URL
PROD_API_BASE_URL
PROD_SSM_PREFIX
VARS
}

assert_staging_tags() {
  local resource_arn_or_id="$1"
  local environment="$2"
  local managed_by="$3"
  [ "$environment" = "staging" ] || die "Refusing to touch $resource_arn_or_id because Environment tag is not staging"
  [ "$managed_by" = "codex-staging-bootstrap" ] || die "Refusing to touch $resource_arn_or_id because ManagedBy tag is not codex-staging-bootstrap"
}
