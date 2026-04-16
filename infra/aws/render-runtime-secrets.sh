#!/usr/bin/env bash
set -euo pipefail

aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
path_prefix="${AWS_PARAMETER_STORE_PATH_PREFIX:-}"
output_file="${AURA_RUNTIME_SECRETS_FILE:-/opt/aura/shared/runtime-secrets.env}"

if [[ -z "${aws_region}" ]]; then
  echo "AWS_REGION or AWS_DEFAULT_REGION is required" >&2
  exit 1
fi

if [[ -z "${path_prefix}" ]]; then
  echo "AWS_PARAMETER_STORE_PATH_PREFIX is required" >&2
  exit 1
fi

mkdir -p "$(dirname "${output_file}")"

aws ssm get-parameters-by-path \
  --region "${aws_region}" \
  --path "${path_prefix}" \
  --with-decryption \
  --recursive \
  --output json \
  | jq -r '
      (.Parameters // [])
      | sort_by(.Name)
      | .[]
      | "\(.Name | split("/")[-1])=\(.Value | gsub("\r"; "") | gsub("\n"; "\\n"))"
    ' > "${output_file}"

chmod 600 "${output_file}"
echo "Wrote runtime secrets to ${output_file}"
