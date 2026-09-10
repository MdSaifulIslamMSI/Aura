#!/usr/bin/env bash
# Read-only discovery of the observability posture on the backend EC2 host.
# Dispatched by .github/workflows/observability-activation.yml (probe_only).
# Writes nothing, deletes nothing, restarts nothing.
set -euo pipefail

echo "=== identity ==="
uname -a
whoami

echo "=== /opt/aura layout ==="
ls -la /opt/aura 2>/dev/null || echo "(no /opt/aura)"
ls -la /opt/aura/src 2>/dev/null | head -25 || true

echo "=== compose files on host ==="
find /opt -maxdepth 4 -name 'docker-compose*' 2>/dev/null | head -10

echo "=== observability dir contents ==="
ls -la /opt/aura/src/infra/observability 2>/dev/null || echo "(no observability dir)"
ls /opt/aura/src/infra/observability/alertmanager 2>/dev/null || true

echo "=== running containers ==="
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

echo "=== all containers (incl. stopped, observability) ==="
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -iE "prometheus|grafana|alertmanager|loki" || echo "(none)"

echo "=== docker networks ==="
docker network ls

echo "=== api container networks ==="
API_ID="$(docker ps -q --filter "name=api" | head -1)"
[ -n "$API_ID" ] && docker inspect "$API_ID" --format '{{json .NetworkSettings.Networks}}' | head -c 600 || echo "(no api container found)"

echo ""
echo "=== alertmanager token configured? ==="
for env_file in /opt/aura/shared/base.env /opt/aura/shared/runtime-secrets.env /opt/aura/shared/release.env; do
  if [ -f "$env_file" ]; then
    count="$(grep -c '^ALERTMANAGER_STATUS_WEBHOOK_TOKEN=' "$env_file" 2>/dev/null || true)"
    echo "$env_file: ${count:-0} occurrence(s)"
  fi
done

echo "=== api-side webhook + metrics auth env (presence only, no values) ==="
for env_file in /opt/aura/shared/base.env /opt/aura/shared/runtime-secrets.env /opt/aura/shared/release.env; do
  [ -f "$env_file" ] || continue
  for key in STATUS_WEBHOOK_TOKEN STATUS_WEBHOOK_SECRET STATUS_WEBHOOK_IP_ALLOWLIST METRICS_SECRET CRON_SECRET; do
    count="$(grep -c "^${key}=" "$env_file" 2>/dev/null || true)"
    [ "${count:-0}" != "0" ] && echo "$env_file: $key present"
  done
done

echo "=== metrics secret file for prometheus mount ==="
ls -la /opt/aura/shared/metrics-secret 2>/dev/null || echo "(missing)"

echo "=== release layout (compose context) ==="
readlink -f /opt/aura/current 2>/dev/null || true
ls /opt/aura/current 2>/dev/null | head -12
find /opt/aura/current -maxdepth 3 -name 'docker-compose*' 2>/dev/null | head -5
ls /opt/aura/current/infra/observability 2>/dev/null || echo "(no observability dir in release)"

echo "=== alertmanager reachable on 9093? ==="
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9093/-/ready 2>/dev/null || true)"
echo "127.0.0.1:9093/-/ready -> ${code:-unreachable}"

echo "=== prometheus reachable on 9090? ==="
pcode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9090/-/ready 2>/dev/null || true)"
echo "127.0.0.1:9090/-/ready -> ${pcode:-unreachable}"

echo "=== disk headroom ==="
df -h / /opt 2>/dev/null | head -5

echo "PROBE_COMPLETE"
