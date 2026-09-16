#!/usr/bin/env bash
# Railway storefront rollback.
#
# ROLLBACK_REF accepts two shapes:
#   - a Railway deployment id (preferred): restore that deployment's snapshot
#     (image + variables) via the GraphQL deploymentRollback mutation — no
#     rebuild, exact prior bytes and configuration.
#   - a full 40-hex commit SHA (fallback): rebuild that commit from source by
#     re-uploading the app/ tree with the release VITE_* build contract. Used
#     when the snapshot is outside Railway's retention window or only a SHA
#     is known (manual rollback_refs_json entries from older releases).
# Called by rollback-railway.yml and scripts/rollback-railway.sh callers.
set -euo pipefail

require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Required command '${name}' was not found on PATH." >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

require_command curl
require_command jq
require_command railway
require_command git
require_command node
require_env ROLLBACK_REF
require_env RAILWAY_API_TOKEN
require_env RAILWAY_SERVICE_ID
require_env RAILWAY_ENVIRONMENT_ID

export RAILWAY_API_TOKEN RAILWAY_ENVIRONMENT_ID RAILWAY_SERVICE_ID
# Project tokens authenticate the CLI through RAILWAY_TOKEN (RAILWAY_API_TOKEN
# is our GitHub-secret name; account tokens are a different Railway concept).
export RAILWAY_TOKEN="${RAILWAY_API_TOKEN}"

if [ -n "${RAILWAY_PROJECT_ID:-}" ]; then
  railway link --project "${RAILWAY_PROJECT_ID}" \
    --environment "${RAILWAY_ENVIRONMENT_ID}" </dev/null || true
fi

wait_for_success_deployment() {
  local attempts=60
  local attempt=0
  local deployments status
  while [ "${attempt}" -lt "${attempts}" ]; do
    attempt=$((attempt + 1))
    deployments="$(railway deployment list \
      --service "${RAILWAY_SERVICE_ID}" \
      --environment "${RAILWAY_ENVIRONMENT_ID}" \
      --json 2>/dev/null || echo '[]')"
    status="$(printf '%s' "${deployments}" | jq -r '[.[]?] | map(select(.status != null)) | .[0].status // empty' 2>/dev/null || true)"

    if [ "${status}" = "SUCCESS" ]; then
      echo "Railway deployment is live."
      return 0
    fi
    if [ "${status}" = "FAILED" ] || [ "${status}" = "CRASHED" ] || [ "${status}" = "REMOVED" ]; then
      echo "Railway deployment ended in status '${status}'." >&2
      return 1
    fi
    echo "Railway deployment status: ${status:-unknown} (attempt ${attempt}/${attempts})." >&2
    if [ "${attempt}" -ge "${attempts}" ]; then
      echo "Railway deployment did not go live after ${attempts} attempts." >&2
      return 1
    fi
    sleep 15
  done
}

verify_production_url() {
  local production_url="${RAILWAY_PRODUCTION_URL%/}"
  if [ -n "${production_url}" ]; then
    curl --fail --show-error --silent --location --max-time 30 "${production_url}" >/dev/null
  fi
}

rollback_ref="${ROLLBACK_REF}"
case "${rollback_ref}" in
  *[!0-9a-zA-Z-]*)
    echo "ROLLBACK_REF must be a Railway deployment id or a 40-hex commit SHA (received '${rollback_ref}')." >&2
    exit 1
    ;;
esac

