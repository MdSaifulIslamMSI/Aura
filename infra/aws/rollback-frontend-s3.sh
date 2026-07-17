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

aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-south-1}}"
rollback_ref="${ROLLBACK_REF:-}"
backup_root="_aura-rollback"

require_env AWS_FRONTEND_BUCKET
require_env AWS_FRONTEND_DISTRIBUTION_ID

backup_prefix=""
if [[ -n "${rollback_ref}" ]]; then
  snapshot_manifest_key="${backup_root}/${rollback_ref}/.aura-rollback-manifest.json"
  if aws s3api head-object \
    --region "${aws_region}" \
    --bucket "${AWS_FRONTEND_BUCKET}" \
    --key "${snapshot_manifest_key}" \
    >/dev/null 2>&1; then
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
    --exclude "${backup_root}/*" \
    --exclude ".aura-rollback-manifest.json"
else
  echo "No completed AWS frontend rollback snapshot matched '${rollback_ref:-latest}'. Refusing to execute target code in the credentialed restore job." >&2
  exit 1
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
