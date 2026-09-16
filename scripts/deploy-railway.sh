#!/usr/bin/env bash
# Railway storefront production deploy: push CI's build-env contract, upload
# the release app/ tree, and wait for SUCCESS. Called by the
# deploy-railway-production job in deploy-netlify.yml.
#
# The parity variables are left standing on the service after the deploy:
# the next release overwrites them, and removing them afterwards would
# trigger variable-delete redeploys of the live site without release
# metadata (Railway redeploys on variable changes; only writes honour
# --skip-deploys).
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
# Project tokens authenticate the CLI through RAILWAY_TOKEN (RAILWAY_API_TOKEN
# is our GitHub-secret name; account tokens are a different Railway concept).
export RAILWAY_TOKEN="${RAILWAY_API_TOKEN}"

if [ -n "${RAILWAY_PROJECT_ID:-}" ]; then
  if ! railway link --project "${RAILWAY_PROJECT_ID}" \
    --environment "${RAILWAY_ENVIRONMENT_ID}" </dev/null; then
    echo "warning: 'railway link' failed; continuing with explicit --project/--environment/--service flags." >&2
  fi
fi

# Fail fast when the token cannot query the Railway API: every step below
# (variable push, upload, status poll) needs it.
if ! railway deployment list \
  --service "${RAILWAY_SERVICE_ID}" \
  --environment "${RAILWAY_ENVIRONMENT_ID}" \
  --json >/dev/null 2>&1; then
  echo "Railway API probe failed. Check that RAILWAY_API_TOKEN is valid and has access to service ${RAILWAY_SERVICE_ID} in environment ${RAILWAY_ENVIRONMENT_ID}." >&2
  exit 1
fi

echo "Pushing CI build-env parity vars onto Railway service ${RAILWAY_SERVICE_ID}."
node scripts/railway-vars.cjs push

# Stage a REPO-ROOT build context: app/railway.toml sets
# dockerfilePath = "app/Dockerfile.railway" and the Dockerfile COPYs
# app/…, config/desktopAuthLoopback.cjs and shared/assistantCapabilities.json
# from the context root, so uploading ./app alone cannot build (that failed
# in the first seven-host release). The repo-root .dockerignore keeps the
# uploaded context lean.
stage_dir="${RUNNER_TEMP:-/tmp}/railway-upload"
rm -rf "${stage_dir}"
mkdir -p "${stage_dir}/config" "${stage_dir}/shared"
cp -a app/. "${stage_dir}/app/"
cp config/desktopAuthLoopback.cjs "${stage_dir}/config/desktopAuthLoopback.cjs"
cp shared/assistantCapabilities.json "${stage_dir}/shared/assistantCapabilities.json"
cp app/railway.toml "${stage_dir}/railway.toml"
cp .dockerignore "${stage_dir}/.dockerignore"

railway up "${stage_dir}" --path-as-root \
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
  if [ "${status}" = "SKIPPED" ]; then
    echo "Railway deploy was SKIPPED (terminal): the service ignored this CI upload." >&2
    echo "Check the Railway dashboard for service ${RAILWAY_SERVICE_ID}: a GitHub-connected auto-deploy, a superseding deployment, or branch/environment rules may be skipping CLI uploads." >&2
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
