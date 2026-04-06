#!/usr/bin/env bash

set -euo pipefail

: "${RESOURCE_GROUP:?RESOURCE_GROUP is required}"
: "${API_APP_NAME:?API_APP_NAME is required}"
: "${WORKER_APP_NAME:?WORKER_APP_NAME is required}"
: "${IMAGE_REF:?IMAGE_REF is required}"

HEALTH_PATH="${HEALTH_PATH:-/health}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-240}"
HEALTH_POLL_INTERVAL_SECONDS="${HEALTH_POLL_INTERVAL_SECONDS:-10}"
CANDIDATE_HEALTH_TIMEOUT_SECONDS="${CANDIDATE_HEALTH_TIMEOUT_SECONDS:-30}"
REVISION_SUFFIX="${REVISION_SUFFIX:-r${GITHUB_RUN_NUMBER:-0}-${GITHUB_SHA:-manual}}"
REVISION_SUFFIX="${REVISION_SUFFIX:0:30}"

previous_api_revision=""
previous_api_image=""
previous_worker_revision=""
previous_worker_image=""
candidate_api_revision=""
candidate_worker_revision=""

log() {
  echo "[azure-release] $*"
}

write_output() {
  local key="$1"
  local value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "${key}=${value}" >> "${GITHUB_OUTPUT}"
  fi
}

