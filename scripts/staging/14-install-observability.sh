#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
ensure_state
[ -f "$STATE_DIR/ssh_config" ] || die "Missing $STATE_DIR/ssh_config. Run 06-render-ssh-config.sh first."

wait_for_ssh aura-staging

remote_env="STAGING_BACKEND_PORT='$STAGING_BACKEND_PORT' ENABLE_CLOUDWATCH_AGENT='$ENABLE_CLOUDWATCH_AGENT'"
ssh -F "$STATE_DIR/ssh_config" aura-staging "$remote_env bash -s" <<'REMOTE'
set -euo pipefail
sudo mkdir -p /opt/aura-staging/logs
sudo tee /usr/local/bin/aura-staging-health-check >/dev/null <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
port="${STAGING_BACKEND_PORT:-3000}"
log_file="/opt/aura-staging/logs/staging-health.jsonl"
tmp_health="$(mktemp)"
http_code="$(curl -sS -o "$tmp_health" -w '%{http_code}' "http://127.0.0.1:${port}/health" || printf '000')"
scanner_container="$(cd /opt/aura-staging/src/infra/staging && sudo docker compose ps -q scanner 2>/dev/null || true)"
scanner_status="missing"
if [ -n "$scanner_container" ]; then
  scanner_status="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$scanner_container" 2>/dev/null || printf 'unknown')"
fi
disk_pct="$(df -P / | awk 'NR==2 {gsub("%", "", $5); print $5}')"
backend_container="$(cd /opt/aura-staging/src/infra/staging && sudo docker compose ps -q backend 2>/dev/null || true)"
backend_status="missing"
if [ -n "$backend_container" ]; then
  backend_status="$(sudo docker inspect --format '{{.State.Status}}' "$backend_container" 2>/dev/null || printf 'unknown')"
fi
printf '{"ts":"%s","env":"staging","ssmPrefix":"/aura/staging","http":%s,"backend":"%s","scanner":"%s","diskPct":%s}\n' \
  "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  "$http_code" \
  "$backend_status" \
  "$scanner_status" \
  "${disk_pct:-0}" >> "$log_file"
rm -f "$tmp_health"
SCRIPT
sudo chmod +x /usr/local/bin/aura-staging-health-check

sudo tee /etc/systemd/system/aura-staging-health-check.service >/dev/null <<'UNIT'
[Unit]
Description=Aura staging local health check

[Service]
Type=oneshot
ExecStart=/usr/local/bin/aura-staging-health-check
UNIT
sudo sed -i "s#ExecStart=#Environment=STAGING_BACKEND_PORT=${STAGING_BACKEND_PORT}\\nExecStart=#" /etc/systemd/system/aura-staging-health-check.service

sudo tee /etc/systemd/system/aura-staging-health-check.timer >/dev/null <<'UNIT'
[Unit]
Description=Run Aura staging local health check every five minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now aura-staging-health-check.timer
sudo systemctl start aura-staging-health-check.service

if [ "$ENABLE_CLOUDWATCH_AGENT" = "true" ]; then
  echo "ENABLE_CLOUDWATCH_AGENT=true is intentionally not auto-installed by the Free Tier script. Add it only with an explicit cost/retention plan." >&2
  exit 1
fi
REMOTE

state_set observability "local-systemd-health-timer"
log "Installed local staging observability timer. Logs: /opt/aura-staging/logs/staging-health.jsonl"
