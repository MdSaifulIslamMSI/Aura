#!/usr/bin/env bash
set -euo pipefail

trim() {
  local value="${1-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

strip_inline_comment() {
  local value="${1-}"
  printf '%s' "${value}" | sed -E 's/[[:space:]]+#.*$//'
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

is_truthy() {
  case "$(to_lower "$(normalize_env_value "${1-}")")" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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

  printf '%s' "$(normalize_env_value "${value}")"
}

upsert_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temp_file=""

  if [[ ! -f "${file}" ]]; then
    echo "Refusing deploy: required environment file is missing: ${file}" >&2
    exit 1
  fi

  if ! [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || [[ "${value}" == *$'\n'* || "${value}" == *$'\r'* ]]; then
    echo "Refusing deploy: invalid non-secret environment contract entry." >&2
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
        echo "Refusing deploy: unsupported production Compose profile '${profile}'." >&2
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
  echo "Release activation failed; restoring the previous backend state." >&2

  if [[ -f "${current_dir}/infra/aws/docker-compose.ec2.yml" && -f "${shared_dir}/release.env" ]]; then
    docker compose \
      --env-file "${shared_dir}/base.env" \
      --env-file "${shared_dir}/runtime-secrets.env" \
      --env-file "${shared_dir}/release.env" \
      -f "${current_dir}/infra/aws/docker-compose.ec2.yml" \
      down --remove-orphans >/dev/null 2>&1 || true
  fi

  rm -rf "${current_dir}"
  rm -f "${shared_dir}/release.env"
  rm -f "${shared_dir}/base.env" "${shared_dir}/runtime-secrets.env"

  if [[ "${previous_current_present}" == "true" && -d "${activation_backup_dir}" ]]; then
    mv "${activation_backup_dir}" "${current_dir}" || restore_failed=true
  fi
  if [[ "${previous_release_env_present}" == "true" && -f "${activation_backup_env}" ]]; then
    mv "${activation_backup_env}" "${shared_dir}/release.env" || restore_failed=true
  fi
  if [[ "${previous_base_env_present}" == "true" && -f "${activation_backup_base_env}" ]]; then
    mv "${activation_backup_base_env}" "${shared_dir}/base.env" || restore_failed=true
  fi
  if [[ "${previous_runtime_env_present}" == "true" && -f "${activation_backup_runtime_env}" ]]; then
    mv "${activation_backup_runtime_env}" "${shared_dir}/runtime-secrets.env" || restore_failed=true
  fi

  if [[ "${previous_current_present}" != "true" || \
    "${previous_release_env_present}" != "true" || \
    "${previous_base_env_present}" != "true" || \
    "${previous_runtime_env_present}" != "true" ]]; then
    echo "No complete previous backend state was available to restart." >&2
    restore_failed=true
  elif [[ ! -f "${restored_compose_file}" || \
    ! -f "${shared_dir}/release.env" || \
    ! -f "${shared_dir}/base.env" || \
    ! -f "${shared_dir}/runtime-secrets.env" ]]; then
    echo "Previous backend state could not be reconstructed from the activation backup." >&2
    restore_failed=true
  else
    (upsert_env_value "${shared_dir}/base.env" "COMPOSE_PROFILES" "${compose_profiles}") || restore_failed=true
    (upsert_env_value "${shared_dir}/base.env" "AI_MODEL_PROVIDER" "disabled") || restore_failed=true
    (upsert_env_value "${shared_dir}/base.env" "AI_MODEL_PROVIDER_FALLBACKS" "") || restore_failed=true
    (upsert_env_value "${shared_dir}/base.env" "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA" "false") || restore_failed=true
    (upsert_env_value "${shared_dir}/base.env" "ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED" "false") || restore_failed=true
    (upsert_env_value "${shared_dir}/release.env" "COMPOSE_PROFILES" "${compose_profiles}") || restore_failed=true
    (upsert_env_value "${shared_dir}/release.env" "AI_MODEL_PROVIDER" "disabled") || restore_failed=true
    (upsert_env_value "${shared_dir}/release.env" "AI_MODEL_PROVIDER_FALLBACKS" "") || restore_failed=true
    (upsert_env_value "${shared_dir}/release.env" "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA" "false") || restore_failed=true
    (upsert_env_value "${shared_dir}/release.env" "ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED" "false") || restore_failed=true

    export COMPOSE_PROFILES="${compose_profiles}"
    export AI_MODEL_PROVIDER="disabled"
    export AI_MODEL_PROVIDER_FALLBACKS=""
    export ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA="false"
    export ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED="false"

    if ! assert_no_model_compose_contract "${restored_compose_file}" \
      "${shared_dir}/base.env" \
      "${shared_dir}/runtime-secrets.env" \
      "${shared_dir}/release.env"; then
      restore_failed=true
    else
      docker compose \
        --env-file "${shared_dir}/base.env" \
        --env-file "${shared_dir}/runtime-secrets.env" \
        --env-file "${shared_dir}/release.env" \
        -f "${restored_compose_file}" \
        --profile ollama \
        rm --stop --force ollama >/dev/null 2>&1 || true

      if ! docker compose \
        --env-file "${shared_dir}/base.env" \
        --env-file "${shared_dir}/runtime-secrets.env" \
        --env-file "${shared_dir}/release.env" \
        -f "${restored_compose_file}" \
        up -d --remove-orphans --force-recreate; then
        restore_failed=true
      fi
    fi

    restored_health_token="$(resolve_runtime_contract_value "HEALTH_READY_TOKEN" "${restored_compose_file}" \
      "${shared_dir}/base.env" \
      "${shared_dir}/runtime-secrets.env" \
      "${shared_dir}/release.env")"
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

    restored_public_host="$(resolve_env_value "AURA_BACKEND_PUBLIC_HOST" \
      "${shared_dir}/base.env" \
      "${shared_dir}/runtime-secrets.env" \
      "${shared_dir}/release.env")"
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
    echo "CRITICAL: automatic restoration of the previous backend state failed." >&2
  else
    echo "Previous backend state restored and verified after failed activation." >&2
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
    echo "Refusing deploy: rendered Compose contract does not enforce deterministic no-model mode." >&2
    return 1
  fi
}

read_compose_environment_value() {
  local key="$1"
  local file="$2"
  [[ -f "${file}" ]] || return 0

  awk -v key="${key}" '
    {
      pattern = "^[[:space:]]*" key ":[[:space:]]*(.+)$"
      if (match($0, pattern)) {
        line = $0
        sub("^[[:space:]]*" key ":[[:space:]]*", "", line)
        value = line
      }
    }
    END {
      if (value != "") {
        print value
      }
    }
  ' "${file}" | tail -n 1
}

resolve_runtime_contract_value() {
  local key="$1"
  local compose_file="$2"
  shift 2

  local compose_value=""
  compose_value="$(read_compose_environment_value "${key}" "${compose_file}")"
  if [[ -n "${compose_value}" ]]; then
    printf '%s' "$(normalize_env_value "${compose_value}")"
    return 0
  fi

  resolve_env_value "${key}" "$@"
}

assert_trusted_device_runtime_contract() {
  local compose_file="$1"
  shift
  local env_files=("$@")

  local mode=""
  local allow_vault_fallback=""
  local device_secret=""
  local auth_vault_secret=""

  mode="$(to_lower "$(resolve_runtime_contract_value "AUTH_DEVICE_CHALLENGE_MODE" "${compose_file}" "${env_files[@]}")")"
  allow_vault_fallback="$(resolve_runtime_contract_value "AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK" "${compose_file}" "${env_files[@]}")"
  device_secret="$(resolve_runtime_contract_value "AUTH_DEVICE_CHALLENGE_SECRET" "${compose_file}" "${env_files[@]}")"
  auth_vault_secret="$(resolve_runtime_contract_value "AUTH_VAULT_SECRET" "${compose_file}" "${env_files[@]}")"

  case "${mode}" in
    always|admin|seller|privileged)
      ;;
    off|'')
      echo "Refusing deploy: trusted-device challenge mode resolved to '${mode:-missing}' for the AWS runtime." >&2
      echo "Set AUTH_DEVICE_CHALLENGE_MODE to admin, seller, privileged, or always before deploying." >&2
      exit 1
      ;;
    *)
      echo "Refusing deploy: trusted-device challenge mode '${mode}' is invalid for the AWS runtime." >&2
      exit 1
      ;;
  esac

  if [[ -n "${device_secret}" ]]; then
    echo "Trusted-device contract OK: mode=${mode} using AUTH_DEVICE_CHALLENGE_SECRET."
    return 0
  fi

  if is_truthy "${allow_vault_fallback}" && [[ -n "${auth_vault_secret}" ]]; then
    echo "Trusted-device contract OK: mode=${mode} using AUTH_VAULT_SECRET fallback."
    return 0
  fi

  echo "Refusing deploy: trusted-device challenge is enabled for mode=${mode}, but no usable device secret was resolved." >&2
  echo "Provide AUTH_DEVICE_CHALLENGE_SECRET or keep AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK=true with AUTH_VAULT_SECRET present." >&2
  exit 1
}

