#!/usr/bin/env bash
# Cloudflare Pages storefront rollback: restore the deployment that was live
# before the failed release via the Pages REST API (re-serves that
# deployment's snapshot — no rebuild). Called by rollback-cloudflare.yml.
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
require_env CLOUDFLARE_API_TOKEN
require_env CLOUDFLARE_ACCOUNT_ID

# An empty ROLLBACK_REF is deliberately allowed through by the capture step
# when the release was acknowledged without a rollback target
# (allow_missing_rollback_target=true: first-ever release or capture miss).
# There is nothing to restore, so skip gracefully instead of failing the
# release. When the Cloudflare deploy itself failed, production still serves
# whatever was live before, which is exactly the desired end state.
if [[ -z "${ROLLBACK_REF:-}" ]]; then
  echo "No Cloudflare Pages rollback target was captured; nothing to restore, skipping."
  exit 0
fi

project="${CLOUDFLARE_PAGES_PROJECT:-aura-storefront}"
api_base="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project}"
rollback_ref="${ROLLBACK_REF}"

# Confirm the target deployment still exists before mutating.
deploy_file="$(mktemp)"
curl --fail --show-error --silent --location \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "${api_base}/deployments/${rollback_ref}" \
  > "${deploy_file}"

success="$(jq -r '.success // false' "${deploy_file}")"
if [ "${success}" != "true" ]; then
  jq -r '.errors[]?.message // "unknown API error"' "${deploy_file}" >&2
  echo "Cloudflare deployment ${rollback_ref} could not be found; refusing to roll back." >&2
  exit 1
fi

echo "Restoring Cloudflare Pages deployment ${rollback_ref}."

rollback_file="$(mktemp)"
curl --fail --show-error --silent --location \
  --request POST \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "${api_base}/deployments/${rollback_ref}/rollback" \
  > "${rollback_file}"

rollback_success="$(jq -r '.success // false' "${rollback_file}")"
if [ "${rollback_success}" != "true" ]; then
  jq -r '.errors[]?.message // "unknown API error"' "${rollback_file}" >&2
  echo "Cloudflare Pages rollback of ${rollback_ref} failed." >&2
  exit 1
fi

# The rollback re-serves the stored snapshot immediately; give the CDN a
# moment, then confirm the production URL serves the app shell.
sleep 10
production_url="${CLOUDFLARE_PAGES_PRODUCTION_URL%/}"
if [ -n "${production_url}" ]; then
  curl --fail --show-error --silent --location --max-time 30 "${production_url}" >/dev/null
fi

echo "Cloudflare Pages rollback completed."
