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

parameters_file="$(mktemp)"
trap 'rm -f "${parameters_file}"' EXIT
chmod 600 "${parameters_file}"

aws ssm get-parameters-by-path \
  --region "${aws_region}" \
  --path "${path_prefix}" \
  --with-decryption \
  --recursive \
  --output json > "${parameters_file}"

invalid_parameter_names="$(
  jq -r '
    (.Parameters // [])
    | .[]
    | .Name as $name
    | ($name | split("/")[-1]) as $key
    | select(($key | test("^[A-Za-z_][A-Za-z0-9_]*$")) | not)
    | $name
  ' "${parameters_file}"
)"

if [[ -n "${invalid_parameter_names}" ]]; then
  echo "Refusing to write runtime secrets: Parameter Store names must end in valid env var keys." >&2
  echo "${invalid_parameter_names}" >&2
  exit 1
fi

jq -r '
      (.Parameters // [])
      | sort_by(.Name)
      | .[]
      | "\(.Name | split("/")[-1])=\(.Value | gsub("\r"; "") | gsub("\n"; "\\n"))"
    ' "${parameters_file}" > "${output_file}"

chmod 600 "${output_file}"
echo "Wrote runtime secrets to ${output_file}"