cleanup_old_release_dirs() {
  local releases_dir="$1"
  local keep_count="${2:-3}"
  shift 2
  local protected_shas=("$@")
  local retained=0
  local old_release_dir=""
  local old_release_sha=""
  local protected_sha=""
  local is_protected=false

  [[ -d "${releases_dir}" ]] || return 0

  while IFS= read -r old_release_dir; do
    [[ -n "${old_release_dir}" ]] || continue
    old_release_sha="$(basename "${old_release_dir}")"
    is_protected=false
    for protected_sha in "${protected_shas[@]}"; do
      if [[ -n "${protected_sha}" && "${old_release_sha}" == "${protected_sha}" ]]; then
        is_protected=true
        break
      fi
    done
    if [[ "${is_protected}" == "true" ]]; then
      continue
    fi
    if (( retained < keep_count )); then
      retained=$((retained + 1))
      continue
    fi
    echo "Removing old release directory ${old_release_dir}"
    rm -rf "${old_release_dir}"
  done < <(
    find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
      | sort -rn \
      | sed -E 's/^[^ ]+ //'
  )
}

prepare_docker_disk_space() {
  echo "Docker disk usage before cleanup:"
  docker system df || true

  docker container prune --force || true
  docker image prune --all --force || true
  docker builder prune --all --force || true

  echo "Docker disk usage after cleanup:"
  docker system df || true
  df -h "${deploy_root}" / || true
}

