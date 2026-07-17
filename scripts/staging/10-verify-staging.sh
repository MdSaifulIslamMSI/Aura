#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

STAGING_PREFLIGHT_MODE=verify bash "$SCRIPT_DIR/00-preflight.sh"

ensure_state
staging_base_url="${STAGING_BASE_URL:-$(state_get staging_base_url)}"
staging_api_base_url="${STAGING_API_BASE_URL:-$(state_get staging_api_base_url)}"
staging_health_url="${STAGING_HEALTH_URL:-$(state_get staging_health_url)}"
staging_frontend_url="${STAGING_FRONTEND_URL:-$(state_get staging_frontend_url)}"

export STAGING_BASE_URL="$staging_base_url"
export STAGING_API_BASE_URL="$staging_api_base_url"
export STAGING_HEALTH_URL="$staging_health_url"
export STAGING_SSM_PREFIX="/aura/staging"
export SMOKE_TARGET_ENV="staging"
export SMOKE_BASE_URL="$staging_base_url"
export SMOKE_REQUIRE_BACKEND_STAGING="true"
export SMOKE_FORBID_PRODUCTION_ORIGINS="true"
export SMOKE_REQUIRE_SCANNER_READY="${SMOKE_REQUIRE_SCANNER_READY:-false}"
export PROD_SSM_PREFIX="/aura/prod"
if [ -n "$staging_frontend_url" ]; then
  export STAGING_FRONTEND_URL="$staging_frontend_url"
fi

node "$(node_path "$REPO_ROOT/scripts/smoke/assert-staging-contract.mjs")"
node "$(node_path "$REPO_ROOT/scripts/smoke/staging-route-smoke.mjs")"

frontend_smoke="not_configured"
frontend_mode="not_configured"
if [ -n "$staging_frontend_url" ]; then
  node "$(node_path "$REPO_ROOT/scripts/smoke/assert-frontend-staging-target.mjs")"
  frontend_smoke="PASS"
  if [ "$staging_frontend_url" = "$STAGING_API_BASE_URL" ]; then
    frontend_mode="Docker static frontend on AWS staging"
  else
    frontend_mode="external staging frontend"
  fi
fi

curl -fsS "$STAGING_HEALTH_URL" >/tmp/aura-staging-health.json
aws_cli s3api get-public-access-block --bucket "$STAGING_BUCKET_NAME" >/tmp/aura-staging-s3-public-access.json
aws_cli ssm get-parameter --region "$AWS_REGION" --name /aura/staging/APP_ENV --query 'Parameter.Value' --output text >/tmp/aura-staging-app-env.txt

docker_status="not_checked"
docker_status_command='for service in backend mongo postgres redis scanner; do cid="$(sudo docker compose ps -q "$service" 2>/dev/null || true)"; if [ -n "$cid" ]; then status="$(sudo docker inspect --format "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}" "$cid" 2>/dev/null | xargs || printf unknown)"; else status="missing"; fi; printf "%s %s\n" "$service" "$status"; done'
if [ -f "$STATE_DIR/ssh_config" ]; then
  if ssh -F "$STATE_DIR/ssh_config" -o BatchMode=yes -o ConnectTimeout=5 aura-staging true >/dev/null 2>&1; then
    docker_status="$(ssh -F "$STATE_DIR/ssh_config" -o ConnectTimeout=5 aura-staging "cd /opt/aura-staging/src/infra/staging && $docker_status_command" 2>/dev/null || true)"
  else
    instance_id="$(state_get instance_id)"
    ssm_status="$(aws_cli ssm describe-instance-information --region "$AWS_REGION" --filters "Key=InstanceIds,Values=$instance_id" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
    if [ "$ssm_status" = "Online" ]; then
      ssm_params="$STATE_DIR/verify-docker-status.json"
      cat > "$ssm_params" <<'JSON'
{
    "commands": [
      "set -euo pipefail",
      "cd /opt/aura-staging/src/infra/staging",
      "for service in backend mongo postgres redis scanner; do cid=\"$(sudo docker compose ps -q \"$service\" 2>/dev/null || true)\"; if [ -n \"$cid\" ]; then status=\"$(sudo docker inspect --format \"{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}\" \"$cid\" 2>/dev/null | xargs || printf unknown)\"; else status=\"missing\"; fi; printf \"%s %s\\n\" \"$service\" \"$status\"; done"
    ]
}
JSON
      command_id="$(aws_cli ssm send-command \
        --region "$AWS_REGION" \
        --instance-ids "$instance_id" \
        --document-name AWS-RunShellScript \
        --comment "Aura staging verify Docker status" \
        --parameters "$(aws_file_uri "$ssm_params")" \
        --query 'Command.CommandId' \
        --output text)"
      for _ in $(seq 1 30); do
        status="$(aws_cli ssm get-command-invocation --region "$AWS_REGION" --command-id "$command_id" --instance-id "$instance_id" --query 'Status' --output text 2>/dev/null || true)"
        case "$status" in
          Success)
            docker_status="$(aws_cli ssm get-command-invocation --region "$AWS_REGION" --command-id "$command_id" --instance-id "$instance_id" --query 'StandardOutputContent' --output text 2>/dev/null || true)"
            break
            ;;
          Failed|Cancelled|TimedOut|Cancelling)
            docker_status="ssm_docker_status_failed"
            break
            ;;
        esac
        sleep 5
      done
    else
      docker_status="not_checked_ssh_unavailable_ssm_${ssm_status:-unknown}"
    fi
  fi
fi

github_vars_configured="unknown"
if command -v gh >/dev/null 2>&1 && [ -n "${GH_REPO:-}" ]; then
  if gh variable list --repo "$GH_REPO" --env staging >/tmp/aura-gh-vars.txt 2>/dev/null; then
    github_vars_configured="yes"
  else
    github_vars_configured="no"
  fi
fi

vercel_vars_configured="unknown"
if command -v vercel >/dev/null 2>&1 && [ -d "$REPO_ROOT/${VERCEL_PROJECT_DIR:-.}" ]; then
  if (cd "$REPO_ROOT/${VERCEL_PROJECT_DIR:-.}" && vercel env ls "$VERCEL_TARGET" >/tmp/aura-vercel-vars.txt 2>/dev/null); then
    vercel_vars_configured="yes"
  else
    vercel_vars_configured="no"
  fi
fi

report="$REPO_ROOT/docs/staging-live-verification.md"
cat > "$report" <<REPORT
# Staging Live Verification

Final status: Code is staging-safe, and live staging infrastructure is present.

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

| Check | Value |
| --- | --- |
| EC2 instance id | $(state_get instance_id) |
| EC2 public DNS | $(state_get public_dns) |
| Staging API base URL | $STAGING_API_BASE_URL |
| Staging health URL | $STAGING_HEALTH_URL |
| Frontend staging URL | ${staging_frontend_url:-not configured} |
| Frontend staging mode | $frontend_mode |
| Frontend staging smoke | $frontend_smoke |
| S3 bucket | $STAGING_BUCKET_NAME |
| SSM prefix | /aura/staging |
| GitHub staging vars configured | $github_vars_configured |
| Vercel vars configured | $vercel_vars_configured |
| Route smoke | PASS |

Docker Compose status:

\`\`\`text
$docker_status
\`\`\`
REPORT

log "Wrote $report"
log "SUCCESS: Code is staging-safe, and live staging infrastructure is present."
