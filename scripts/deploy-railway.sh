#!/usr/bin/env bash
# Railway storefront production deploy: push CI's build-env contract, upload
# the release app/ tree, wait for SUCCESS, then restore prior service variables.
# Called by the deploy-railway-production job in deploy-netlify.yml.
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "missing command: jq" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "missing command: node" >&2; exit 1; }
command -v railway >/dev/null 2>&1 || { echo "missing command: railway" >&2; exit 1; }

[ -n "${RAILWAY_API_TOKEN:-}" ] || { echo "missing env: RAILWAY_API_TOKEN" >&2; exit 1; }
[ -n "${RAILWAY_SERVICE_ID:-}" ] || { echo "missing env: RAILWAY_SERVICE_ID" >&2; exit 1; }
[ -n "${RAILWAY_ENVIRONMENT_ID:-}" ] || { echo "missing env: RAILWAY_ENVIRONMENT_ID" >&2; exit 1; }
[ -n "${BACKEND_ORIGIN:-}" ] || { echo "missing env: BACKEND_ORIGIN" >&2; exit 1; }
[ -n "${BUILT_AT:-}" ] || { echo "missing env: BUILT_AT" >&2; exit 1; }

export RAILWAY_API_TOKEN RAILWAY_ENVIRONMENT_ID RAILWAY_SERVICE_ID

state_file="$(mktemp)"
restored=0

restore_vars() {
  if [ "${restored}" -eq 1 ]; then
    return 0
  fi
  restored=1
  if [ ! -s "${state_file}" ]; then
    return 0
  fi
  echo "Restoring prior Railway service variables."
  RAILWAY_STATE_FILE="${state_file}" node scripts/railway-vars.cjs restore || true
}

cleanup() {
  local status="$?"
  restore_vars
  rm -f "${state_file}"
  exit "${status}"
}
trap cleanup EXIT

if [ -n "${RAILWAY_PROJECT_ID:-}" ]; then
  railway link --project "${RAILWAY_PROJECT_ID}" \
    --environment "${RAILWAY_ENVIRONMENT_ID}" </dev/null || true
fi

echo "Pushing CI build-env parity vars onto Railway service ${RAILWAY_SERVICE_ID}."
RAILWAY_STATE_FILE="${state_file}" node scripts/railway-vars.cjs push

railway up ./app --path-as-root \
  --environment "${RAILWAY_ENVIRONMENT_ID}" \
  --service "${RAILWAY_SERVICE_ID}" \
  --ci --detach

attempts=60
attempt=0
while [ "${attempt}" -lt "${attempts}" ]; do
  attempt=$((attempt + 1))
  deployments="$(railway deployment list \
    --service "${RAILWAY_SERVICE_ID}" \
    --environment "${RAILWAY_ENVIRONMENT_ID}" \
    --json 2>/dev/null || echo '[]')"
  status="$(printf '%s' "${deployments}" | jq -r '[.[]?] | map(select(.status != null)) | .[0].status // empty' 2>/dev/null || true)"

  if [ "${status}" = "SUCCESS" ]; then
    echo "Railway deploy is live."
    break
  fi
  if [ "${status}" = "FAILED" ] || [ "${status}" = "CRASHED" ] || [ "${status}" = "REMOVED" ]; then
    echo "Railway deploy ended in status '${status}'." >&2
    exit 1
  fi
  if [ "${attempt}" -ge "${attempts}" ]; then
    echo "Railway deploy did not go live after ${attempts} attempts." >&2
    exit 1
  fi
  echo "Railway deploy status: ${status:-unknown} (attempt ${attempt}/${attempts})." >&2
  sleep 15
done

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "site_url=${RAILWAY_PRODUCTION_URL:-}" >> "${GITHUB_OUTPUT}"
fi
