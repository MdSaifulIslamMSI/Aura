#!/usr/bin/env bash
# Railway storefront rollback: overwrite app/ with ROLLBACK_REF's tree, push
# the same VITE_* build contract a release build uses, re-upload, wait for
# SUCCESS, then restore prior service variables. Called by rollback-railway.yml.
set -euo pipefail

command -v git >/dev/null 2>&1 || { echo "missing command: git" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "missing command: jq" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "missing command: node" >&2; exit 1; }
command -v railway >/dev/null 2>&1 || { echo "missing command: railway" >&2; exit 1; }

[ -n "${ROLLBACK_REF:-}" ] || { echo "missing env: ROLLBACK_REF" >&2; exit 1; }
[ -n "${RAILWAY_API_TOKEN:-}" ] || { echo "missing env: RAILWAY_API_TOKEN" >&2; exit 1; }
[ -n "${RAILWAY_SERVICE_ID:-}" ] || { echo "missing env: RAILWAY_SERVICE_ID" >&2; exit 1; }
[ -n "${RAILWAY_ENVIRONMENT_ID:-}" ] || { echo "missing env: RAILWAY_ENVIRONMENT_ID" >&2; exit 1; }

case "${ROLLBACK_REF}" in
  *[!0-9a-fA-F]*)
    echo "ROLLBACK_REF must be a hex commit SHA (received '${ROLLBACK_REF}')." >&2
    echo "Roll back from the Railway dashboard (Deployments > last good > Rollback) when only a deployment id is known." >&2
    exit 1
    ;;
esac
if [ "${#ROLLBACK_REF}" -ne 40 ]; then
  echo "ROLLBACK_REF must be a full 40-hex commit SHA (received ${#ROLLBACK_REF} chars)." >&2
  exit 1
fi

export RAILWAY_API_TOKEN RAILWAY_ENVIRONMENT_ID RAILWAY_SERVICE_ID

if [ -n "${RAILWAY_PROJECT_ID:-}" ]; then
  railway link --project "${RAILWAY_PROJECT_ID}" \
    --environment "${RAILWAY_ENVIRONMENT_ID}" </dev/null || true
fi

echo "Restoring app/ from rollback commit ${ROLLBACK_REF}."
git fetch --no-tags --depth 1 origin "${ROLLBACK_REF}" >/dev/null 2>&1 || true
git cat-file -e "${ROLLBACK_REF}^{commit}" 2>/dev/null || {
  echo "Rollback commit ${ROLLBACK_REF} is not present in this checkout; refusing to mutate Railway." >&2
  exit 1
}
git checkout "${ROLLBACK_REF}" -- app

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

echo "Pushing the release VITE_* build contract onto Railway service ${RAILWAY_SERVICE_ID}."
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
    echo "Railway rollback deployment is live."
    break
  fi
  if [ "${status}" = "FAILED" ] || [ "${status}" = "CRASHED" ] || [ "${status}" = "REMOVED" ]; then
    echo "Railway rollback deployment ended in status '${status}'." >&2
    exit 1
  fi
  if [ "${attempt}" -ge "${attempts}" ]; then
    echo "Railway rollback did not go live after ${attempts} attempts." >&2
    exit 1
  fi
  echo "Railway rollback status: ${status:-unknown} (attempt ${attempt}/${attempts})." >&2
  sleep 15
done

production_url="${RAILWAY_PRODUCTION_URL%/}"
if [ -n "${production_url}" ]; then
  curl --fail --show-error --silent --location --max-time 30 "${production_url}" >/dev/null
fi

echo "Railway rollback to ${ROLLBACK_REF} completed."