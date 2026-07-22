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

source_key="${STAGING_RESTORE_SOURCE_KEY:-$(state_get last_backup_s3_key)}"
source_version_id="${STAGING_RESTORE_SOURCE_VERSION_ID:-$(state_get last_backup_s3_version_id)}"
source_sha="${STAGING_RESTORE_SOURCE_SHA:-$(state_get last_backup_source_sha)}"
[[ "$source_key" =~ ^backups/[0-9]{8}-[0-9]{6}/aura-staging-backup\.tar\.gz$ ]] \
  || die "STAGING_RESTORE_SOURCE_KEY must be an Aura staging backup key"
[[ "$source_version_id" =~ ^[A-Za-z0-9._~-]+$ ]] \
  || die "STAGING_RESTORE_SOURCE_VERSION_ID must be a shell-safe S3 version ID"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] \
  || die "STAGING_RESTORE_SOURCE_SHA must be a full lowercase commit SHA"

drill_id="$(date -u +"%Y%m%d-%H%M%S")"
remote_restore_root="/opt/aura-staging/restore-drill-$drill_id"
remote_job="/tmp/aura-staging-restore-drill-$drill_id.sh"
remote_log="/tmp/aura-staging-restore-drill-$drill_id.log"
runner_file="$STATE_DIR/restore-runner-$drill_id.sh"

cat > "$runner_file" <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail

restore_root="$REMOTE_RESTORE_ROOT"
archive="$restore_root/aura-staging-backup.tar.gz"
data_dir="$restore_root/data"
mongo_container="aura-staging-restore-mongo-$DRILL_ID"
postgres_container="aura-staging-restore-postgres-$DRILL_ID"
redis_container="aura-staging-restore-redis-$DRILL_ID"
mongo_volume="aura-staging-restore-mongo-$DRILL_ID"
postgres_volume="aura-staging-restore-postgres-$DRILL_ID"
redis_volume="aura-staging-restore-redis-$DRILL_ID"

cleanup_restore_drill() {
  local status=$?
  trap - EXIT
  sudo docker rm -f "$mongo_container" "$postgres_container" "$redis_container" >/dev/null 2>&1 || true
  sudo docker volume rm -f "$mongo_volume" "$postgres_volume" "$redis_volume" >/dev/null 2>&1 || true
  sudo rm -rf -- "$restore_root"
  exit "$status"
}
trap cleanup_restore_drill EXIT

