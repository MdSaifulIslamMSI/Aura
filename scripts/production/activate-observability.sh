#!/usr/bin/env bash
# Host-side activation of the observability stack (Prometheus, Alertmanager,
# Grafana) on the backend EC2 host. Dispatched by
# .github/workflows/observability-activation.yml with probe_only=false.
#
# What it does:
#   - Ensures shared env entries exist (append-only): STATUS_WEBHOOK_TOKEN
#     (reused as ALERTMANAGER_STATUS_WEBHOOK_TOKEN), METRICS_SECRET,
#     GRAFANA_ADMIN_PASSWORD. Existing values are never overwritten.
#   - Writes /opt/aura/shared/metrics-secret to match METRICS_SECRET exactly
#     (no trailing newline — prometheus uses raw file bytes as the header).
#   - Starts the observability compose project joined to the existing
#     aws_default network. Does NOT touch the running api/worker/edge/redis
#     containers: env appended here is picked up by the api/worker at their
#     next normal deploy restart.
#   - Optionally fires a synthetic alert and verifies Alertmanager delivered
#     it to the Aura status webhook (failed-delivery metric stays 0).
set -euo pipefail

FIRE_TEST_ALERT="${FIRE_TEST_ALERT:-true}"
SHARED_ENV=/opt/aura/shared/base.env

# The release tree (from deploy-backend-aws) may predate infra/observability;
# the activation workflow ships the current tree to S3 and passes its key and
# sha256. Download and verify into a self-contained working directory.
if [ -n "${AURA_OBS_KEY:-}" ] && [ -n "${AURA_OBS_SHA256:-}" ]; then
  OBS_DIR=/opt/aura/observability
  mkdir -p "$OBS_DIR"
  aws s3 cp "s3://${AWS_DEPLOY_BUCKET}/${AURA_OBS_KEY}" "$OBS_DIR/infra-observability.tar.gz" --region "$AWS_REGION" --only-show-errors
  echo "${AURA_OBS_SHA256}  $OBS_DIR/infra-observability.tar.gz" | sha256sum --check --status
  OBS_WORK="$(mktemp -d)"
  tar -xzf "$OBS_DIR/infra-observability.tar.gz" -C "$OBS_WORK"
  RELEASE_DIR="$OBS_WORK"
  trap 'rm -rf "$OBS_WORK"' EXIT
else
  RELEASE_DIR="$(readlink -f /opt/aura/current)"
fi

[ -f "$RELEASE_DIR/infra/observability/docker-compose.ec2.yml" ] || {
  echo "Observability compose file missing (neither in release nor shipped bundle)"; exit 1;
}

grep_env_value() {
  grep -h "^$1=" /opt/aura/shared/base.env /opt/aura/shared/runtime-secrets.env /opt/aura/shared/release.env 2>/dev/null | head -1 | cut -d= -f2- || true
}

ensure_env_entry() {
  # ensure_env_entry <KEY> <VALUE> — appends only if KEY is absent everywhere.
  local key="$1" value="$2"
  if [ -n "$(grep_env_value "$key")" ]; then
    echo "env: $key already present (kept)"
    return 0
  fi
  printf '%s=%s\n' "$key" "$value" >> "$SHARED_ENV"
  echo "env: appended $key to $SHARED_ENV"
}

echo "=== resolving tokens ==="
STATUS_TOKEN="$(grep_env_value STATUS_WEBHOOK_TOKEN)"
if [ -z "$STATUS_TOKEN" ]; then
  STATUS_TOKEN="$(openssl rand -hex 24)"
  echo "env: STATUS_WEBHOOK_TOKEN absent - generating (api/worker load it at next deploy)"
fi
ensure_env_entry STATUS_WEBHOOK_TOKEN "$STATUS_TOKEN"
ensure_env_entry ALERTMANAGER_STATUS_WEBHOOK_TOKEN "$STATUS_TOKEN"

METRICS_SECRET_VALUE="$(grep_env_value METRICS_SECRET)"
if [ -z "$METRICS_SECRET_VALUE" ]; then
  METRICS_SECRET_VALUE="$(openssl rand -hex 24)"
  echo "env: METRICS_SECRET absent - generating (api/worker load it at next deploy)"
fi
ensure_env_entry METRICS_SECRET "$METRICS_SECRET_VALUE"
# Prometheus sends raw file bytes as the x-metrics-key header: no newline.
printf '%s' "$METRICS_SECRET_VALUE" > /opt/aura/shared/metrics-secret
chmod 600 /opt/aura/shared/metrics-secret

