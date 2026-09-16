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

# Resolve the deployment id currently served by the production alias.
# Mirrors the capture step in deploy-netlify.yml (v4/aliases). Empty on any
# API failure so callers can still attempt the rollback.
resolve_production_deployment() {
  VERCEL_TOKEN="${VERCEL_TOKEN}" \
  VERCEL_ORG_ID="${VERCEL_ORG_ID}" \
  VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID}" \
  VERCEL_STOREFRONT_PRODUCTION_URL="${VERCEL_STOREFRONT_PRODUCTION_URL:-}" \
  node <<'NODE' 2>/dev/null || true
const { execFileSync } = require('child_process');

const aliasUrl = String(process.env.VERCEL_STOREFRONT_PRODUCTION_URL || '').trim();
let host = '';
try {
  host = new URL(aliasUrl).hostname;
} catch {
  process.exit(0);
}
if (!host) process.exit(0);

let raw = '';
try {
  raw = execFileSync(
    'curl',
    [
      '--fail', '--show-error', '--silent', '--location', '--get',
      '--header', `Authorization: Bearer ${process.env.VERCEL_TOKEN}`,
      '--data-urlencode', `projectId=${process.env.VERCEL_PROJECT_ID}`,
      '--data-urlencode', `teamId=${process.env.VERCEL_ORG_ID}`,
      `https://api.vercel.com/v4/aliases/${host}`,
    ],
    { encoding: 'utf8', timeout: 30000 }
  );
} catch {
  process.exit(0);
}
try {
  const state = JSON.parse(raw);
  process.stdout.write(state.deploymentId || (state.deployment && state.deployment.id) || '');
} catch {
  process.exit(0);
}
NODE
}
vercel_config_directory="${project_directory%/}/.vercel"
vercel_link_file="${vercel_config_directory}/project.json"
mkdir -p "${vercel_config_directory}"
VERCEL_LINK_FILE="${vercel_link_file}" node <<'NODE'
const fs = require('fs');

const linkFile = process.env.VERCEL_LINK_FILE;
const expectedOrgId = process.env.VERCEL_ORG_ID;
const expectedProjectId = process.env.VERCEL_PROJECT_ID;
fs.writeFileSync(
  linkFile,
  `${JSON.stringify({ orgId: expectedOrgId, projectId: expectedProjectId })}\n`,
  { mode: 0o600 }
);
const linked = JSON.parse(fs.readFileSync(linkFile, 'utf8'));

if (linked.orgId !== expectedOrgId || linked.projectId !== expectedProjectId) {
  console.error(
    `Vercel linked project mismatch: expected ${expectedOrgId}/${expectedProjectId}, ` +
    `received ${linked.orgId || '<missing>'}/${linked.projectId || '<missing>'}.`
  );
  process.exit(1);
}
NODE

current_production_deployment="$(resolve_production_deployment)"

if [[ -n "${rollback_ref}" && -n "${current_production_deployment}" && "${current_production_deployment}" == "${rollback_ref}" ]]; then
  echo "Production alias already serves ${rollback_ref}; nothing to roll back."
elif [[ -n "${rollback_ref}" ]]; then
  echo "Requesting Vercel storefront rollback to ${rollback_ref}."
  if npx vercel rollback "${rollback_ref}" \
    --cwd "${project_directory}" \
    --token "${VERCEL_TOKEN}" \
    --timeout 120s; then
    : # rollback accepted
  else
    # Tolerate the already-current race: Vercel rejects such a rollback
    # with 422. Re-resolve the alias; succeed only if it serves the target.
    rollback_exit=1
    current_production_deployment="$(resolve_production_deployment)"
    if [[ -n "${current_production_deployment}" && "${current_production_deployment}" == "${rollback_ref}" ]]; then
      echo "Rollback reported an error but the production alias serves ${rollback_ref}; treating as rolled back."
      rollback_exit=0
    fi
    if [[ "${rollback_exit}" -ne 0 ]]; then
      echo "Vercel storefront rollback to ${rollback_ref} failed and the production alias serves '${current_production_deployment:-<unknown>}'." >&2
      exit 1
    fi
  fi
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
