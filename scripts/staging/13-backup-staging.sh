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
remote_backup_root="/opt/aura-staging/backup-work-$backup_id"
remote_archive="$remote_backup_root/aura-staging-backup.tar.gz"
remote_job="/tmp/aura-staging-backup-$backup_id.sh"
remote_log="/tmp/aura-staging-backup-$backup_id.log"
s3_key="backups/$backup_id/aura-staging-backup.tar.gz"
runner_file="$STATE_DIR/backup-runner-$backup_id.sh"
backup_source_sha="${STAGING_BACKUP_SOURCE_SHA:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
[[ "$backup_source_sha" =~ ^[0-9a-f]{40}$ ]] || die "STAGING_BACKUP_SOURCE_SHA must be a full lowercase commit SHA"

cat > "$runner_file" <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail
backup_root="${REMOTE_BACKUP_ROOT}"
backup_dir="$backup_root/data"
compose_dir="/opt/aura-staging/src/infra/staging"
backend_stopped=false
mongo_locked=false
unlock_mongo() {
  [ "$mongo_locked" = "true" ] || return 0
  if sudo docker compose exec -T mongo mongosh admin --quiet --eval 'const result = db.fsyncUnlock(); quit(result.ok === 1 ? 0 : 1)' >/dev/null; then
    mongo_locked=false
    return 0
  fi
  return 1
}
restart_backend() {
  [ "$backend_stopped" = "true" ] || return 0
  sudo docker compose start backend >/dev/null
  for attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${STAGING_BACKEND_PORT}/health/live" >/dev/null 2>&1; then
      backend_stopped=false
      return 0
    fi
    sleep 2
  done
  return 1
}
cleanup_backup_workspace() {
  local status=$?
  trap - EXIT
  if ! unlock_mongo; then
    echo "Failed to release Mongo fsync lock after backup" >&2
    status=1
  fi
  if ! restart_backend; then
    echo "Failed to restore staging backend after backup quiesce" >&2
    status=1
  fi
  sudo rm -rf -- "$backup_root"
  exit "$status"
}
trap cleanup_backup_workspace EXIT
echo "Creating application-quiesced logical staging backup" >&2
sudo rm -rf "$backup_root"
sudo mkdir -p "$backup_dir"
sudo chown -R "$(id -u):$(id -g)" "$backup_root"
cd "$compose_dir"

sudo docker compose ps --format json > "$backup_dir/compose.json" || true
running_sha="$(sudo docker compose exec -T backend printenv AURA_APP_BUILD_SHA 2>/dev/null || true)"
[ "$running_sha" = "$BACKUP_SOURCE_SHA" ] || {
  echo "Running staging source SHA does not match requested backup source SHA" >&2
  exit 1
}

sudo docker compose stop -t 30 backend >/dev/null
backend_stopped=true

