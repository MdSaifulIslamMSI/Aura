#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

assert_staging_prefix
need_env AWS_REGION
need_env STAGING_BUCKET_NAME
ensure_state

assert_staging_bucket_safe "$STAGING_BUCKET_NAME"

backup_id="$(date -u +"%Y%m%d-%H%M%S")"
remote_archive="/tmp/aura-staging-backup-$backup_id.tar.gz"
remote_job="/tmp/aura-staging-backup-$backup_id.sh"
remote_log="/tmp/aura-staging-backup-$backup_id.log"
s3_key="backups/$backup_id/aura-staging-backup.tar.gz"
runner_file="$STATE_DIR/backup-runner-$backup_id.sh"

cat > "$runner_file" <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail
backup_dir="/tmp/aura-staging-backup-${BACKUP_ID}"
compose_dir="/opt/aura-staging/src/infra/staging"
echo "Creating remote staging backup archive with Docker volume snapshots" >&2
sudo rm -rf "$backup_dir"
sudo mkdir -p "$backup_dir"
sudo chown "$(id -u):$(id -g)" "$backup_dir"
cd "$compose_dir"

sudo docker compose ps --format json > "$backup_dir/compose.json" || true

dump_volume() {
  local suffix="$1"
  local output="$2"
  local volume
  volume="$(sudo docker volume ls --format '{{.Name}}' | awk "/${suffix}$/ {print; exit}")"
  if [ -n "$volume" ]; then
    sudo docker run --rm -v "$volume:/volume:ro" -v "$backup_dir:/backup" alpine \
      tar -czf "/backup/$output" -C /volume .
  fi
}

dump_volume "postgres-data" "postgres-volume.tar.gz"
dump_volume "mongo-data" "mongo-volume.tar.gz"
dump_volume "redis-data" "redis-volume.tar.gz"

printf '{"createdAt":"%s","environment":"staging","ssmPrefix":"/aura/staging","upload":"ec2-direct-s3"}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$backup_dir/manifest.json"
tar -czf "$REMOTE_ARCHIVE" -C "$backup_dir" .
ls -lh "$REMOTE_ARCHIVE" >&2
rm -rf "$backup_dir"
aws s3 cp "$REMOTE_ARCHIVE" "s3://${STAGING_BUCKET_NAME}/${S3_KEY}" \
  --region "$AWS_REGION" \
  --metadata "environment=staging,managed-by=codex-staging-bootstrap" \
  --only-show-errors
rm -f "$REMOTE_ARCHIVE"
RUNNER
chmod 700 "$runner_file"

ssh_ready() {
  [ -f "$STATE_DIR/ssh_config" ] || return 1
  ssh -F "$STATE_DIR/ssh_config" -o BatchMode=yes -o ConnectTimeout=5 aura-staging true >/dev/null 2>&1
}

ssm_ready() {
  local instance_id="$1"
  [ -n "$instance_id" ] || return 1
  local status
  status="$(aws_cli ssm describe-instance-information \
    --region "$AWS_REGION" \
    --filters "Key=InstanceIds,Values=$instance_id" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text 2>/dev/null || true)"
  [ "$status" = "Online" ]
}

run_backup_over_ssh() {
  ssh -F "$STATE_DIR/ssh_config" aura-staging "cat > '$remote_job' && chmod 700 '$remote_job'" < "$runner_file"
  local backup_pid
  backup_pid="$(ssh -F "$STATE_DIR/ssh_config" aura-staging \
    "nohup env BACKUP_ID='$backup_id' REMOTE_ARCHIVE='$remote_archive' AWS_REGION='$AWS_REGION' STAGING_BUCKET_NAME='$STAGING_BUCKET_NAME' S3_KEY='$s3_key' bash '$remote_job' > '$remote_log' 2>&1 < /dev/null & echo \$!")"
  log "Started detached staging backup over SSH (pid $backup_pid); polling S3 for completion"

  local wait_attempts="${STAGING_BACKUP_WAIT_ATTEMPTS:-90}"
  local wait_delay="${STAGING_BACKUP_WAIT_DELAY_SECONDS:-10}"
  for attempt in $(seq 1 "$wait_attempts"); do
    if aws_cli s3api head-object --bucket "$STAGING_BUCKET_NAME" --key "$s3_key" --region "$AWS_REGION" >/dev/null 2>&1; then
      ssh -F "$STATE_DIR/ssh_config" aura-staging "rm -f '$remote_job' '$remote_archive'; tail -20 '$remote_log' 2>/dev/null || true" >&2 || true
      return 0
    fi
    if ! ssh -F "$STATE_DIR/ssh_config" aura-staging "kill -0 '$backup_pid' 2>/dev/null" >/dev/null 2>&1; then
      warn "Remote backup job exited before S3 object was visible. Recent remote log:"
      ssh -F "$STATE_DIR/ssh_config" aura-staging "tail -80 '$remote_log' 2>/dev/null || true" >&2 || true
      return 1
    fi
    if [ $((attempt % 6)) -eq 0 ]; then
      log "Backup still running after $((attempt * wait_delay)) seconds"
    fi
    sleep "$wait_delay"
  done
  return 1
}