verify_sha256() {
  local file="$1"
  local expected="$2"
  local label="$3"
  local actual=""

  if [[ -z "${expected}" ]]; then
    echo "Refusing deploy: expected SHA-256 for ${label} is required." >&2
    exit 1
  fi

  if ! [[ "${expected}" =~ ^[A-Fa-f0-9]{64}$ ]]; then
    echo "Refusing deploy: expected SHA-256 for ${label} is malformed." >&2
    exit 1
  fi

  actual="$(sha256sum "${file}" | awk '{print $1}')"
  if [[ "${actual,,}" != "${expected,,}" ]]; then
    echo "Refusing deploy: ${label} SHA-256 mismatch." >&2
    echo "Expected: ${expected}" >&2
    echo "Actual:   ${actual}" >&2
    exit 1
  fi

  echo "Verified ${label} SHA-256."
}

deploy_root="${AURA_DEPLOY_ROOT:-/opt/aura}"
release_sha="${AURA_RELEASE_SHA:?AURA_RELEASE_SHA is required}"
deploy_bucket="${AURA_DEPLOY_BUCKET:?AURA_DEPLOY_BUCKET is required}"
infra_bundle_key="${AURA_INFRA_BUNDLE_KEY:?AURA_INFRA_BUNDLE_KEY is required}"
image_bundle_key="${AURA_IMAGE_BUNDLE_KEY:?AURA_IMAGE_BUNDLE_KEY is required}"
infra_bundle_sha256="${AURA_INFRA_BUNDLE_SHA256:?AURA_INFRA_BUNDLE_SHA256 is required}"
image_bundle_sha256="${AURA_IMAGE_BUNDLE_SHA256:?AURA_IMAGE_BUNDLE_SHA256 is required}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

