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

require_command npx
require_env VERCEL_TOKEN

rollback_ref="${ROLLBACK_REF:-}"
vercel_scope="${VERCEL_SCOPE:-mdsaifulislammsis-projects}"
gateway_project="${VERCEL_GATEWAY_PROJECT_NAME:-aura-gateway}"

npx vercel link \
  --cwd gateway \
  --yes \
  --project "${gateway_project}" \
  --scope "${vercel_scope}" \
  --token "${VERCEL_TOKEN}"

if [[ -n "${rollback_ref}" ]]; then
  echo "Requesting Vercel gateway rollback to ${rollback_ref}."
  npx vercel rollback "${rollback_ref}" \
    --cwd gateway \
    --scope "${vercel_scope}" \
    --token "${VERCEL_TOKEN}" \
    --timeout 120s
else
  echo "Requesting Vercel gateway rollback to the previous production deployment."
  npx vercel rollback \
    --cwd gateway \
    --scope "${vercel_scope}" \
    --token "${VERCEL_TOKEN}" \
    --timeout 120s
fi

npx vercel rollback status "${gateway_project}" \
  --cwd gateway \
  --scope "${vercel_scope}" \
  --token "${VERCEL_TOKEN}" \
  --timeout 120s

gateway_url="$(trim_trailing_slash "${GATEWAY_PRODUCTION_URL:-https://aura-gateway.vercel.app}")"
curl --fail --show-error --silent --location --max-time 30 "${gateway_url}" >/dev/null

echo "Vercel gateway rollback completed."