wait_for_container_command() {
  local container="$1"
  shift
  for _ in $(seq 1 60); do
    if sudo docker exec "$container" "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

sudo rm -rf -- "$restore_root"
sudo mkdir -p "$data_dir"
sudo chown -R "$(id -u):$(id -g)" "$restore_root"

aws s3api get-object \
  --region "$AWS_REGION" \
  --bucket "$STAGING_BUCKET_NAME" \
  --key "$SOURCE_KEY" \
  --version-id "$SOURCE_VERSION_ID" \
  "$archive" >/dev/null

if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Backup archive contains an unsafe path" >&2
  exit 1
fi
tar -xzf "$archive" -C "$data_dir"

for required in manifest.json checksums.sha256 mongo.archive.gz mongo-stats.json postgres.dump postgres-stats.tsv redis.rdb; do
  test -s "$data_dir/$required" || { echo "Backup archive is missing $required" >&2; exit 1; }
done
grep -Fq '"environment":"staging"' "$data_dir/manifest.json"
grep -Fq '"formatVersion":2' "$data_dir/manifest.json"
grep -Fq '"consistencyMode":"application-quiesced-logical"' "$data_dir/manifest.json"
grep -Fq "\"sourceSha\":\"$SOURCE_SHA\"" "$data_dir/manifest.json"
(cd "$data_dir" && sha256sum --check checksums.sha256 >/dev/null)

sudo docker volume create "$mongo_volume" >/dev/null
sudo docker run -d \
  --name "$mongo_container" \
  --network none \
  -v "$mongo_volume:/data/db" \
  -v "$data_dir:/backup:ro" \
  mongo:7 mongod --bind_ip_all >/dev/null
wait_for_container_command "$mongo_container" mongosh --quiet --eval 'quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)'
sudo docker exec "$mongo_container" mongorestore --quiet --drop --archive=/backup/mongo.archive.gz --gzip
sudo docker exec "$mongo_container" mongosh --quiet --eval '
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
' > "$restore_root/mongo-stats-restored.json"
cmp --silent "$data_dir/mongo-stats.json" "$restore_root/mongo-stats-restored.json" \
  || { echo "Mongo restore counts or indexes do not match the backup manifest" >&2; exit 1; }

postgres_password="$(openssl rand -hex 24)"
sudo docker volume create "$postgres_volume" >/dev/null
sudo docker run -d \
  --name "$postgres_container" \
  --network none \
  -e POSTGRES_PASSWORD="$postgres_password" \
  -e POSTGRES_DB=aura_restore \
  -v "$postgres_volume:/var/lib/postgresql/data" \
  -v "$data_dir:/backup:ro" \
  postgres:16-alpine >/dev/null
wait_for_container_command "$postgres_container" pg_isready --username postgres --dbname aura_restore
sudo docker exec -e PGPASSWORD="$postgres_password" "$postgres_container" \
  pg_restore --exit-on-error --no-owner --no-acl --username=postgres --dbname=aura_restore /backup/postgres.dump
sudo docker exec -e PGPASSWORD="$postgres_password" "$postgres_container" sh -ec '
{
  psql --username=postgres --dbname=aura_restore --no-align --tuples-only --command="SELECT format('"'"'SELECT %L, count(*) FROM %I.%I;'"'"', schemaname || '"'"'.'"'"' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname NOT IN ('"'"'pg_catalog'"'"', '"'"'information_schema'"'"') ORDER BY schemaname, tablename" | psql --username=postgres --dbname=aura_restore --no-align --tuples-only
  psql --username=postgres --dbname=aura_restore --no-align --tuples-only --command="SELECT '"'"'__INDEXES__'"'"', count(*) FROM pg_indexes WHERE schemaname NOT IN ('"'"'pg_catalog'"'"', '"'"'information_schema'"'"')"
} | LC_ALL=C sort
' > "$restore_root/postgres-stats-restored.tsv"
cmp --silent "$data_dir/postgres-stats.tsv" "$restore_root/postgres-stats-restored.tsv" \
  || { echo "Postgres restore counts or indexes do not match the backup manifest" >&2; exit 1; }

sudo docker run --rm --network none -v "$data_dir:/backup:ro" redis:7-alpine \
  redis-check-rdb /backup/redis.rdb >/dev/null
sudo docker volume create "$redis_volume" >/dev/null
sudo docker run --rm --network none \
  -v "$redis_volume:/data" \
  -v "$data_dir:/backup:ro" \
  alpine sh -ec 'cp /backup/redis.rdb /data/dump.rdb && chown 999:999 /data/dump.rdb'
sudo docker run -d \
  --name "$redis_container" \
  --network none \
  -v "$redis_volume:/data" \
  redis:7-alpine redis-server --appendonly no >/dev/null
wait_for_container_command "$redis_container" redis-cli ping
redis_keys="$(sudo docker exec "$redis_container" redis-cli --raw DBSIZE)"
[[ "$redis_keys" =~ ^[0-9]+$ ]] || { echo "Restored Redis key count is invalid" >&2; exit 1; }

echo "RESTORE_DRILL_PASS mongo_stats_match=true postgres_stats_match=true redis_snapshot_valid=true redis_keys=$redis_keys"
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

run_restore_over_ssh() {
  ssh -F "$STATE_DIR/ssh_config" aura-staging "cat > '$remote_job' && chmod 700 '$remote_job'" < "$runner_file"
  local restore_pid
  restore_pid="$(ssh -F "$STATE_DIR/ssh_config" aura-staging \
    "nohup env DRILL_ID='$drill_id' REMOTE_RESTORE_ROOT='$remote_restore_root' AWS_REGION='$AWS_REGION' STAGING_BUCKET_NAME='$STAGING_BUCKET_NAME' SOURCE_KEY='$source_key' SOURCE_VERSION_ID='$source_version_id' SOURCE_SHA='$source_sha' bash '$remote_job' > '$remote_log' 2>&1 < /dev/null & echo \$!")"
  log "Started isolated staging restore drill over SSH (pid $restore_pid)"

  for _ in $(seq 1 "${STAGING_RESTORE_WAIT_ATTEMPTS:-120}"); do
    if ! ssh -F "$STATE_DIR/ssh_config" aura-staging "kill -0 '$restore_pid' 2>/dev/null" >/dev/null 2>&1; then
      local output
      output="$(ssh -F "$STATE_DIR/ssh_config" aura-staging "tail -80 '$remote_log' 2>/dev/null || true")"
      printf '%s\n' "$output" >&2
      grep -Fq 'RESTORE_DRILL_PASS' <<<"$output"
      ssh -F "$STATE_DIR/ssh_config" aura-staging "rm -f '$remote_job' '$remote_log'" >/dev/null 2>&1 || true
      return
    fi
    sleep "${STAGING_RESTORE_WAIT_DELAY_SECONDS:-5}"
  done
  die "Timed out waiting for isolated staging restore drill"
}

run_restore_over_ssm() {
  local instance_id="$1"
  local runner_b64 params_file command_id status
  runner_b64="$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1]).toString("base64"))' "$(node_path "$runner_file")")"
  params_file="$STATE_DIR/restore-ssm-$drill_id.json"
  node -e '
const fs = require("fs");
const [out, runnerB64, remoteJob, drillId, remoteRoot, region, bucket, sourceKey, sourceVersion, sourceSha] = process.argv.slice(1);
const commands = [
  "set -euo pipefail",
  `cat > /tmp/aura-staging-restore-runner.b64 <<'\''B64'\''\n${runnerB64}\nB64`,
  `base64 -d /tmp/aura-staging-restore-runner.b64 > ${remoteJob}`,
  `chmod 700 ${remoteJob}`,
  `DRILL_ID=${drillId} REMOTE_RESTORE_ROOT=${remoteRoot} AWS_REGION=${region} STAGING_BUCKET_NAME=${bucket} SOURCE_KEY=${sourceKey} SOURCE_VERSION_ID=${sourceVersion} SOURCE_SHA=${sourceSha} bash ${remoteJob}`,
  `rm -f ${remoteJob} /tmp/aura-staging-restore-runner.b64`,
];
fs.writeFileSync(out, JSON.stringify({ commands }, null, 2));
' "$(node_path "$params_file")" "$runner_b64" "$remote_job" "$drill_id" "$remote_restore_root" "$AWS_REGION" "$STAGING_BUCKET_NAME" "$source_key" "$source_version_id" "$source_sha"

  command_id="$(aws_cli ssm send-command \
    --region "$AWS_REGION" \
    --instance-ids "$instance_id" \
    --document-name AWS-RunShellScript \
    --comment "Aura isolated staging restore drill $drill_id" \
    --parameters "$(aws_file_uri "$params_file")" \
    --query 'Command.CommandId' \
    --output text)"
  log "Started isolated staging restore drill over SSM Run Command ($command_id)"

  for _ in $(seq 1 "${STAGING_RESTORE_SSM_WAIT_ATTEMPTS:-120}"); do
    status="$(aws_cli ssm get-command-invocation \
      --region "$AWS_REGION" \
      --command-id "$command_id" \
      --instance-id "$instance_id" \
      --query 'Status' \
      --output text 2>/dev/null || true)"
    case "$status" in
      Success)
        aws_cli ssm get-command-invocation \
          --region "$AWS_REGION" \
          --command-id "$command_id" \
          --instance-id "$instance_id" \
          --query 'StandardOutputContent' \
          --output text | grep -F 'RESTORE_DRILL_PASS'
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
    sleep "${STAGING_RESTORE_SSM_WAIT_DELAY_SECONDS:-5}"
  done
  die "Timed out waiting for SSM restore command $command_id"
}

transport="${STAGING_RESTORE_TRANSPORT:-auto}"
instance_id="$(state_get instance_id)"
case "$transport" in
  ssh)
    ssh_ready || die "SSH is not reachable for staging restore drill"
    run_restore_over_ssh
    ;;
  ssm)
    ssm_ready "$instance_id" || die "SSM is not online for staging instance $instance_id"
    run_restore_over_ssm "$instance_id"
    ;;
  auto)
    if ssh_ready; then
      run_restore_over_ssh
    elif ssm_ready "$instance_id"; then
      warn "SSH is unavailable; using SSM Run Command for isolated restore drill"
      run_restore_over_ssm "$instance_id"
    else
      die "Neither SSH nor SSM is available for staging restore drill"
    fi
    ;;
  *)
    die "Unsupported STAGING_RESTORE_TRANSPORT=$transport; use auto, ssh, or ssm"
    ;;
esac

rm -f "$runner_file"
state_set last_restore_drill_s3_key "$source_key"
state_set last_restore_drill_s3_version_id "$source_version_id"
state_set last_restore_drill_source_sha "$source_sha"
state_set last_restore_drill_status pass
state_set last_restore_drill_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
log "Isolated staging restore drill passed for versioned backup $source_key"
