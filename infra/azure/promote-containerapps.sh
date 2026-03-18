#!/usr/bin/env bash

set -euo pipefail

: "${RESOURCE_GROUP:?RESOURCE_GROUP is required}"
: "${API_APP_NAME:?API_APP_NAME is required}"
: "${WORKER_APP_NAME:?WORKER_APP_NAME is required}"
: "${IMAGE_REF:?IMAGE_REF is required}"

HEALTH_PATH="${HEALTH_PATH:-/health}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-240}"
HEALTH_POLL_INTERVAL_SECONDS="${HEALTH_POLL_INTERVAL_SECONDS:-10}"
REVISION_SUFFIX="${REVISION_SUFFIX:-r${GITHUB_RUN_NUMBER:-0}-${GITHUB_SHA:-manual}}"
REVISION_SUFFIX="${REVISION_SUFFIX:0:30}"

previous_api_revision=""
previous_worker_image=""
candidate_api_revision=""
candidate_worker_revision=""
traffic_shifted="false"

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

    if [[ "${provisioning_state}" == "Provisioned" && "${running_state}" == Running* ]]; then
      if [[ -z "${health_state}" || "${health_state}" == "Healthy" ]]; then
        return 0
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
  local attempts=$((HEALTH_TIMEOUT_SECONDS / HEALTH_POLL_INTERVAL_SECONDS))

  for (( attempt=1; attempt<=attempts; attempt++ )); do
    local response
    if response="$(curl --silent --show-error --fail --max-time 20 "${base_url}${HEALTH_PATH}")"; then
      if printf '%s' "${response}" | assert_health_payload; then
        log "${label} health check passed on attempt ${attempt}."
        return 0
      fi
    fi

    log "${label} health check not ready yet (attempt ${attempt}/${attempts})."
    sleep "${HEALTH_POLL_INTERVAL_SECONDS}"
  done

  echo "Timed out waiting for ${label} health check at ${base_url}${HEALTH_PATH}." >&2
  return 1
}

rollback_release() {
  local exit_code=$?
  if [[ "${exit_code}" -eq 0 ]]; then
    return
  fi

  log "Release failed. Starting rollback."

  if [[ -n "${previous_api_revision}" ]]; then
    az containerapp revision activate \
      --name "${API_APP_NAME}" \
      --resource-group "${RESOURCE_GROUP}" \
      --revision "${previous_api_revision}" >/dev/null || true

    az containerapp ingress traffic set \
      --name "${API_APP_NAME}" \
      --resource-group "${RESOURCE_GROUP}" \
      --revision-weight "${previous_api_revision}=100" >/dev/null || true
  fi

  if [[ -n "${candidate_api_revision}" ]]; then
    az containerapp revision deactivate \
      --name "${API_APP_NAME}" \
      --resource-group "${RESOURCE_GROUP}" \
      --revision "${candidate_api_revision}" >/dev/null || true
  fi

  if [[ -n "${previous_worker_image}" ]]; then
    az containerapp update \
      --name "${WORKER_APP_NAME}" \
      --resource-group "${RESOURCE_GROUP}" \
      --image "${previous_worker_image}" >/dev/null || true
  fi

  exit "${exit_code}"
}

trap rollback_release ERR

previous_api_revision="$(current_api_revision)"
if [[ -z "${previous_api_revision}" ]]; then
  echo "Could not resolve the current API revision carrying production traffic." >&2
  exit 1
fi

previous_worker_image="$(current_worker_image)"

write_output "previous_api_revision" "${previous_api_revision}"
write_output "previous_worker_image" "${previous_worker_image}"

log "Pinning API traffic to ${previous_api_revision} before creating a candidate revision."
az containerapp revision set-mode \
  --name "${API_APP_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --mode multiple >/dev/null

az containerapp ingress traffic set \
  --name "${API_APP_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --revision-weight "${previous_api_revision}=100" >/dev/null

log "Creating API candidate revision from ${previous_api_revision} using image ${IMAGE_REF}."
az containerapp revision copy \
  --name "${API_APP_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --from-revision "${previous_api_revision}" \
  --image "${IMAGE_REF}" \
  --revision-suffix "${REVISION_SUFFIX}" >/dev/null

candidate_api_revision="$(latest_revision_name "${API_APP_NAME}")"
if [[ "${candidate_api_revision}" == "${previous_api_revision}" || -z "${candidate_api_revision}" ]]; then
  echo "Failed to create a new API revision." >&2
  exit 1
fi

candidate_api_fqdn="$(revision_field "${API_APP_NAME}" "${candidate_api_revision}" "properties.fqdn")"

write_output "candidate_api_revision" "${candidate_api_revision}"
write_output "candidate_api_fqdn" "${candidate_api_fqdn}"

wait_for_revision_ready "${API_APP_NAME}" "${candidate_api_revision}" "API candidate"
wait_for_http_health "https://${candidate_api_fqdn}" "API candidate"

log "Shifting API traffic to ${candidate_api_revision}."
az containerapp ingress traffic set \
  --name "${API_APP_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --revision-weight "${candidate_api_revision}=100" "${previous_api_revision}=0" >/dev/null
traffic_shifted="true"

az containerapp revision label add \
  --name "${API_APP_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --label stable \
  --revision "${candidate_api_revision}" \
  --yes >/dev/null

log "Updating worker to ${IMAGE_REF}."
az containerapp update \
  --name "${WORKER_APP_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --image "${IMAGE_REF}" >/dev/null

candidate_worker_revision="$(latest_revision_name "${WORKER_APP_NAME}")"
write_output "candidate_worker_revision" "${candidate_worker_revision}"

wait_for_revision_ready "${WORKER_APP_NAME}" "${candidate_worker_revision}" "worker"

production_fqdn="$(az containerapp show --name "${API_APP_NAME}" --resource-group "${RESOURCE_GROUP}" --query "properties.configuration.ingress.fqdn" --output tsv)"
wait_for_http_health "https://${production_fqdn}" "production"

trap - ERR

log "Release completed successfully."
log "API revision: ${candidate_api_revision}"
log "Worker revision: ${candidate_worker_revision}"
log "Image: ${IMAGE_REF}"

write_output "production_fqdn" "${production_fqdn}"
write_output "image_ref" "${IMAGE_REF}"
