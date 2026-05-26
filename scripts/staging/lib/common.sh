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

assert_staging_tags() {
  local resource_arn_or_id="$1"
  local environment="$2"
  local managed_by="$3"
  [ "$environment" = "staging" ] || die "Refusing to touch $resource_arn_or_id because Environment tag is not staging"
  [ "$managed_by" = "codex-staging-bootstrap" ] || die "Refusing to touch $resource_arn_or_id because ManagedBy tag is not codex-staging-bootstrap"
}