GRAFANA_PASSWORD="$(grep_env_value GRAFANA_ADMIN_PASSWORD)"
if [ -z "$GRAFANA_PASSWORD" ]; then
  GRAFANA_PASSWORD="$(openssl rand -hex 12)"
fi
ensure_env_entry GRAFANA_ADMIN_PASSWORD "$GRAFANA_PASSWORD"

echo "=== starting observability stack from $RELEASE_DIR ==="
cd "$RELEASE_DIR"
# Export only the variables the compose file interpolates — never `source`
# the shared env files: runtime-secrets.env contains values that are valid
# for compose's env_file parser but not executable shell.
export ALERTMANAGER_STATUS_WEBHOOK_TOKEN="$STATUS_TOKEN"
export GRAFANA_ADMIN_PASSWORD="$GRAFANA_PASSWORD"
docker compose -f infra/observability/docker-compose.ec2.yml --project-name aura-observability up -d

echo "=== waiting for readiness ==="
for _ in $(seq 1 30); do
  p="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:9090/-/ready || true)"
  a="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:9093/-/ready || true)"
  [ "$p" = "200" ] && [ "$a" = "200" ] && break
  sleep 2
done
echo "prometheus /-/ready -> ${p:-none}"
echo "alertmanager /-/ready -> ${a:-none}"
[ "${p:-}" = "200" ] || { echo "Prometheus did not become ready"; docker compose -f infra/observability/docker-compose.ec2.yml --project-name aura-observability logs --tail=40 prometheus; exit 1; }
[ "${a:-}" = "200" ] || { echo "Alertmanager did not become ready"; docker compose -f infra/observability/docker-compose.ec2.yml --project-name aura-observability logs --tail=40 alertmanager; exit 1; }

echo "=== prometheus targets ==="
sleep 5
curl -s --max-time 5 http://127.0.0.1:9090/api/v1/targets | head -c 600 || true
echo ""
echo "(If the aura-api target shows 503 down: METRICS_SECRET was just appended and the api container loads it at its next deploy restart — the scrape comes alive then. The alert channel below is verifiable now.)"

if [ "$FIRE_TEST_ALERT" != "true" ]; then
  echo "ACTIVATION_COMPLETE (test alert skipped)"
  exit 0
fi

echo "=== firing synthetic test alert ==="
BEFORE_FAILED="$(curl -s --max-time 5 'http://127.0.0.1:9093/api/v2/status' || true)"
curl -s --max-time 5 -X POST http://127.0.0.1:9093/api/v2/alerts -H 'Content-Type: application/json' -d '[{
  "labels": {
    "alertname": "AuraActivationTest",
    "component": "activation",
    "severity": "warning"
  },
  "annotations": {
    "summary": "Synthetic alert verifying the Alertmanager to Aura status webhook channel"
  },
  "startsAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
  "endsAt": "'"$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)"'"
}]' || true
echo "posted test alert; waiting 45s for group_wait + delivery"
sleep 45

echo "=== delivery evidence ==="
curl -s --max-time 5 http://127.0.0.1:9093/metrics | grep -E 'alertmanager_notifications_(total|failed_total)' | grep -v '#' || true
FAILED="$(curl -s --max-time 5 http://127.0.0.1:9093/metrics | grep -E '^alertmanager_notifications_failed_total' | awk '{s+=$2} END {print s+0}')"
SENT="$(curl -s --max-time 5 http://127.0.0.1:9093/metrics | grep -E '^alertmanager_notifications_total' | awk '{s+=$2} END {print s+0}')"
echo "notifications sent=${SENT} failed=${FAILED}"
docker compose -f infra/observability/docker-compose.ec2.yml --project-name aura-observability logs --tail=15 alertmanager || true

if [ "${SENT:-0}" -ge 1 ] && [ "${FAILED:-0}" -eq 0 ]; then
  echo "ALERT_CHANNEL_VERIFIED"
else
  echo "ALERT_CHANNEL_UNVERIFIED (sent=${SENT:-0} failed=${FAILED:-0}) — if failed>0, the API rejected the webhook; most likely the api container predates the appended STATUS_WEBHOOK_TOKEN and needs its next deploy restart."
  exit 1
fi

echo "ACTIVATION_COMPLETE"
