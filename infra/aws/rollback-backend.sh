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
require_env ROLLBACK_REF

if [[ ! "${rollback_ref}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Backend rollback requires a full known-good release SHA." >&2
  exit 1
fi

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
payload_file=""
status_error=""

cleanup_local_files() {
  rm -f "${remote_script}"
  [[ -n "${payload_file}" ]] && rm -f "${payload_file}"
  [[ -n "${status_error}" ]] && rm -f "${status_error}"
}

trap cleanup_local_files EXIT

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

to_lower() {
  printf '%s' "${1-}" | tr '[:upper:]' '[:lower:]'
}

sanitize_compose_profiles() {
  local configured_profiles="${1-}"
  local sanitized_profiles=()
  local profile=""
  local requested_profiles=()

  IFS=',' read -r -a requested_profiles <<< "${configured_profiles}"
  for profile in "${requested_profiles[@]}"; do
    profile="$(to_lower "$(normalize_env_value "${profile}")")"
    case "${profile}" in
      malware-scan)
        sanitized_profiles+=("${profile}")
        ;;
      ''|ollama)
        ;;
      *)
        echo "Refusing rollback: unsupported production Compose profile '${profile}'." >&2
        return 1
        ;;
    esac
  done

  local joined=""
  if (( ${#sanitized_profiles[@]} > 0 )); then
    joined="$(IFS=','; printf '%s' "${sanitized_profiles[*]}")"
  fi
  printf '%s' "${joined}"
}

release_lock_acquired=false
activation_started=false
activation_committed=false
activation_backup_dir=""
activation_backup_env=""
activation_backup_base_env=""
activation_backup_runtime_env=""
previous_current_present=false
previous_release_env_present=false
previous_base_env_present=false
previous_runtime_env_present=false
staged_current_dir=""
staged_release_env=""
staged_base_env=""
staged_runtime_env=""

acquire_release_lock() {
  local lock_path="$1"

  if ! command -v flock >/dev/null 2>&1; then
    echo "Refusing backend release operation: required command 'flock' was not found." >&2
    return 1
  fi

  if ! exec 9>"${lock_path}"; then
    echo "Refusing backend release operation: unable to open the release lock." >&2
    return 1
  fi

  if ! flock --exclusive --nonblock 9; then
    echo "Refusing backend release operation: another deploy or rollback is already running." >&2
    exec 9>&-
    return 1
  fi

  release_lock_acquired=true
}

release_release_lock() {
  if [[ "${release_lock_acquired}" == "true" ]]; then
    flock --unlock 9 || true
    exec 9>&-
    release_lock_acquired=false
  fi
}

restore_previous_release() {
  local restore_failed=false
  local restored_compose_file="${current_dir}/infra/aws/docker-compose.ec2.yml"
  local restored_health_token=""
  local restored_public_host=""
  local restored_api_ready=false
  local restored_edge_ready=false

  set +e
  echo "Rollback activation failed; restoring the backend state that preceded it." >&2

  if [[ -f "${current_dir}/infra/aws/docker-compose.ec2.yml" && -f "${release_env}" ]]; then
    docker compose \
      --env-file "${base_env}" \
      --env-file "${runtime_env}" \
      --env-file "${release_env}" \
      -f "${current_dir}/infra/aws/docker-compose.ec2.yml" \
      down --remove-orphans >/dev/null 2>&1 || true
  fi

  rm -rf "${current_dir}"
  rm -f "${release_env}"
  rm -f "${base_env}" "${runtime_env}"

  if [[ "${previous_current_present}" == "true" && -d "${activation_backup_dir}" ]]; then
    mv "${activation_backup_dir}" "${current_dir}" || restore_failed=true
  fi
  if [[ "${previous_release_env_present}" == "true" && -f "${activation_backup_env}" ]]; then
    mv "${activation_backup_env}" "${release_env}" || restore_failed=true
  fi
  if [[ "${previous_base_env_present}" == "true" && -f "${activation_backup_base_env}" ]]; then
    mv "${activation_backup_base_env}" "${base_env}" || restore_failed=true
  fi
  if [[ "${previous_runtime_env_present}" == "true" && -f "${activation_backup_runtime_env}" ]]; then
    mv "${activation_backup_runtime_env}" "${runtime_env}" || restore_failed=true
  fi

  if [[ "${previous_current_present}" != "true" || \
    "${previous_release_env_present}" != "true" || \
    "${previous_base_env_present}" != "true" || \
    "${previous_runtime_env_present}" != "true" ]]; then
    echo "No complete pre-rollback backend state was available to restart." >&2
    restore_failed=true
  elif [[ ! -f "${restored_compose_file}" || \
    ! -f "${release_env}" || \
    ! -f "${base_env}" || \
    ! -f "${runtime_env}" ]]; then
    echo "Pre-rollback backend state could not be reconstructed from the activation backup." >&2
    restore_failed=true
  else
    (upsert_env_value "${base_env}" "COMPOSE_PROFILES" "${compose_profiles}") || restore_failed=true
    (upsert_env_value "${base_env}" "AI_MODEL_PROVIDER" "disabled") || restore_failed=true
    (upsert_env_value "${base_env}" "AI_MODEL_PROVIDER_FALLBACKS" "") || restore_failed=true
    (upsert_env_value "${base_env}" "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA" "false") || restore_failed=true
    (upsert_env_value "${base_env}" "ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED" "false") || restore_failed=true
    (upsert_env_value "${release_env}" "COMPOSE_PROFILES" "${compose_profiles}") || restore_failed=true
    (upsert_env_value "${release_env}" "AI_MODEL_PROVIDER" "disabled") || restore_failed=true
    (upsert_env_value "${release_env}" "AI_MODEL_PROVIDER_FALLBACKS" "") || restore_failed=true
    (upsert_env_value "${release_env}" "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA" "false") || restore_failed=true
    (upsert_env_value "${release_env}" "ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED" "false") || restore_failed=true

    export COMPOSE_PROFILES="${compose_profiles}"
    export AI_MODEL_PROVIDER="disabled"
    export AI_MODEL_PROVIDER_FALLBACKS=""
    export ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA="false"
    export ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED="false"

    if ! assert_no_model_compose_contract "${restored_compose_file}" \
      "${base_env}" \
      "${runtime_env}" \
      "${release_env}"; then
      restore_failed=true
    else
      docker compose \
        --env-file "${base_env}" \
        --env-file "${runtime_env}" \
        --env-file "${release_env}" \
        -f "${restored_compose_file}" \
        --profile ollama \
        rm --stop --force ollama >/dev/null 2>&1 || true

      if ! docker compose \
        --env-file "${base_env}" \
        --env-file "${runtime_env}" \
        --env-file "${release_env}" \
        -f "${restored_compose_file}" \
        up -d --remove-orphans --force-recreate; then
        restore_failed=true
      fi
    fi

    restored_health_token="$(resolve_env_value HEALTH_READY_TOKEN "${base_env}" "${runtime_env}" "${release_env}")"
    if [[ -z "${restored_health_token}" ]]; then
      restore_failed=true
    else
      for _ in $(seq 1 12); do
        if curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
          --header "x-health-token: ${restored_health_token}" \
          http://127.0.0.1:5000/health/ready >/dev/null; then
          restored_api_ready=true
          break
        fi
        sleep 5
      done
      [[ "${restored_api_ready}" == "true" ]] || restore_failed=true
    fi

    restored_public_host="$(resolve_env_value AURA_BACKEND_PUBLIC_HOST "${base_env}" "${runtime_env}" "${release_env}")"
    if [[ -z "${restored_public_host}" ]]; then
      restore_failed=true
    else
      for _ in $(seq 1 12); do
        if curl --fail --silent --show-error \
          --connect-timeout 5 \
          --max-time 15 \
          --resolve "${restored_public_host}:443:127.0.0.1" \
          "https://${restored_public_host}/health/live" >/dev/null; then
          restored_edge_ready=true
          break
        fi
        sleep 5
      done
      [[ "${restored_edge_ready}" == "true" ]] || restore_failed=true
    fi
  fi

  if [[ "${restore_failed}" == "true" ]]; then
    echo "CRITICAL: automatic restoration of the pre-rollback backend state failed." >&2
  else
    echo "Pre-rollback backend state restored and verified after failed rollback activation." >&2
  fi
  set -e
}

release_exit_handler() {
  local status="$?"
  trap - EXIT

  if [[ "${status}" -ne 0 && "${activation_started}" == "true" && "${activation_committed}" != "true" ]]; then
    restore_previous_release || true
  fi

  [[ -n "${staged_current_dir}" ]] && rm -rf "${staged_current_dir}" || true
  [[ -n "${staged_release_env}" ]] && rm -f "${staged_release_env}" || true
  [[ -n "${staged_base_env}" ]] && rm -f "${staged_base_env}" || true
  [[ -n "${staged_runtime_env}" ]] && rm -f "${staged_runtime_env}" || true

  release_release_lock
  exit "${status}"
}

upsert_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temp_file=""

  if [[ ! -f "${file}" ]]; then
    echo "Refusing rollback: required environment file is missing: ${file}" >&2
    exit 1
  fi

  if ! [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || [[ "${value}" == *$'\n'* || "${value}" == *$'\r'* ]]; then
    echo "Refusing rollback: invalid non-secret environment contract entry." >&2
    exit 1
  fi

  temp_file="$(mktemp "${file}.XXXXXX")"
  awk -v key="${key}" -v replacement="${key}=${value}" '
    BEGIN { written = 0 }
    {
      current_key = $0
      sub(/=.*/, "", current_key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", current_key)
      if (current_key == key) {
        if (!written) {
          print replacement
          written = 1
        }
        next
      }
      print
    }
    END {
      if (!written) {
        print replacement
      }
    }
  ' "${file}" > "${temp_file}"
  chmod 600 "${temp_file}"
  mv "${temp_file}" "${file}"
}

assert_no_model_compose_contract() {
  local compose_file="$1"
  local base_env="$2"
  local runtime_env="$3"
  local release_env="$4"

  if ! docker compose \
    --env-file "${base_env}" \
    --env-file "${runtime_env}" \
    --env-file "${release_env}" \
    -f "${compose_file}" \
    config --format json \
    | jq -e '
        (.services | has("ollama") | not)
        and
        ([.services.api.environment, .services.worker.environment] | all(
          (.AI_MODEL_PROVIDER == "disabled")
          and (.AI_MODEL_PROVIDER_FALLBACKS == "")
          and (.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA == "false")
          and (.ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED == "false")
        ))
      ' >/dev/null; then
    echo "Refusing rollback: rendered Compose contract does not enforce deterministic no-model mode." >&2
    return 1
  fi
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

  if [[ ! "${requested_ref}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Refusing rollback: ROLLBACK_REF must be a full lowercase commit SHA." >&2
    exit 1
  fi

  if [[ -z "${requested_ref}" ]]; then
    echo "Refusing rollback: an explicit known-good ROLLBACK_REF is required." >&2
    exit 1
  fi

  if [[ -d "${releases_dir}/${requested_ref}" ]]; then
    printf '%s\n' "${requested_ref}"
    return 0
  fi

  echo "No backend release directory matched ROLLBACK_REF='${requested_ref}'." >&2
  exit 1
}

deploy_root="${AURA_DEPLOY_ROOT:-/opt/aura}"
rollback_ref="${ROLLBACK_REF:-}"
releases_dir="${deploy_root}/releases"
current_dir="${deploy_root}/current"
shared_dir="${deploy_root}/shared"
base_env="${shared_dir}/base.env"
runtime_env="${shared_dir}/runtime-secrets.env"
release_env="${shared_dir}/release.env"
release_lock_path="${deploy_root}/.backend-release.lock"

if [[ ! -d "${releases_dir}" ]]; then
  echo "Backend releases directory does not exist: ${releases_dir}" >&2
  exit 1
fi

trap release_exit_handler EXIT
acquire_release_lock "${release_lock_path}"

preserved_recovery_state="$(
  find "${releases_dir}" -mindepth 2 -maxdepth 2 \
    \( -name current.previous -o -name release.env.previous -o -name base.env.previous -o -name runtime-secrets.env.previous \) \
    -print -quit 2>/dev/null || true
)"
if [[ -n "${preserved_recovery_state}" ]]; then
  echo "Refusing rollback: preserved activation recovery state requires operator recovery at ${preserved_recovery_state}." >&2
  exit 1
fi

current_sha="$(resolve_env_value AURA_APP_BUILD_SHA "${release_env}")"
if [[ ! "${current_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Refusing rollback: current backend release SHA is missing or malformed." >&2
  exit 1
fi
target_sha="$(select_rollback_release "${releases_dir}" "${current_sha}" "${rollback_ref}")"
if [[ -z "${target_sha}" ]]; then
  echo "No previous backend release is available for rollback." >&2
  exit 1
fi

target_dir="${releases_dir}/${target_sha}"
test -f "${target_dir}/infra.tar.gz" || { echo "Missing ${target_dir}/infra.tar.gz" >&2; exit 1; }
test -f "${target_dir}/image.tar.gz" || { echo "Missing ${target_dir}/image.tar.gz" >&2; exit 1; }
staged_current_dir="${target_dir}/current.staged"
staged_release_env="${target_dir}/release.env.staged"
staged_base_env="${target_dir}/base.env.staged"
staged_runtime_env="${target_dir}/runtime-secrets.env.staged"
staged_compose_file="${staged_current_dir}/infra/aws/docker-compose.ec2.yml"
activation_backup_dir="${target_dir}/current.previous"
activation_backup_env="${target_dir}/release.env.previous"
activation_backup_base_env="${target_dir}/base.env.previous"
activation_backup_runtime_env="${target_dir}/runtime-secrets.env.previous"

echo "Rolling backend from ${current_sha:-unknown} to ${target_sha}."

mkdir -p "${shared_dir}"
test -f "${base_env}" || { echo "Refusing rollback: ${base_env} is missing." >&2; exit 1; }
test -f "${runtime_env}" || { echo "Refusing rollback: ${runtime_env} is missing." >&2; exit 1; }

rm -rf "${staged_current_dir}" "${staged_release_env}" "${staged_base_env}" "${staged_runtime_env}"
mkdir -p "${staged_current_dir}"

tar -xzf "${target_dir}/infra.tar.gz" -C "${staged_current_dir}"

cp -p "${base_env}" "${staged_base_env}"
AURA_RUNTIME_SECRETS_FILE="${staged_runtime_env}" \
  bash "${staged_current_dir}/infra/aws/render-runtime-secrets.sh"

configured_compose_profiles="$(resolve_env_value COMPOSE_PROFILES "${staged_base_env}" "${staged_runtime_env}" "${release_env}")"
compose_profiles="$(sanitize_compose_profiles "${configured_compose_profiles}")"

upsert_env_value "${staged_base_env}" "COMPOSE_PROFILES" "${compose_profiles}"
upsert_env_value "${staged_base_env}" "AI_MODEL_PROVIDER" "disabled"
upsert_env_value "${staged_base_env}" "AI_MODEL_PROVIDER_FALLBACKS" ""
upsert_env_value "${staged_base_env}" "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA" "false"
upsert_env_value "${staged_base_env}" "ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED" "false"

cat > "${staged_release_env}" <<EOF
AURA_BACKEND_IMAGE=aura-backend:${target_sha}
AURA_APP_BUILD_SHA=${target_sha}
AURA_PREVIOUS_SUCCESSFUL_SHA=${current_sha}
COMPOSE_PROFILES=${compose_profiles}
AI_MODEL_PROVIDER=disabled
AI_MODEL_PROVIDER_FALLBACKS=
ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA=false
ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED=false
EOF
chmod 600 "${staged_release_env}"

export COMPOSE_PROFILES="${compose_profiles}"
export AI_MODEL_PROVIDER="disabled"
export AI_MODEL_PROVIDER_FALLBACKS=""
export ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA="false"
export ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED="false"

health_ready_token="$(resolve_env_value HEALTH_READY_TOKEN "${staged_base_env}" "${staged_runtime_env}" "${staged_release_env}")"
if [[ -z "${health_ready_token}" ]]; then
  echo "Refusing rollback: HEALTH_READY_TOKEN is required for production readiness checks." >&2
  exit 1
fi

assert_no_model_compose_contract "${staged_compose_file}" \
  "${staged_base_env}" \
  "${staged_runtime_env}" \
  "${staged_release_env}"

gunzip -c "${target_dir}/image.tar.gz" | docker load

for recovery_path in \
  "${activation_backup_dir}" \
  "${activation_backup_env}" \
  "${activation_backup_base_env}" \
  "${activation_backup_runtime_env}"; do
  if [[ -e "${recovery_path}" ]]; then
    echo "Refusing rollback: preserved activation recovery state exists at ${recovery_path}." >&2
    exit 1
  fi
done
if [[ -e "${current_dir}" && ! -e "${release_env}" ]] || \
  [[ ! -e "${current_dir}" && -e "${release_env}" ]]; then
  echo "Refusing rollback: existing backend current/release state is incomplete." >&2
  exit 1
fi
if [[ -e "${current_dir}" ]]; then
  cp -a "${current_dir}" "${activation_backup_dir}"
  previous_current_present=true
  cp -p "${release_env}" "${activation_backup_env}"
  previous_release_env_present=true
fi
cp -p "${base_env}" "${activation_backup_base_env}"
previous_base_env_present=true
cp -p "${runtime_env}" "${activation_backup_runtime_env}"
previous_runtime_env_present=true
activation_started=true
rm -rf "${current_dir}"
rm -f "${release_env}" "${base_env}" "${runtime_env}"
mv "${staged_current_dir}" "${current_dir}"
mv "${staged_release_env}" "${release_env}"
mv "${staged_base_env}" "${base_env}"
mv "${staged_runtime_env}" "${runtime_env}"
compose_file="${current_dir}/infra/aws/docker-compose.ec2.yml"

docker compose \
  --env-file "${base_env}" \
  --env-file "${runtime_env}" \
  --env-file "${release_env}" \
  -f "${compose_file}" \
  --profile ollama \
  rm --stop --force ollama

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

activation_committed=true
rm -rf "${activation_backup_dir}" "${activation_backup_env}" \
  "${activation_backup_base_env}" "${activation_backup_runtime_env}"
echo "Backend rollback completed: ${target_sha}."
REMOTE

encoded_remote="$(base64 "${remote_script}" | tr -d '\n')"
payload_file="${RUNNER_TEMP:-/tmp}/aura-backend-rollback-ssm.json"
status_error="${RUNNER_TEMP:-/tmp}/aura-backend-rollback-ssm.err"

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

for _ in $(seq 1 240); do
  if ! status="$(
    aws ssm get-command-invocation \
      --region "${aws_region}" \
      --command-id "${command_id}" \
      --instance-id "${instance_id}" \
      --query "Status" \
      --output text 2>"${status_error}"
  )"; then
    if grep -q 'InvocationDoesNotExist' "${status_error}"; then
      sleep 10
      continue
    fi
    cat "${status_error}" >&2
    exit 1
  fi

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
