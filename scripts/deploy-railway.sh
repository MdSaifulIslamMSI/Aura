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

# Per-release Docker cache-buster (see app/Dockerfile.railway): unique every
# release so `RUN npm run build` re-executes with the pushed VITE_* vars
# instead of reusing a stale cached dist/. Written only into the upload
# staging area, never into the repo working tree.
printf '%s' "${GITHUB_SHA:?}-$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${stage_dir}/app/.railway-build-id"

# app/.env.production for the Railway build: Vite always loads it, so the
# build inlines the CI contract even though `railway up` Docker builds do not
# receive service variables. Only non-empty vars are written, mirroring the
# CI empty-drop loop (dropped vars stay undefined on every lane). Values are
# URLs/IDs/flags (dotenv-safe by construction).
while IFS='=' read -r key value; do
  [ -n "$key" ] || continue
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$key" "$value" >> "${stage_dir}/app/.env.production"
  fi
done < <(env | grep -E '^VITE_[A-Za-z0-9_]*=' || true)

# Track OUR deployment by id instead of blindly polling the latest one: when
# another trigger (e.g. a GitHub-connected auto-deploy) creates deployments
# concurrently, list[0] may be someone else's. The Build Logs URL carries ours.
up_log="$(mktemp)"
railway up "${stage_dir}" --path-as-root \
  --environment "${RAILWAY_ENVIRONMENT_ID}" \
  --service "${RAILWAY_SERVICE_ID}" \
  --ci --detach >"${up_log}" 2>&1 || {
  cat "${up_log}" >&2
  echo "railway up failed to create a deployment." >&2
  exit 1
}
cat "${up_log}" >&2
our_deployment_id="$(grep -Eo '[?&]id=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' "${up_log}" | head -n 1 | cut -d= -f2 || true)"
if [ -z "${our_deployment_id}" ]; then
  echo "warning: could not determine our Railway deployment id from 'railway up' output; polling the latest deployment." >&2
else
  echo "Polling our Railway deployment ${our_deployment_id}."
fi

attempts=60
attempt=0
while [ "${attempt}" -lt "${attempts}" ]; do
  attempt=$((attempt + 1))
  deployments="$(railway deployment list \
    --service "${RAILWAY_SERVICE_ID}" \
    --environment "${RAILWAY_ENVIRONMENT_ID}" \
    --json 2>/dev/null || echo '[]')"
  if [ -n "${our_deployment_id:-}" ]; then
    status="$(printf '%s' "${deployments}" | jq -r --arg id "${our_deployment_id}" '[.[]?] | map(select(.status != null)) | (map(select(.id == $id))[0] | .status // "NOT_FOUND")' 2>/dev/null || true)"
    [ -n "${status}" ] || status="NOT_FOUND"
  else
    status="$(printf '%s' "${deployments}" | jq -r '[.[]?] | map(select(.status != null)) | .[0].status // empty' 2>/dev/null || true)"
  fi

  if [ "${status}" = "SUCCESS" ]; then
    if [ -n "${our_deployment_id:-}" ]; then
      echo "Railway deploy ${our_deployment_id} is live."
    else
      echo "Railway deploy is live."
    fi
    break
  fi
  if [ "${status}" = "NOT_FOUND" ]; then
    echo "Railway deploy status: our deployment ${our_deployment_id} is not listed yet (attempt ${attempt}/${attempts})." >&2
    if [ "${attempt}" -ge "${attempts}" ]; then
      echo "Railway deployment ${our_deployment_id} never appeared in the deployment list." >&2
      exit 1
    fi
    sleep 15
    continue
  fi
  if [ "${status}" = "FAILED" ] || [ "${status}" = "CRASHED" ] || [ "${status}" = "REMOVED" ]; then
    echo "Railway deploy ended in status '${status}'." >&2
    exit 1
  fi
  if [ "${status}" = "SKIPPED" ]; then
    echo "Railway deploy ${our_deployment_id:-unknown} was SKIPPED (terminal): the service ignored this CI upload." >&2
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

# Serving check: a SUCCESS deployment status is not enough — confirm the
# public URL actually serves this release. Guards stale routing (service
# still pinned to an older deployment) and wrong service/environment wiring.
if [ -n "${RAILWAY_PRODUCTION_URL:-}" ] && [ -n "${GITHUB_SHA:-}" ]; then
  short_sha="$(printf '%s' "${GITHUB_SHA}" | cut -c1-8)"
  serving_ok=""
  for serving_attempt in 1 2 3 4 5 6; do
    served_commit="$(curl --silent --fail --show-error --location --max-time 20 "${RAILWAY_PRODUCTION_URL%/}/" 2>/dev/null | grep -Eo 'name="aura-release-commit" content="[^"]*"' | head -n 1 | sed -E 's/.*content="([^"]*)".*/\1/' || true)"
    if [ -n "${served_commit}" ] && [ "${served_commit}" = "${short_sha}" ]; then
      echo "Railway public URL serves release commit ${served_commit}."
      serving_ok=true
      break
    fi
    echo "Railway public URL serves commit '${served_commit:-<unknown>}' (want ${short_sha}; attempt ${serving_attempt}/6)." >&2
    sleep 20
  done
  if [ -z "${serving_ok}" ]; then
    echo "Railway deployment ${our_deployment_id:-unknown} reports SUCCESS but the public URL does not serve release ${short_sha}." >&2
    echo "Recent deployments (id/status/createdAt):" >&2
    railway deployment list \
      --service "${RAILWAY_SERVICE_ID}" \
      --environment "${RAILWAY_ENVIRONMENT_ID}" \
      --json 2>/dev/null | jq -c '[.[]? | {id: .id, status: .status, createdAt: (.createdAt // .created_at // null)}]' >&2 || true
    echo "Check the Railway dashboard: the public domain may be bound to a different service/environment, or traffic is pinned to a stale deployment." >&2
    exit 1
  fi
fi