if [[ "${rollback_ref}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  # ---------------------------------------------------------------- fallback:
  # rebuild the pinned commit from source (snapshot outside retention, or a
  # manual SHA-only ref). Byte-comparable with a normal release build because
  # the same VITE_* contract is pushed before the upload.
  echo "ROLLBACK_REF is a commit SHA; rebuilding commit ${rollback_ref} from source."

  echo "Restoring app/ from rollback commit ${rollback_ref}."
  git fetch --no-tags --depth 1 origin "${rollback_ref}" >/dev/null 2>&1 || true
  git cat-file -e "${rollback_ref}^{commit}" 2>/dev/null || {
    echo "Rollback commit ${rollback_ref} is not present in this checkout; refusing to mutate Railway." >&2
    exit 1
  }
  git checkout "${rollback_ref}" -- app

  echo "Pushing the release VITE_* build contract onto Railway service ${RAILWAY_SERVICE_ID}."
  node scripts/railway-vars.cjs push

  # Repo-root build context — same staging as scripts/deploy-railway.sh
  # (app/ plus the repo-root inputs the Vite build graph imports).
  stage_dir="${RUNNER_TEMP:-/tmp}/railway-upload-rollback"
  rm -rf "${stage_dir}"
  mkdir -p "${stage_dir}/config" "${stage_dir}/shared"
  cp -a app/. "${stage_dir}/app/"
  cp config/desktopAuthLoopback.cjs "${stage_dir}/config/desktopAuthLoopback.cjs"
  cp shared/assistantCapabilities.json "${stage_dir}/shared/assistantCapabilities.json"
  cp app/railway.toml "${stage_dir}/railway.toml"
  cp .dockerignore "${stage_dir}/.dockerignore"

  # Per-rollback Docker cache-buster (see app/Dockerfile.railway): unique per
  # execution so the rebuild actually runs with the pushed contract instead
  # of reusing a stale cached dist/.
  printf '%s' "rollback-${rollback_ref}-$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${stage_dir}/app/.railway-build-id"

  # app/.env.production for the rebuild (same rationale as
  # scripts/deploy-railway.sh): generated from the same contract builder
  # railway-vars.cjs pushes, non-empty VITE_* only.
  RAILWAY_ENV_FILE="${stage_dir}/app/.env.production" node -e '
    const fs = require("fs");
    const { buildRailwayBuildEnv } = require("./scripts/railway-release-env.cjs");
    const lines = Object.entries(buildRailwayBuildEnv())
      .filter(([key, value]) => key.startsWith("VITE_") && value !== "")
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}=${value}`);
    fs.writeFileSync(process.env.RAILWAY_ENV_FILE, `${lines.join("\n")}\n`);
  '

  railway up "${stage_dir}" --path-as-root \
    --environment "${RAILWAY_ENVIRONMENT_ID}" \
    --service "${RAILWAY_SERVICE_ID}" \
    --ci --detach

  wait_for_success_deployment
  verify_production_url
  echo "Railway rollback to commit ${rollback_ref} completed."
  exit 0
fi

# ------------------------------------------------------------------- primary:
# restore the captured deployment's snapshot (image + variables) via GraphQL.
echo "Restoring Railway deployment ${rollback_ref} via snapshot rollback."
rollback_response="$(mktemp)"
# Project tokens authenticate with the Project-Access-Token header; Bearer is
# rejected for project-scoped operations.
mutation='mutation($id: String!) { deploymentRollback(id: $id) }'
if ! curl --fail --show-error --silent --location \
    --header "Project-Access-Token: ${RAILWAY_API_TOKEN}" \
    --header "Content-Type: application/json" \
    --data "$(jq -n --arg q "${mutation}" --arg id "${rollback_ref}" '{query: $q, variables: {id: $id}}')" \
    "https://backboard.railway.com/graphql/v2" \
    > "${rollback_response}"; then
  echo "Railway rollback mutation call failed." >&2
  exit 1
fi

if jq -e '.errors != null and (.errors | length > 0)' "${rollback_response}" >/dev/null 2>&1; then
  jq -r '.errors[].message' "${rollback_response}" >&2
  echo "Railway rejected the snapshot rollback of ${rollback_ref}." >&2
  exit 1
fi

echo "Railway snapshot rollback triggered; waiting for it to go live."
wait_for_success_deployment
verify_production_url
echo "Railway snapshot rollback to deployment ${rollback_ref} completed."