if [[ ! "${release_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Refusing deploy: AURA_RELEASE_SHA must be a full lowercase commit SHA." >&2
  exit 1
fi

if [[ -z "${aws_region}" ]]; then
  echo "AWS_REGION or AWS_DEFAULT_REGION is required" >&2
  exit 1
fi

release_dir="${deploy_root}/releases/${release_sha}"
current_dir="${deploy_root}/current"
shared_dir="${deploy_root}/shared"
staged_current_dir="${release_dir}/current.staged"
staged_release_env="${release_dir}/release.env.staged"
staged_base_env="${release_dir}/base.env.staged"
staged_runtime_env="${release_dir}/runtime-secrets.env.staged"
staged_compose_file="${staged_current_dir}/infra/aws/docker-compose.ec2.yml"
release_lock_path="${deploy_root}/.backend-release.lock"
activation_backup_dir="${release_dir}/current.previous"
activation_backup_env="${release_dir}/release.env.previous"
activation_backup_base_env="${release_dir}/base.env.previous"
activation_backup_runtime_env="${release_dir}/runtime-secrets.env.previous"

trap release_exit_handler EXIT
acquire_release_lock "${release_lock_path}"

mkdir -p "${release_dir}" "${shared_dir}"
preserved_recovery_state="$(
  find "${deploy_root}/releases" -mindepth 2 -maxdepth 2 \
    \( -name current.previous -o -name release.env.previous -o -name base.env.previous -o -name runtime-secrets.env.previous \) \
    -print -quit 2>/dev/null || true
)"
if [[ -n "${preserved_recovery_state}" ]]; then
  echo "Refusing deploy: preserved activation recovery state requires operator recovery at ${preserved_recovery_state}." >&2
  exit 1
fi

test -f "${shared_dir}/base.env" || { echo "Refusing deploy: ${shared_dir}/base.env is missing." >&2; exit 1; }
test -f "${shared_dir}/runtime-secrets.env" || { echo "Refusing deploy: ${shared_dir}/runtime-secrets.env is missing." >&2; exit 1; }
previous_active_sha="$(resolve_env_value "AURA_APP_BUILD_SHA" "${shared_dir}/release.env")"
if [[ -n "${previous_active_sha}" && ! "${previous_active_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Refusing deploy: current backend release SHA is missing or malformed." >&2
  exit 1
fi
if [[ "${previous_active_sha}" == "${release_sha}" ]]; then
  echo "Refusing deploy: release ${release_sha} is already active; same-SHA redeploys cannot preserve an immutable rollback target." >&2
  exit 1
fi
if [[ -n "${previous_active_sha}" && ! -f "${current_dir}/infra/aws/docker-compose.ec2.yml" ]]; then
  echo "Refusing deploy: current backend release metadata exists without its Compose configuration." >&2
  exit 1
fi
if [[ -z "${previous_active_sha}" && -f "${current_dir}/infra/aws/docker-compose.ec2.yml" ]]; then
  echo "Refusing deploy: current backend Compose configuration exists without release metadata." >&2
  exit 1
fi
if [[ -n "${previous_active_sha}" ]]; then
  test -f "${deploy_root}/releases/${previous_active_sha}/infra.tar.gz" || {
    echo "Refusing deploy: active backend release is missing its rollback infra artifact." >&2
    exit 1
  }
  test -f "${deploy_root}/releases/${previous_active_sha}/image.tar.gz" || {
    echo "Refusing deploy: active backend release is missing its rollback image artifact." >&2
    exit 1
  }
fi

prepare_docker_disk_space

aws s3 cp --region "${aws_region}" "s3://${deploy_bucket}/${infra_bundle_key}" "${release_dir}/infra.tar.gz"
aws s3 cp --region "${aws_region}" "s3://${deploy_bucket}/${image_bundle_key}" "${release_dir}/image.tar.gz"
verify_sha256 "${release_dir}/infra.tar.gz" "${infra_bundle_sha256}" "infra bundle"
verify_sha256 "${release_dir}/image.tar.gz" "${image_bundle_sha256}" "image bundle"

rm -rf "${staged_current_dir}" "${staged_release_env}" "${staged_base_env}" "${staged_runtime_env}"
mkdir -p "${staged_current_dir}"

tar -xzf "${release_dir}/infra.tar.gz" -C "${staged_current_dir}"

cp -p "${shared_dir}/base.env" "${staged_base_env}"
AURA_RUNTIME_SECRETS_FILE="${staged_runtime_env}" \
  bash "${staged_current_dir}/infra/aws/render-runtime-secrets.sh"

configured_compose_profiles="$(resolve_env_value "COMPOSE_PROFILES" "${staged_base_env}" "${staged_runtime_env}" "${shared_dir}/release.env")"
compose_profiles="$(sanitize_compose_profiles "${configured_compose_profiles}")"

upsert_env_value "${staged_base_env}" "AUTH_SESSION_ALLOW_MEMORY_FALLBACK" "false"
upsert_env_value "${staged_base_env}" "AUTH_WEBAUTHN_RP_ID" "aurapilot.vercel.app"
upsert_env_value "${staged_base_env}" "AUTH_WEBAUTHN_ORIGIN" "https://aurapilot.vercel.app"
upsert_env_value "${staged_base_env}" "AUTH_WEBAUTHN_USER_VERIFICATION" "required"
upsert_env_value "${staged_base_env}" "MFA_ENABLED" "true"
upsert_env_value "${staged_base_env}" "MFA_PASSKEY_ENABLED" "true"
upsert_env_value "${staged_base_env}" "AURA_DESKTOP_OWNER_ACCESS_ENABLED" "false"
upsert_env_value "${staged_base_env}" "COMPOSE_PROFILES" "${compose_profiles}"
upsert_env_value "${staged_base_env}" "AI_MODEL_PROVIDER" "disabled"
upsert_env_value "${staged_base_env}" "AI_MODEL_PROVIDER_FALLBACKS" ""
upsert_env_value "${staged_base_env}" "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA" "false"
upsert_env_value "${staged_base_env}" "ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED" "false"

cat > "${staged_release_env}" <<EOF
AURA_BACKEND_IMAGE=aura-backend:${release_sha}
AURA_APP_BUILD_SHA=${release_sha}
AURA_PREVIOUS_SUCCESSFUL_SHA=${previous_active_sha}
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

assert_trusted_device_runtime_contract "${staged_compose_file}" \
  "${staged_base_env}" \
  "${staged_runtime_env}" \
  "${staged_release_env}"

if [[ -n "${compose_profiles}" ]]; then
  echo "Docker Compose profiles enabled: ${COMPOSE_PROFILES}"
fi

health_ready_token="$(resolve_runtime_contract_value "HEALTH_READY_TOKEN" "${staged_compose_file}" \
  "${staged_base_env}" \
  "${staged_runtime_env}" \
  "${staged_release_env}")"
if [[ -z "${health_ready_token}" ]]; then
  echo "Refusing deploy: HEALTH_READY_TOKEN is required for production readiness checks." >&2
  exit 1
fi

assert_no_model_compose_contract "${staged_compose_file}" \
  "${staged_base_env}" \
  "${staged_runtime_env}" \
  "${staged_release_env}"

gunzip -c "${release_dir}/image.tar.gz" | docker load

for recovery_path in \
  "${activation_backup_dir}" \
  "${activation_backup_env}" \
  "${activation_backup_base_env}" \
  "${activation_backup_runtime_env}"; do
  if [[ -e "${recovery_path}" ]]; then
    echo "Refusing deploy: preserved activation recovery state exists at ${recovery_path}." >&2
    exit 1
  fi
done
if [[ -n "${previous_active_sha}" ]]; then
  cp -a "${current_dir}" "${activation_backup_dir}"
  previous_current_present=true
  cp -p "${shared_dir}/release.env" "${activation_backup_env}"
  previous_release_env_present=true
fi
cp -p "${shared_dir}/base.env" "${activation_backup_base_env}"
previous_base_env_present=true
cp -p "${shared_dir}/runtime-secrets.env" "${activation_backup_runtime_env}"
previous_runtime_env_present=true
activation_started=true
rm -rf "${current_dir}"
rm -f "${shared_dir}/release.env" "${shared_dir}/base.env" "${shared_dir}/runtime-secrets.env"
mv "${staged_current_dir}" "${current_dir}"
mv "${staged_release_env}" "${shared_dir}/release.env"
mv "${staged_base_env}" "${shared_dir}/base.env"
mv "${staged_runtime_env}" "${shared_dir}/runtime-secrets.env"
compose_file="${current_dir}/infra/aws/docker-compose.ec2.yml"

# A previous release may have left the optional Ollama profile running. Remove
# only that container; its named model volume remains available for rollback.
docker compose \
  --env-file "${shared_dir}/base.env" \
  --env-file "${shared_dir}/runtime-secrets.env" \
  --env-file "${shared_dir}/release.env" \
  -f "${compose_file}" \
  --profile ollama \
  rm --stop --force ollama

docker compose \
  --env-file "${shared_dir}/base.env" \
  --env-file "${shared_dir}/runtime-secrets.env" \
  --env-file "${shared_dir}/release.env" \
  -f "${compose_file}" \
  up -d --remove-orphans

api_ready=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --header "x-health-token: ${health_ready_token}" \
    http://127.0.0.1:5000/health/ready > /dev/null; then
    api_ready=true
    break
  fi
  sleep 10
done

if [[ "${api_ready}" != "true" ]]; then
  echo "Aura backend release ${release_sha} failed local API readiness checks." >&2
  docker compose \
    --env-file "${shared_dir}/base.env" \
    --env-file "${shared_dir}/runtime-secrets.env" \
    --env-file "${shared_dir}/release.env" \
    -f "${compose_file}" \
    logs --tail 100 >&2
  exit 1
fi

backend_public_host="$(resolve_env_value "AURA_BACKEND_PUBLIC_HOST" "${shared_dir}/base.env" "${shared_dir}/runtime-secrets.env" "${shared_dir}/release.env")"
if [[ -z "${backend_public_host}" ]]; then
  echo "Aura backend release ${release_sha} is missing AURA_BACKEND_PUBLIC_HOST for TLS edge validation." >&2
  exit 1
fi

edge_ready=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error \
    --connect-timeout 5 \
    --max-time 15 \
    --resolve "${backend_public_host}:443:127.0.0.1" \
    "https://${backend_public_host}/health/live" > /dev/null; then
    edge_ready=true
    break
  fi
  sleep 10
done

if [[ "${edge_ready}" == "true" ]]; then
  echo "Aura backend release ${release_sha} is healthy behind TLS edge ${backend_public_host}."
  activation_committed=true
  rm -rf "${activation_backup_dir}" "${activation_backup_env}" \
    "${activation_backup_base_env}" "${activation_backup_runtime_env}"
  cleanup_old_release_dirs "${deploy_root}/releases" 3 "${release_sha}" "${previous_active_sha}"
  docker image prune --all --force || true
  exit 0
fi

echo "Aura backend release ${release_sha} failed TLS edge checks for ${backend_public_host}." >&2
docker compose \
  --env-file "${shared_dir}/base.env" \
  --env-file "${shared_dir}/runtime-secrets.env" \
  --env-file "${shared_dir}/release.env" \
  -f "${compose_file}" \
  logs --tail 100 >&2
exit 1