run_backup_over_ssm() {
  local instance_id="$1"
  local runner_b64 params_file command_id status
  runner_b64="$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1]).toString("base64"))' "$(node_path "$runner_file")")"
  params_file="$STATE_DIR/backup-ssm-$backup_id.json"
  node -e '
const fs = require("fs");
const [out, runnerB64, remoteJob, backupId, remoteArchive, region, bucket, s3Key] = process.argv.slice(1);
const commands = [
  "set -euo pipefail",
  `cat > /tmp/aura-staging-backup-runner.b64 <<'\''B64'\''\n${runnerB64}\nB64`,
  `base64 -d /tmp/aura-staging-backup-runner.b64 > ${remoteJob}`,
  `chmod 700 ${remoteJob}`,
  `BACKUP_ID=${backupId} REMOTE_ARCHIVE=${remoteArchive} AWS_REGION=${region} STAGING_BUCKET_NAME=${bucket} S3_KEY=${s3Key} bash ${remoteJob}`,
  `rm -f ${remoteJob} /tmp/aura-staging-backup-runner.b64 ${remoteArchive}`,
];
fs.writeFileSync(out, JSON.stringify({ commands }, null, 2));
' "$(node_path "$params_file")" "$runner_b64" "$remote_job" "$backup_id" "$remote_archive" "$AWS_REGION" "$STAGING_BUCKET_NAME" "$s3_key"

  command_id="$(aws_cli ssm send-command \
    --region "$AWS_REGION" \
    --instance-ids "$instance_id" \
    --document-name AWS-RunShellScript \
    --comment "Aura staging Docker backup $backup_id" \
    --parameters "$(aws_file_uri "$params_file")" \
    --query 'Command.CommandId' \
    --output text)"
  log "Started staging backup over SSM Run Command ($command_id); SSH port 22 is not required"

  for _ in $(seq 1 "${STAGING_BACKUP_SSM_WAIT_ATTEMPTS:-90}"); do
    status="$(aws_cli ssm get-command-invocation \
      --region "$AWS_REGION" \
      --command-id "$command_id" \
      --instance-id "$instance_id" \
      --query 'Status' \
      --output text 2>/dev/null || true)"
    case "$status" in
      Success)
        aws_cli s3api head-object --bucket "$STAGING_BUCKET_NAME" --key "$s3_key" --region "$AWS_REGION" >/dev/null
        return 0
        ;;
      Failed|Cancelled|TimedOut|Cancelling)
        aws_cli ssm get-command-invocation \
          --region "$AWS_REGION" \
          --command-id "$command_id" \
          --instance-id "$instance_id" \
          --query '{Status:Status,StdOut:StandardOutputContent,StdErr:StandardErrorContent}' \
          --output json >&2 || true
        return 1
        ;;
    esac
    sleep "${STAGING_BACKUP_SSM_WAIT_DELAY_SECONDS:-10}"
  done
  die "Timed out waiting for SSM backup command $command_id"
}

transport="${STAGING_BACKUP_TRANSPORT:-auto}"
instance_id="$(state_get instance_id)"
case "$transport" in
  ssh)
    ssh_ready || die "SSH is not reachable for staging backup"
    run_backup_over_ssh
    ;;
  ssm)
    ssm_ready "$instance_id" || die "SSM is not online for staging instance $instance_id"
    run_backup_over_ssm "$instance_id"
    ;;
  auto)
    if ssh_ready; then
      run_backup_over_ssh
    elif ssm_ready "$instance_id"; then
      warn "SSH is unavailable; using SSM Run Command for Docker backup"
      run_backup_over_ssm "$instance_id"
    else
      die "Neither SSH nor SSM is available for staging instance $instance_id"
    fi
    ;;
  *)
    die "Unsupported STAGING_BACKUP_TRANSPORT=$transport; use auto, ssh, or ssm"
    ;;
esac

if ! aws_cli s3api put-object-tagging \
  --bucket "$STAGING_BUCKET_NAME" \
  --key "$s3_key" \
  --tagging "TagSet=[{Key=Project,Value=$PROJECT_NAME},{Key=Environment,Value=staging},{Key=ManagedBy,Value=codex-staging-bootstrap}]" >/dev/null; then
  warn "Backup uploaded, but object tagging was not permitted. Bucket-level staging tags remain enforced."
fi

rm -f "$runner_file"
state_set last_backup_s3_key "$s3_key"
log "Staging backup uploaded from EC2 to s3://$STAGING_BUCKET_NAME/$s3_key"
