#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_cmd gh
need_env GH_REPO
ensure_state

staging_base_url="${STAGING_BASE_URL:-$(state_get staging_base_url)}"
staging_api_base_url="${STAGING_API_BASE_URL:-$(state_get staging_api_base_url)}"
staging_health_url="${STAGING_HEALTH_URL:-$(state_get staging_health_url)}"

[ -n "$staging_base_url" ] || die "Missing staging base URL"
[ -n "$staging_api_base_url" ] || die "Missing staging API base URL"
[ -n "$staging_health_url" ] || die "Missing staging health URL"

gh api --method PUT "repos/$GH_REPO/environments/staging" >/dev/null

set_var() {
  local key="$1"
  local value="$2"
  [ -n "$value" ] || die "Refusing to set empty GitHub variable $key"
  printf '%s' "$value" | gh variable set "$key" --repo "$GH_REPO" --env staging >/dev/null
  log "GitHub staging variable set: $key"
}

set_var STAGING_BASE_URL "$staging_base_url"
set_var STAGING_API_BASE_URL "$staging_api_base_url"
set_var STAGING_HEALTH_URL "$staging_health_url"
set_var STAGING_SSM_PREFIX "/aura/staging"
set_var SMOKE_TARGET_ENV staging
set_var SMOKE_REQUIRE_BACKEND_STAGING true
set_var SMOKE_FORBID_PRODUCTION_ORIGINS true
set_var PROD_BASE_URL "$PROD_BASE_URL"
set_var PROD_API_BASE_URL "$PROD_API_BASE_URL"
set_var PROD_SSM_PREFIX "/aura/prod"

state_set github_staging_vars_configured true
log "GitHub staging environment variables are configured for $GH_REPO"
