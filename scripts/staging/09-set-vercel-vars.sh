#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

ensure_state

if ! command -v vercel >/dev/null 2>&1; then
  if [ "${REQUIRE_VERCEL:-false}" = "true" ]; then
    die "Vercel CLI is required because REQUIRE_VERCEL=true"
  fi
  warn "Vercel CLI not found; skipping Vercel variable configuration"
  state_set vercel_vars_configured false
  exit 0
fi
need_cmd curl

project_dir="${VERCEL_PROJECT_DIR:-.}"
[ -d "$REPO_ROOT/$project_dir" ] || die "VERCEL_PROJECT_DIR does not exist: $project_dir"
if [ ! -f "$REPO_ROOT/$project_dir/.vercel/project.json" ] && { [ -z "${VERCEL_ORG_ID:-}" ] || [ -z "${VERCEL_PROJECT_ID:-}" ]; }; then
  if [ "${REQUIRE_VERCEL:-false}" = "true" ]; then
    die "Vercel project is not linked. Provide .vercel/project.json or VERCEL_ORG_ID and VERCEL_PROJECT_ID."
  fi
  warn "Vercel project is not linked; skipping Vercel variable configuration"
  state_set vercel_vars_configured false
  exit 0
fi

staging_api_base_url="${STAGING_API_BASE_URL:-$(state_get staging_api_base_url)}"
[ -n "$staging_api_base_url" ] || die "Missing staging API base URL"
require_no_prod_value "STAGING_API_BASE_URL" "$staging_api_base_url" "$PROD_API_BASE_URL"

vercel_project_id="${VERCEL_PROJECT_ID:-}"
vercel_org_id="${VERCEL_ORG_ID:-}"
project_json="$REPO_ROOT/$project_dir/.vercel/project.json"
if [ -f "$project_json" ]; then
  [ -n "$vercel_project_id" ] || vercel_project_id="$(json_get .projectId "$project_json")"
  [ -n "$vercel_org_id" ] || vercel_org_id="$(json_get .orgId "$project_json")"
fi

is_standard_vercel_target() {
  case "$1" in
    production|preview|development) return 0 ;;
    *) return 1 ;;
  esac
}

vercel_api_url() {
  local path="$1"
  local separator='?'
  local url="https://api.vercel.com$path"
  if [ -n "$vercel_org_id" ]; then
    url="${url}${separator}teamId=${vercel_org_id}"
  fi
  printf '%s' "$url"
}

ensure_custom_vercel_target() {
  is_standard_vercel_target "$VERCEL_TARGET" && return 0
  [ -n "${VERCEL_TOKEN:-}" ] || die "VERCEL_TOKEN is required to create/reuse Vercel custom target $VERCEL_TARGET"
  [ -n "$vercel_project_id" ] || die "VERCEL_PROJECT_ID or .vercel/project.json projectId is required for Vercel custom target $VERCEL_TARGET"

  local list_response
  list_response="$(curl --fail-with-body -sS -H "Authorization: Bearer $VERCEL_TOKEN" "$(vercel_api_url "/v9/projects/$vercel_project_id/custom-environments")" \
    || die "Vercel custom target $VERCEL_TARGET could not be read. Grant project write access or create the target in Vercel before setting staging vars.")"
  if printf '%s' "$list_response" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const slug = process.argv[1];
  const parsed = JSON.parse(input || "{}");
  process.exit((parsed.environments || []).some((env) => env.slug === slug || env.id === slug) ? 0 : 1);
});
' "$VERCEL_TARGET"; then
    log "Vercel custom target exists: $VERCEL_TARGET"
    return 0
  fi

  log "Creating Vercel custom target: $VERCEL_TARGET"
  node -e 'process.stdout.write(JSON.stringify({ slug: process.argv[1], description: "Isolated Aura staging environment" }))' "$VERCEL_TARGET" \
    | curl --fail-with-body -sS \
        -X POST \
        -H "Authorization: Bearer $VERCEL_TOKEN" \
        -H "Content-Type: application/json" \
        --data-binary @- \
        "$(vercel_api_url "/v9/projects/$vercel_project_id/custom-environments")" >/dev/null \
    || die "Vercel custom target $VERCEL_TARGET could not be created. Grant project write access or create it in Vercel, then rerun this script."
}

ensure_custom_vercel_target

set_public_var() {
  local key="$1"
  local value="$2"
  [ -n "$value" ] || die "Refusing to set empty Vercel variable $key"
  (
    cd "$REPO_ROOT/$project_dir"
    vercel env rm "$key" "$VERCEL_TARGET" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$key" "$VERCEL_TARGET" >/dev/null
  )
  log "Vercel $VERCEL_TARGET variable set: $key"
}

set_public_var NEXT_PUBLIC_API_BASE_URL "$staging_api_base_url"
set_public_var NEXT_PUBLIC_SOCKET_URL "$staging_api_base_url"
set_public_var NEXT_PUBLIC_UPLOADS_BASE_URL "$staging_api_base_url/uploads"
set_public_var NEXT_PUBLIC_APP_ENV staging

(
  cd "$REPO_ROOT/$project_dir"
  vercel pull --yes --environment="$VERCEL_TARGET" >/dev/null || warn "vercel pull failed; variables may still be set"
  if [ "${ENABLE_VERCEL_DEPLOY:-false}" = "true" ]; then
    vercel deploy --target="$VERCEL_TARGET"
  fi
)

state_set vercel_vars_configured true
log "Vercel public staging variables are configured"