current_api_revision() {
  az containerapp revision list \
    --name "${API_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query "sort_by([?properties.trafficWeight > \`0\`], &properties.createdTime)[-1].name" \
    --output tsv
}

current_worker_image() {
  az containerapp show \
    --name "${WORKER_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query "properties.template.containers[0].image" \
    --output tsv
}

current_api_image() {
  az containerapp show \
    --name "${API_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query "properties.template.containers[0].image" \
    --output tsv
}

latest_revision_name() {
  local app_name="$1"
  az containerapp show \
    --name "${app_name}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query "properties.latestRevisionName" \
    --output tsv
}

revision_field() {
  local app_name="$1"
  local revision_name="$2"
  local query="$3"
  az containerapp revision show \
    --name "${app_name}" \
    --resource-group "${RESOURCE_GROUP}" \
    --revision "${revision_name}" \
    --query "${query}" \
    --output tsv
}

wait_for_revision_ready() {
  local app_name="$1"
  local revision_name="$2"
  local role="$3"
  local attempts=$((HEALTH_TIMEOUT_SECONDS / HEALTH_POLL_INTERVAL_SECONDS))

  for (( attempt=1; attempt<=attempts; attempt++ )); do
    local provisioning_state
    local running_state
    local health_state

    provisioning_state="$(revision_field "${app_name}" "${revision_name}" "properties.provisioningState")"
    running_state="$(revision_field "${app_name}" "${revision_name}" "properties.runningState")"
    health_state="$(revision_field "${app_name}" "${revision_name}" "properties.healthState")"

    log "${role} revision ${revision_name}: provisioning=${provisioning_state} running=${running_state} health=${health_state:-n/a}"

    if [[ "${provisioning_state}" == "Provisioned" ]]; then
      if [[ -z "${health_state}" || "${health_state}" == "Healthy" ]]; then
        case "${running_state}" in
          Running*|Activating|Active|"")
            return 0
            ;;
        esac
      fi
    fi

    sleep "${HEALTH_POLL_INTERVAL_SECONDS}"
  done

  echo "Timed out waiting for ${role} revision ${revision_name} to become healthy." >&2
  return 1
}

assert_health_payload() {
  python -c 'import json, sys
payload = json.load(sys.stdin)
status_ok = payload.get("status") == "ok"
split_runtime_ready = payload.get("topology", {}).get("splitRuntimeReady", True)
redis_ok = payload.get("redis", {}).get("connected", True)
mongo_ok = payload.get("topology", {}).get("mongo", {}).get("connected", True)
if status_ok and split_runtime_ready and redis_ok and mongo_ok:
    sys.exit(0)
print(json.dumps(payload, indent=2), file=sys.stderr)
sys.exit(1)'
}

wait_for_http_health() {
  local base_url="$1"
  local label="$2"
  local path="${3:-${HEALTH_PATH}}"
  local timeout_seconds="${4:-${HEALTH_TIMEOUT_SECONDS}}"
  local attempts=$((timeout_seconds / HEALTH_POLL_INTERVAL_SECONDS))
  if (( attempts < 1 )); then
    attempts=1
  fi

  for (( attempt=1; attempt<=attempts; attempt++ )); do
    local response
    if response="$(curl --silent --show-error --fail --max-time 20 "${base_url}${path}")"; then
      if [[ "${path}" == "/health" ]] && printf '%s' "${response}" | assert_health_payload; then
        log "${label} health check passed on attempt ${attempt}."
        return 0
      fi
      if [[ "${path}" != "/health" ]]; then
        log "${label} health check passed on attempt ${attempt}."
        return 0
      fi
    fi

    log "${label} health check not ready yet (attempt ${attempt}/${attempts})."
    sleep "${HEALTH_POLL_INTERVAL_SECONDS}"
  done

  echo "Timed out waiting for ${label} health check at ${base_url}${path}." >&2
  return 1
}

probe_candidate_or_production_health() {
  local candidate_url="$1"
  local production_url="$2"
  local candidate_revision="$3"
  local live_revision

  if [[ -n "${candidate_url}" ]]; then
    if wait_for_http_health "${candidate_url}" "candidate" "${HEALTH_PATH}" "${CANDIDATE_HEALTH_TIMEOUT_SECONDS}"; then
      return 0
    fi
    log "Candidate revision URL ${candidate_url} did not pass health checks. Falling back to production ingress."
  fi

  live_revision="$(current_api_revision)"
  if [[ -n "${candidate_revision}" && "${live_revision}" != "${candidate_revision}" ]]; then
    echo "Production ingress is not pointing at candidate revision ${candidate_revision}; refusing fallback health acceptance." >&2
    return 1
  fi

  wait_for_http_health "${production_url}" "production"
}

rollback_release() {
  local exit_code=$?
  if [[ "${exit_code}" -eq 0 ]]; then
    return
  fi

  log "Release failed. Starting rollback."

  if [[ -n "${previous_api_image}" ]]; then
    az containerapp update \
      --name "${API_APP_NAME}" \
      --resource-group "${RESOURCE_GROUP}" \
      --image "${previous_api_image}" >/dev/null || true
  fi

  if [[ -n "${previous_worker_image}" ]]; then
    az containerapp update \
      --name "${WORKER_APP_NAME}" \
      --resource-group "${RESOURCE_GROUP}" \
      --image "${previous_worker_image}" >/dev/null || true
  fi

  exit "${exit_code}"
}

wait_for_new_revision() {
  local app_name="$1"
  local previous_revision="$2"
  local role="$3"
  local attempts=$((HEALTH_TIMEOUT_SECONDS / HEALTH_POLL_INTERVAL_SECONDS))

  for (( attempt=1; attempt<=attempts; attempt++ )); do
    local latest_revision
    latest_revision="$(latest_revision_name "${app_name}")"

    if [[ -n "${latest_revision}" && "${latest_revision}" != "${previous_revision}" ]]; then
      printf '%s' "${latest_revision}"
      return 0
    fi

    log "Waiting for ${role} to emit a new revision (attempt ${attempt}/${attempts})."
    sleep "${HEALTH_POLL_INTERVAL_SECONDS}"
  done

  echo "Timed out waiting for ${role} to create a new revision." >&2
  return 1
}

trap rollback_release ERR

previous_api_revision="$(current_api_revision)"
if [[ -z "${previous_api_revision}" ]]; then
  echo "Could not resolve the current API revision carrying production traffic." >&2
  exit 1
fi

previous_api_image="$(current_api_image)"
previous_worker_revision="$(latest_revision_name "${WORKER_APP_NAME}")"
previous_worker_image="$(current_worker_image)"

write_output "previous_api_revision" "${previous_api_revision}"
write_output "previous_worker_revision" "${previous_worker_revision}"
write_output "previous_worker_image" "${previous_worker_image}"
write_output "previous_api_image" "${previous_api_image}"

log "Enforcing single-revision mode on the API app."
az containerapp revision set-mode \
  --name "${API_APP_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --mode single >/dev/null

if [[ "${previous_api_image}" == "${IMAGE_REF}" ]]; then
  log "API is already on ${IMAGE_REF}; skipping image update."
  candidate_api_revision="${previous_api_revision}"
else
  log "Updating API to image ${IMAGE_REF}."
  az containerapp update \
    --name "${API_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --image "${IMAGE_REF}" \
    --revision-suffix "${REVISION_SUFFIX}" >/dev/null

  candidate_api_revision="$(wait_for_new_revision "${API_APP_NAME}" "${previous_api_revision}" "API")"
fi

candidate_api_fqdn="$(revision_field "${API_APP_NAME}" "${candidate_api_revision}" "properties.fqdn")"

write_output "candidate_api_revision" "${candidate_api_revision}"
write_output "candidate_api_fqdn" "${candidate_api_fqdn}"

wait_for_revision_ready "${API_APP_NAME}" "${candidate_api_revision}" "API candidate"
production_fqdn="$(az containerapp show --name "${API_APP_NAME}" --resource-group "${RESOURCE_GROUP}" --query "properties.configuration.ingress.fqdn" --output tsv)"
if [[ -z "${production_fqdn}" ]]; then
  echo "Could not resolve the production ingress FQDN for ${API_APP_NAME}." >&2
  exit 1
fi

candidate_api_url=""
if [[ -n "${candidate_api_fqdn}" ]]; then
  candidate_api_url="https://${candidate_api_fqdn}"
fi

probe_candidate_or_production_health "${candidate_api_url}" "https://${production_fqdn}" "${candidate_api_revision}"

az containerapp revision label add \
  --name "${API_APP_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --label stable \
  --revision "${candidate_api_revision}" \
  --yes >/dev/null

if [[ "${previous_worker_image}" == "${IMAGE_REF}" ]]; then
  log "Worker is already on ${IMAGE_REF}; skipping image update."
  candidate_worker_revision="$(latest_revision_name "${WORKER_APP_NAME}")"
else
  log "Updating worker to ${IMAGE_REF}."
  az containerapp update \
    --name "${WORKER_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --image "${IMAGE_REF}" >/dev/null

  candidate_worker_revision="$(wait_for_new_revision "${WORKER_APP_NAME}" "${previous_worker_revision}" "worker")"
fi

write_output "candidate_worker_revision" "${candidate_worker_revision}"

wait_for_revision_ready "${WORKER_APP_NAME}" "${candidate_worker_revision}" "worker"
wait_for_http_health "https://${production_fqdn}" "production"

trap - ERR

log "Release completed successfully."
log "API revision: ${candidate_api_revision}"
log "Worker revision: ${candidate_worker_revision}"
log "Image: ${IMAGE_REF}"

write_output "production_fqdn" "${production_fqdn}"
write_output "image_ref" "${IMAGE_REF}"
