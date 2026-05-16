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

require_command aws
require_command npm
require_command node

aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-south-1}}"
rollback_ref="${ROLLBACK_REF:-}"
backup_root="${AWS_FRONTEND_ROLLBACK_PREFIX:-_aura-rollback}"

require_env AWS_FRONTEND_BUCKET
require_env AWS_FRONTEND_DISTRIBUTION_ID

backup_prefix=""
if [[ -n "${rollback_ref}" ]]; then
  if aws s3 ls "s3://${AWS_FRONTEND_BUCKET}/${backup_root}/${rollback_ref}/" --region "${aws_region}" >/dev/null 2>&1; then
    backup_prefix="${backup_root}/${rollback_ref}"
  fi
else
  backup_prefix="$(
    aws s3api list-objects-v2 \
      --region "${aws_region}" \
      --bucket "${AWS_FRONTEND_BUCKET}" \
      --prefix "${backup_root}/" \
      --query "reverse(sort_by(Contents[?ends_with(Key, '.aura-rollback-manifest.json')], &LastModified))[0].Key" \
      --output text \
      | sed -E 's#/\.aura-rollback-manifest\.json$##'
  )"
  if [[ "${backup_prefix}" == "None" ]]; then
    backup_prefix=""
  fi
fi

if [[ -n "${backup_prefix}" ]]; then
  echo "Restoring AWS frontend from s3://${AWS_FRONTEND_BUCKET}/${backup_prefix}/."

  aws s3 sync "s3://${AWS_FRONTEND_BUCKET}/${backup_prefix}" "s3://${AWS_FRONTEND_BUCKET}" \
    --region "${aws_region}" \
    --delete \
    --exclude "_aura-rollback/*" \
    --exclude ".aura-rollback-manifest.json"
else
  if [[ -z "${rollback_ref}" ]]; then
    echo "No AWS frontend rollback snapshot was found. Provide ROLLBACK_REF to rebuild and publish a specific git ref." >&2
    exit 1
  fi

  require_env AURA_BACKEND_ORIGIN

  backend_origin="$(trim_trailing_slash "${AURA_BACKEND_ORIGIN}")"
  if [[ ! "${backend_origin}" =~ ^https:// ]]; then
    echo "AURA_BACKEND_ORIGIN must be an absolute HTTPS URL for rebuild rollback. Received '${backend_origin}'." >&2
    exit 1
  fi

  echo "No snapshot matched '${rollback_ref}'. Rebuilding checked-out frontend ref for AWS rollback."
  npm --prefix app ci

  built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  VITE_DEPLOY_TARGET=multi-host \
  VITE_API_URL="${backend_origin}/api" \
  VITE_RELEASE_ID="${rollback_ref}" \
  VITE_RELEASE_SHA="${rollback_ref}" \
  VITE_RELEASE_CHANNEL=production \
  VITE_RELEASE_SOURCE=github-actions-rollback \
  VITE_RELEASE_TIME="${built_at}" \
    npm --prefix app run build

  aws s3 sync app/dist "s3://${AWS_FRONTEND_BUCKET}" \
    --region "${aws_region}" \
    --delete \
    --exclude "_aura-rollback/*" \
    --cache-control "public,max-age=300"

  if [[ -d app/dist/assets ]]; then
    aws s3 sync app/dist/assets "s3://${AWS_FRONTEND_BUCKET}/assets" \
      --region "${aws_region}" \
      --delete \
      --cache-control "public,max-age=31536000,immutable"
  fi

  aws s3 cp app/dist/index.html "s3://${AWS_FRONTEND_BUCKET}/index.html" \
    --region "${aws_region}" \
    --cache-control "no-cache,no-store,must-revalidate" \
    --content-type "text/html"
fi

aws cloudfront create-invalidation \
  --distribution-id "${AWS_FRONTEND_DISTRIBUTION_ID}" \
  --paths "/*" \
  >/dev/null

public_url="$(trim_trailing_slash "${AWS_FRONTEND_PUBLIC_URL:-}")"
if [[ -n "${public_url}" ]]; then
  curl --fail --show-error --silent --location --max-time 30 "${public_url}" >/dev/null
fi

echo "AWS frontend rollback completed."