sudo docker compose exec -T mongo mongosh admin --quiet --eval 'const result = db.adminCommand({ fsync: 1, lock: true }); quit(result.ok === 1 ? 0 : 1)' >/dev/null
mongo_locked=true
sudo docker compose exec -T mongo mongodump --archive --gzip > "$backup_dir/mongo.archive.gz"
sudo docker compose exec -T mongo mongosh --quiet --eval '
const ignored = new Set(["admin", "config", "local"]);
const out = [];
for (const info of db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.filter((entry) => !ignored.has(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
  const current = db.getSiblingDB(info.name);
  for (const name of current.getCollectionNames().sort()) {
    const collection = current.getCollection(name);
    out.push({ database: info.name, collection: name, documents: collection.countDocuments({}), indexes: collection.getIndexes().length });
  }
}
print(JSON.stringify(out));
' > "$backup_dir/mongo-stats.json"
unlock_mongo

sudo docker compose exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" "$POSTGRES_DB"' > "$backup_dir/postgres.dump"
sudo docker compose exec -T postgres sh -ec '
export PGPASSWORD="$POSTGRES_PASSWORD"
{
  psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-align --tuples-only --command="SELECT format('"'"'SELECT %L, count(*) FROM %I.%I;'"'"', schemaname || '"'"'.'"'"' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname NOT IN ('"'"'pg_catalog'"'"', '"'"'information_schema'"'"') ORDER BY schemaname, tablename" | psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-align --tuples-only
  psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-align --tuples-only --command="SELECT '"'"'__INDEXES__'"'"', count(*) FROM pg_indexes WHERE schemaname NOT IN ('"'"'pg_catalog'"'"', '"'"'information_schema'"'"')"
} | LC_ALL=C sort
' > "$backup_dir/postgres-stats.tsv"

redis_container="$(sudo docker compose ps -q redis)"
[ -n "$redis_container" ] || { echo "Redis container is not running" >&2; exit 1; }
redis_tmp="/tmp/aura-staging-backup-${BACKUP_ID}.rdb"
sudo docker exec "$redis_container" redis-cli --rdb "$redis_tmp" >/dev/null
sudo docker cp "$redis_container:$redis_tmp" "$backup_dir/redis.rdb" >/dev/null
sudo docker exec "$redis_container" rm -f "$redis_tmp"
sudo docker run --rm --network none -v "$backup_dir:/backup:ro" redis:7-alpine redis-check-rdb /backup/redis.rdb >/dev/null

test -s "$backup_dir/mongo.archive.gz"
test -s "$backup_dir/mongo-stats.json"
test -s "$backup_dir/postgres.dump"
test -s "$backup_dir/postgres-stats.tsv"
test -s "$backup_dir/redis.rdb"
(cd "$backup_dir" && sha256sum mongo.archive.gz mongo-stats.json postgres.dump postgres-stats.tsv redis.rdb > checksums.sha256)

restart_backend

printf '{"formatVersion":2,"createdAt":"%s","environment":"staging","ssmPrefix":"/aura/staging","sourceSha":"%s","consistencyMode":"application-quiesced-logical","mongoConsistency":"fsync-lock","postgresConsistency":"pg-dump-snapshot","upload":"ec2-direct-s3","redisRestorePolicy":"isolated-validation-only"}\n' \
  "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$BACKUP_SOURCE_SHA" > "$backup_dir/manifest.json"
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
    "nohup env BACKUP_ID='$backup_id' BACKUP_SOURCE_SHA='$backup_source_sha' STAGING_BACKEND_PORT='$STAGING_BACKEND_PORT' REMOTE_BACKUP_ROOT='$remote_backup_root' REMOTE_ARCHIVE='$remote_archive' AWS_REGION='$AWS_REGION' STAGING_BUCKET_NAME='$STAGING_BUCKET_NAME' S3_KEY='$s3_key' bash '$remote_job' > '$remote_log' 2>&1 < /dev/null & echo \$!")"
  log "Started detached staging backup over SSH (pid $backup_pid); polling S3 for completion"

  local wait_attempts="${STAGING_BACKUP_WAIT_ATTEMPTS:-90}"
  local wait_delay="${STAGING_BACKUP_WAIT_DELAY_SECONDS:-10}"
  for attempt in $(seq 1 "$wait_attempts"); do
    if aws_cli s3api head-object --bucket "$STAGING_BUCKET_NAME" --key "$s3_key" --region "$AWS_REGION" >/dev/null 2>&1; then
      ssh -F "$STATE_DIR/ssh_config" aura-staging "rm -f '$remote_job'; rm -rf -- '$remote_backup_root'; tail -20 '$remote_log' 2>/dev/null || true" >&2 || true
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
const [out, runnerB64, remoteJob, backupId, sourceSha, backendPort, remoteArchive, remoteBackupRoot, region, bucket, s3Key] = process.argv.slice(1);
const commands = [
  "set -euo pipefail",
  `cat > /tmp/aura-staging-backup-runner.b64 <<'\''B64'\''\n${runnerB64}\nB64`,
  `base64 -d /tmp/aura-staging-backup-runner.b64 > ${remoteJob}`,
  `chmod 700 ${remoteJob}`,
  `status=0; BACKUP_ID=${backupId} BACKUP_SOURCE_SHA=${sourceSha} STAGING_BACKEND_PORT=${backendPort} REMOTE_BACKUP_ROOT=${remoteBackupRoot} REMOTE_ARCHIVE=${remoteArchive} AWS_REGION=${region} STAGING_BUCKET_NAME=${bucket} S3_KEY=${s3Key} bash ${remoteJob} || status=$?; rm -f ${remoteJob} /tmp/aura-staging-backup-runner.b64; exit $status`,
];
fs.writeFileSync(out, JSON.stringify({ commands }, null, 2));
' "$(node_path "$params_file")" "$runner_b64" "$remote_job" "$backup_id" "$backup_source_sha" "$STAGING_BACKEND_PORT" "$remote_archive" "$remote_backup_root" "$AWS_REGION" "$STAGING_BUCKET_NAME" "$s3_key"

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
backup_version_id="$(aws_cli s3api head-object --bucket "$STAGING_BUCKET_NAME" --key "$s3_key" --region "$AWS_REGION" --query 'VersionId' --output text)"
[ -n "$backup_version_id" ] && [ "$backup_version_id" != "None" ] || die "Versioned backup object was not observed after upload"
state_set last_backup_s3_key "$s3_key"
state_set last_backup_s3_version_id "$backup_version_id"
state_set last_backup_source_sha "$backup_source_sha"
log "Versioned logical staging backup uploaded from EC2 to s3://$STAGING_BUCKET_NAME/$s3_key"
