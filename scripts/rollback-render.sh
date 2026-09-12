#!/usr/bin/env bash
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
require_env RENDER_API_KEY
require_env RENDER_SERVICE_ID

api_base="${RENDER_API_BASE:-https://api.render.com/v1}"
rollback_ref="${ROLLBACK_REF:-}"

if [[ -z "${rollback_ref}" ]]; then
  echo "Render rollback requires ROLLBACK_REF: the deploy id that was live before the failed release." >&2
  exit 1
fi

deploy_file="$(mktemp)"
curl --fail --show-error --silent --location \
  --header "Authorization: Bearer ${RENDER_API_KEY}" \
  "${api_base}/services/${RENDER_SERVICE_ID}/deploys/${rollback_ref}" \
  > "${deploy_file}"

target_status="$(jq -r '.status // empty' "${deploy_file}")"
target_commit="$(jq -r '.commit.id // empty' "${deploy_file}")"

if [[ -z "${target_status}" ]]; then
  echo "Render deploy ${rollback_ref} could not be found; refusing to roll back." >&2
  exit 1
fi

if [[ "${target_status}" == "live" ]]; then
  echo "Render deploy ${rollback_ref} is already live; nothing to roll back."
  exit 0
fi

echo "Restoring Render deploy ${rollback_ref} (status=${target_status})."

rollback_file="$(mktemp)"
if curl --fail --show-error --silent --location \
    --request POST \
    --header "Authorization: Bearer ${RENDER_API_KEY}" \
    --header "Content-Type: application/json" \
    --data "{\"deployId\":\"${rollback_ref}\"}" \
    "${api_base}/services/${RENDER_SERVICE_ID}/rollback" \
    > "${rollback_file}"; then
  echo "Triggered Render rollback to deploy ${rollback_ref}."
elif [[ -z "${target_commit}" ]]; then
  echo "Render rollback endpoint failed and deploy ${rollback_ref} has no commit id for a pinned rebuild." >&2
  exit 1
else
  # Artifact retention varies by workspace plan; rebuild the captured commit
  # when the rollback endpoint cannot reuse the stored artifact.
  echo "Render rollback endpoint failed; rebuilding commit ${target_commit} instead." >&2
  curl --fail --show-error --silent --location \
    --request POST \
    --header "Authorization: Bearer ${RENDER_API_KEY}" \
    --header "Content-Type: application/json" \
    --data "{\"commitId\":\"${target_commit}\"}" \
    "${api_base}/services/${RENDER_SERVICE_ID}/deploys" \
    > "${rollback_file}"
fi

rollback_id="$(jq -r '.id // empty' "${rollback_file}")"
if [[ -z "${rollback_id}" ]]; then
  echo "Render rollback did not return a deploy id." >&2
  exit 1
fi

poll_attempts=60
for attempt in $(seq 1 "${poll_attempts}"); do
  status="$(curl --fail --show-error --silent --location \
    --header "Authorization: Bearer ${RENDER_API_KEY}" \
    "${api_base}/services/${RENDER_SERVICE_ID}/deploys/${rollback_id}" \
    | jq -r '.status // empty' || true)"
  case "${status}" in
    live)
      echo "Render deploy ${rollback_id} is live."
      break
      ;;
    build_failed|update_failed|pre_deploy_failed|canceled|deactivated)
      echo "Render deploy ${rollback_id} ended in status '${status}'." >&2
      exit 1
      ;;
  esac
  echo "Render rollback deploy ${rollback_id} status: ${status:-unknown} (attempt ${attempt}/${poll_attempts})." >&2
  if [ "${attempt}" -eq "${poll_attempts}" ]; then
    echo "Render rollback did not go live after ${poll_attempts} attempts." >&2
    exit 1
  fi
  sleep 15
done

production_url="${RENDER_PRODUCTION_URL%/}"
if [[ -n "${production_url}" ]]; then
  curl --fail --show-error --silent --location --max-time 30 "${production_url}" >/dev/null
fi

echo "Render rollback completed."
