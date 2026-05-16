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

trim_trailing_slash() {
  local value="${1:-}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s' "${value%/}"
}

require_command curl
require_command jq
require_env NETLIFY_AUTH_TOKEN
require_env NETLIFY_SITE_ID

api_base="${NETLIFY_API_BASE:-https://api.netlify.com/api/v1}"
rollback_ref="${ROLLBACK_REF:-}"
deploys_file="$(mktemp)"
restore_file="$(mktemp)"

curl --fail --show-error --silent --location \
  --header "Authorization: Bearer ${NETLIFY_AUTH_TOKEN}" \
  "${api_base}/sites/${NETLIFY_SITE_ID}/deploys?per_page=30" \
  > "${deploys_file}"

if [[ -n "${rollback_ref}" ]]; then
  target_id="$(
    jq -r --arg ref "${rollback_ref}" '
      [
        .[]
        | select(
            (.id == $ref)
            or ((.commit_ref // "") | startswith($ref))
            or ((.deploy_url // "") | contains($ref))
          )
      ]
      | first
      | .id // empty
    ' "${deploys_file}"
  )"
else
  target_id="$(
    jq -r '
      [
        .[]
        | select(.state == "old" or .state == "ready")
      ]
      | first
      | .id // empty
    ' "${deploys_file}"
  )"
fi

if [[ -z "${target_id}" ]]; then
  echo "Could not resolve a Netlify deploy to restore. Set ROLLBACK_REF to a deploy id, deploy URL fragment, or commit SHA." >&2
  exit 1
fi

echo "Restoring Netlify deploy ${target_id}."

curl --fail --show-error --silent --location \
  --request POST \
  --header "Authorization: Bearer ${NETLIFY_AUTH_TOKEN}" \
  "${api_base}/sites/${NETLIFY_SITE_ID}/deploys/${target_id}/restore" \
  > "${restore_file}"

jq -r '"Restored Netlify deploy: \(.id) state=\(.state // "unknown") url=\(.deploy_ssl_url // .deploy_url // .url // "unknown")"' "${restore_file}"

production_url="$(trim_trailing_slash "${NETLIFY_PRODUCTION_URL:-}")"
if [[ -n "${production_url}" ]]; then
  curl --fail --show-error --silent --location --max-time 30 "${production_url}" >/dev/null
fi

echo "Netlify rollback completed."
