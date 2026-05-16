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

require_command aws
require_command base64
require_command python3

aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-south-1}}"
instance_tag_key="${AWS_INSTANCE_TAG_KEY:-Name}"
rollback_ref="${ROLLBACK_REF:-}"
deploy_root="${AURA_DEPLOY_ROOT:-/opt/aura}"

require_env AWS_INSTANCE_TAG_VALUE
require_env AWS_PARAMETER_STORE_PATH_PREFIX

instance_id="$(
  aws ec2 describe-instances \
    --region "${aws_region}" \
    --filters "Name=tag:${instance_tag_key},Values=${AWS_INSTANCE_TAG_VALUE}" "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].InstanceId" \
    --output text \
    | awk '{print $1}'
)"

if [[ -z "${instance_id}" || "${instance_id}" == "None" ]]; then
  echo "No running EC2 instance matched ${instance_tag_key}=${AWS_INSTANCE_TAG_VALUE}." >&2
  exit 1
fi

remote_script="$(mktemp)"
cat > "${remote_script}" <<'REMOTE'
#!/usr/bin/env bash
set -euo pipefail

trim() {
  local value="${1-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

strip_inline_comment() {
  printf '%s' "${1-}" | sed -E 's/[[:space:]]+#.*$//'
}

normalize_env_value() {
  local value
  value="$(trim "$(strip_inline_comment "${1-}")")"
  if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$(trim "${value}")"
}

read_env_file_value() {
  local key="$1"
  local file="$2"
  [[ -f "${file}" ]] || return 0

  awk -v key="${key}" '
    /^[[:space:]]*#/ || index($0, "=") == 0 { next }
    {
      line = $0
      split(line, parts, "=")
      current_key = parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", current_key)
      if (current_key == key) {
        sub(/^[^=]*=/, "", line)
        print line
      }
    }
  ' "${file}" | tail -n 1
}

resolve_env_value() {
  local key="$1"
  shift

  local value=""
  local file=""
  for file in "$@"; do
    local candidate=""
    candidate="$(read_env_file_value "${key}" "${file}")"
    if [[ -n "${candidate}" ]]; then
      value="${candidate}"
    fi
  done

  normalize_env_value "${value}"
}

select_rollback_release() {
  local releases_dir="$1"
  local current_sha="$2"
  local requested_ref="$3"

  if [[ -n "${requested_ref}" ]]; then
    if [[ -d "${releases_dir}/${requested_ref}" ]]; then
      printf '%s\n' "${requested_ref}"
      return 0
    fi

    local matches=()
    mapfile -t matches < <(find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | awk -v prefix="${requested_ref}" 'index($0, prefix) == 1 { print }')
    if [[ "${#matches[@]}" -eq 1 ]]; then
      printf '%s\n' "${matches[0]}"
      return 0
    fi

    echo "No backend release directory matched ROLLBACK_REF='${requested_ref}'." >&2
    exit 1
  fi

  find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d ! -name "${current_sha}" -printf '%T@ %f\n' \
    | sort -rn \
    | awk 'NR == 1 { print $2 }'
}

deploy_root="${AURA_DEPLOY_ROOT:-/opt/aura}"
rollback_ref="${ROLLBACK_REF:-}"
releases_dir="${deploy_root}/releases"
current_dir="${deploy_root}/current"
shared_dir="${deploy_root}/shared"
base_env="${shared_dir}/base.env"
runtime_env="${shared_dir}/runtime-secrets.env"
release_env="${shared_dir}/release.env"

if [[ ! -d "${releases_dir}" ]]; then
  echo "Backend releases directory does not exist: ${releases_dir}" >&2
  exit 1
fi

current_sha="$(resolve_env_value AURA_APP_BUILD_SHA "${release_env}")"
target_sha="$(select_rollback_release "${releases_dir}" "${current_sha}" "${rollback_ref}")"
if [[ -z "${target_sha}" ]]; then
  echo "No previous backend release is available for rollback." >&2
  exit 1
fi

target_dir="${releases_dir}/${target_sha}"
test -f "${target_dir}/infra.tar.gz" || { echo "Missing ${target_dir}/infra.tar.gz" >&2; exit 1; }
test -f "${target_dir}/image.tar.gz" || { echo "Missing ${target_dir}/image.tar.gz" >&2; exit 1; }

echo "Rolling backend from ${current_sha:-unknown} to ${target_sha}."

rm -rf "${current_dir}"
mkdir -p "${current_dir}" "${shared_dir}"

tar -xzf "${target_dir}/infra.tar.gz" -C "${current_dir}"
gunzip -c "${target_dir}/image.tar.gz" | docker load

bash "${current_dir}/infra/aws/render-runtime-secrets.sh"

cat > "${release_env}" <<EOF
AURA_BACKEND_IMAGE=aura-backend:${target_sha}
AURA_APP_BUILD_SHA=${target_sha}
EOF
chmod 600 "${release_env}"

compose_file="${current_dir}/infra/aws/docker-compose.ec2.yml"
compose_profiles="$(resolve_env_value COMPOSE_PROFILES "${base_env}" "${runtime_env}" "${release_env}")"
if [[ -n "${compose_profiles}" ]]; then
  export COMPOSE_PROFILES="${compose_profiles}"
fi

health_ready_token="$(resolve_env_value HEALTH_READY_TOKEN "${base_env}" "${runtime_env}" "${release_env}")"
if [[ -z "${health_ready_token}" ]]; then
  echo "Refusing rollback: HEALTH_READY_TOKEN is required for production readiness checks." >&2
  exit 1
fi

docker compose \
  --env-file "${base_env}" \
  --env-file "${runtime_env}" \
  --env-file "${release_env}" \
  -f "${compose_file}" \
  up -d --remove-orphans

api_ready=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --header "x-health-token: ${health_ready_token}" \
    http://127.0.0.1:5000/health/ready >/dev/null; then
    api_ready=true
    break
  fi
  sleep 10
done

if [[ "${api_ready}" != "true" ]]; then
  echo "Rolled-back backend release ${target_sha} failed local readiness checks." >&2
  docker compose \
    --env-file "${base_env}" \
    --env-file "${runtime_env}" \
    --env-file "${release_env}" \
    -f "${compose_file}" \
    logs --tail 100 >&2
  exit 1
fi

backend_public_host="$(resolve_env_value AURA_BACKEND_PUBLIC_HOST "${base_env}" "${runtime_env}" "${release_env}")"
if [[ -z "${backend_public_host}" ]]; then
  echo "Rolled-back backend release ${target_sha} is missing AURA_BACKEND_PUBLIC_HOST." >&2
  exit 1
fi

edge_ready=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error \
    --connect-timeout 5 \
    --max-time 15 \
    --resolve "${backend_public_host}:443:127.0.0.1" \
    "https://${backend_public_host}/health/live" >/dev/null; then
    edge_ready=true
    break
  fi
  sleep 10
done

if [[ "${edge_ready}" != "true" ]]; then
  echo "Rolled-back backend release ${target_sha} failed TLS edge checks for ${backend_public_host}." >&2
  docker compose \
    --env-file "${base_env}" \
    --env-file "${runtime_env}" \
    --env-file "${release_env}" \
    -f "${compose_file}" \
    logs --tail 100 >&2
  exit 1
fi

echo "Backend rollback completed: ${target_sha}."
REMOTE

encoded_remote="$(base64 "${remote_script}" | tr -d '\n')"
payload_file="${RUNNER_TEMP:-/tmp}/aura-backend-rollback-ssm.json"

ENCODED_REMOTE="${encoded_remote}" \
ROLLBACK_REF_FOR_REMOTE="${rollback_ref}" \
AURA_DEPLOY_ROOT_FOR_REMOTE="${deploy_root}" \
AWS_REGION_FOR_REMOTE="${aws_region}" \
AWS_PARAMETER_STORE_PATH_PREFIX_FOR_REMOTE="${AWS_PARAMETER_STORE_PATH_PREFIX}" \
python3 <<'PY' > "${payload_file}"
import json
import os
import shlex

commands = [
    "set -euo pipefail",
    "cat > /tmp/aura-backend-rollback.b64 <<'EOF'\n" + os.environ["ENCODED_REMOTE"] + "\nEOF",
    "base64 -d /tmp/aura-backend-rollback.b64 > /tmp/aura-backend-rollback.sh",
    "chmod +x /tmp/aura-backend-rollback.sh",
    "ROLLBACK_REF={rollback_ref} AURA_DEPLOY_ROOT={deploy_root} AWS_REGION={region} AWS_PARAMETER_STORE_PATH_PREFIX={prefix} bash /tmp/aura-backend-rollback.sh".format(
        rollback_ref=shlex.quote(os.environ["ROLLBACK_REF_FOR_REMOTE"]),
        deploy_root=shlex.quote(os.environ["AURA_DEPLOY_ROOT_FOR_REMOTE"]),
        region=shlex.quote(os.environ["AWS_REGION_FOR_REMOTE"]),
        prefix=shlex.quote(os.environ["AWS_PARAMETER_STORE_PATH_PREFIX_FOR_REMOTE"]),
    ),
]

print(json.dumps({"commands": commands}))
PY

command_id="$(
  aws ssm send-command \
    --region "${aws_region}" \
    --instance-ids "${instance_id}" \
    --document-name "AWS-RunShellScript" \
    --comment "Rollback Aura backend ${rollback_ref:-previous}" \
    --parameters "file://${payload_file}" \
    --query "Command.CommandId" \
    --output text
)"

echo "Started backend rollback command ${command_id} on ${instance_id}."

for _ in $(seq 1 60); do
  status="$(
    aws ssm get-command-invocation \
      --region "${aws_region}" \
      --command-id "${command_id}" \
      --instance-id "${instance_id}" \
      --query "Status" \
      --output text
  )"

  case "${status}" in
    Success)
      echo "Backend rollback completed."
      exit 0
      ;;
    Failed|Cancelled|TimedOut|Cancelling)
      aws ssm get-command-invocation \
        --region "${aws_region}" \
        --command-id "${command_id}" \
        --instance-id "${instance_id}" \
        --query "{Status:Status,StdOut:StandardOutputContent,StdErr:StandardErrorContent}" \
        --output json
      exit 1
      ;;
  esac

  sleep 10
done

echo "Timed out waiting for backend rollback command ${command_id}." >&2
exit 1
