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
require_command node
require_command npx
require_env VERCEL_TOKEN
require_env VERCEL_ORG_ID
require_env VERCEL_PROJECT_ID

rollback_ref="${ROLLBACK_REF:-}"
project_directory="${VERCEL_STOREFRONT_PROJECT_DIRECTORY:-.}"

npx vercel link \
  --cwd "${project_directory}" \
  --yes \
  --project "${VERCEL_PROJECT_ID}" \
  --token "${VERCEL_TOKEN}"

vercel_link_file="${project_directory%/}/.vercel/project.json"
VERCEL_LINK_FILE="${vercel_link_file}" node <<'NODE'
const fs = require('fs');

const linkFile = process.env.VERCEL_LINK_FILE;
const expectedOrgId = process.env.VERCEL_ORG_ID;
const expectedProjectId = process.env.VERCEL_PROJECT_ID;
const linked = JSON.parse(fs.readFileSync(linkFile, 'utf8'));

if (linked.orgId !== expectedOrgId || linked.projectId !== expectedProjectId) {
  console.error(
    `Vercel linked project mismatch: expected ${expectedOrgId}/${expectedProjectId}, ` +
    `received ${linked.orgId || '<missing>'}/${linked.projectId || '<missing>'}.`
  );
  process.exit(1);
}
NODE

if [[ -n "${rollback_ref}" ]]; then
  echo "Requesting Vercel storefront rollback to ${rollback_ref}."
  npx vercel rollback "${rollback_ref}" \
    --cwd "${project_directory}" \
    --token "${VERCEL_TOKEN}" \
    --timeout 120s
else
  echo "Requesting Vercel storefront rollback to the previous production deployment."
  npx vercel rollback \
    --cwd "${project_directory}" \
    --token "${VERCEL_TOKEN}" \
    --timeout 120s
fi

npx vercel rollback status "${VERCEL_PROJECT_ID}" \
  --cwd "${project_directory}" \
  --token "${VERCEL_TOKEN}" \
  --timeout 120s

storefront_url="$(trim_trailing_slash "${VERCEL_STOREFRONT_PRODUCTION_URL:-}")"
if [[ -n "${storefront_url}" ]]; then
  curl --fail --show-error --silent --location --max-time 30 "${storefront_url}" >/dev/null
fi

echo "Vercel storefront rollback completed."
