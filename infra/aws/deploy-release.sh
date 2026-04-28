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

  [[ -d "${releases_dir}" ]] || return 0

  find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d ! -name "${release_sha}" -printf '%T@ %p\n' \
    | sort -rn \
    | awk -v keep="${keep_count}" 'NR > keep { sub(/^[^ ]+ /, ""); print }' \
    | while IFS= read -r old_release_dir; do
        [[ -n "${old_release_dir}" ]] || continue
        echo "Removing old release directory ${old_release_dir}"
        rm -rf "${old_release_dir}"
      done
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

deploy_root="${AURA_DEPLOY_ROOT:-/opt/aura}"
release_sha="${AURA_RELEASE_SHA:?AURA_RELEASE_SHA is required}"
deploy_bucket="${AURA_DEPLOY_BUCKET:?AURA_DEPLOY_BUCKET is required}"
infra_bundle_key="${AURA_INFRA_BUNDLE_KEY:?AURA_INFRA_BUNDLE_KEY is required}"
image_bundle_key="${AURA_IMAGE_BUNDLE_KEY:?AURA_IMAGE_BUNDLE_KEY is required}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

if [[ -z "${aws_region}" ]]; then
  echo "AWS_REGION or AWS_DEFAULT_REGION is required" >&2
  exit 1
fi

release_dir="${deploy_root}/releases/${release_sha}"
current_dir="${deploy_root}/current"
shared_dir="${deploy_root}/shared"
compose_file="${current_dir}/infra/aws/docker-compose.ec2.yml"

mkdir -p "${release_dir}" "${current_dir}" "${shared_dir}"
cleanup_old_release_dirs "${deploy_root}/releases" 3
prepare_docker_disk_space

aws s3 cp --region "${aws_region}" "s3://${deploy_bucket}/${infra_bundle_key}" "${release_dir}/infra.tar.gz"
aws s3 cp --region "${aws_region}" "s3://${deploy_bucket}/${image_bundle_key}" "${release_dir}/image.tar.gz"

rm -rf "${current_dir}"
mkdir -p "${current_dir}"

tar -xzf "${release_dir}/infra.tar.gz" -C "${current_dir}"
gunzip -c "${release_dir}/image.tar.gz" | docker load

bash "${current_dir}/infra/aws/render-runtime-secrets.sh"

cat > "${shared_dir}/release.env" <<EOF
AURA_BACKEND_IMAGE=aura-backend:${release_sha}
AURA_APP_BUILD_SHA=${release_sha}
EOF

chmod 600 "${shared_dir}/release.env"

assert_trusted_device_runtime_contract "${compose_file}" \
  "${shared_dir}/base.env" \
  "${shared_dir}/runtime-secrets.env" \
  "${shared_dir}/release.env"

docker compose \
  --env-file "${shared_dir}/base.env" \
  --env-file "${shared_dir}/runtime-secrets.env" \
  --env-file "${shared_dir}/release.env" \
  -f "${compose_file}" \
  up -d --remove-orphans

api_ready=false
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:5000/health/ready > /dev/null; then
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
    --resolve "${backend_public_host}:443:127.0.0.1" \
    "https://${backend_public_host}/health/live" > /dev/null; then
    edge_ready=true
    break
  fi
  sleep 10
done

if [[ "${edge_ready}" == "true" ]]; then
  echo "Aura backend release ${release_sha} is healthy behind TLS edge ${backend_public_host}."
  cleanup_old_release_dirs "${deploy_root}/releases" 3
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
