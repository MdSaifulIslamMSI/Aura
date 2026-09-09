#!/usr/bin/env bash
# Production Mongo restore. Runs ON the backend EC2 host (dispatched via SSM
# or SSH) and complements scripts/production/backup-production-mongo.sh.
#
# Two modes:
#   RESTORE_DRILL=true   - verifies the archive and restores it into a
#                          disposable network-isolated mongo:7 container, then
#                          prints restored collection/index stats and cleans
#                          up. Use this for the periodic restore drill; it
#                          never touches a live database.
#   RESTORE_DRILL unset  - restores into the URI in AURA_RESTORE_URI with
#                          --drop. DESTRUCTIVE: also requires
#                          AURA_RESTORE_CONFIRM=YES.
#
# Required env: AURA_BACKUP_BUCKET, AWS_REGION, RESTORE_S3_KEY
# (production/mongo/<backup-id>/mongo.archive.gz).
set -euo pipefail

[ -n "${AURA_BACKUP_BUCKET:-}" ] || { echo "AURA_BACKUP_BUCKET is required"; exit 1; }
[ -n "${AWS_REGION:-}" ] || { echo "AWS_REGION is required"; exit 1; }
[ -n "${RESTORE_S3_KEY:-}" ] || { echo "RESTORE_S3_KEY is required (e.g. production/mongo/<backup-id>/mongo.archive.gz)"; exit 1; }
case "${RESTORE_S3_KEY}" in
  production/mongo/*/mongo.archive.gz) ;;
  *) echo "RESTORE_S3_KEY must match production/mongo/<backup-id>/mongo.archive.gz"; exit 1 ;;
esac

WORK_DIR="/opt/aura/restore-work/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

BASE_KEY="${RESTORE_S3_KEY%/mongo.archive.gz}"
aws s3 cp "s3://${AURA_BACKUP_BUCKET}/${BASE_KEY}/mongo.archive.gz" "$WORK_DIR/mongo.archive.gz" \
  --region "$AWS_REGION" --only-show-errors
aws s3 cp "s3://${AURA_BACKUP_BUCKET}/${BASE_KEY}/checksums.sha256" "$WORK_DIR/checksums.sha256" \
  --region "$AWS_REGION" --only-show-errors
aws s3 cp "s3://${AURA_BACKUP_BUCKET}/${BASE_KEY}/manifest.json" "$WORK_DIR/manifest.json" \
  --region "$AWS_REGION" --only-show-errors

(cd "$WORK_DIR" && sha256sum --check checksums.sha256)
grep -Fq '"environment":"production"' "$WORK_DIR/manifest.json"
echo "Archive integrity verified for ${RESTORE_S3_KEY}"

if [ "${RESTORE_DRILL:-false}" = "true" ]; then
  DRILL_ID="$(basename "$BASE_KEY")"
  DRILL_CONTAINER="aura-prod-restore-drill-${DRILL_ID}"
  cleanup_drill() {
    local status=$?
    trap - EXIT
    docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$WORK_DIR"
    exit "$status"
  }
  trap cleanup_drill EXIT

  docker run -d --name "$DRILL_CONTAINER" --network none \
    -v "$WORK_DIR:/backup:ro" mongo:7 >/dev/null
  for _ in $(seq 1 60); do
    if docker exec "$DRILL_CONTAINER" mongosh --quiet --eval 'quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)' >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  RESTORE_URI='mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=30000'
  docker exec "$DRILL_CONTAINER" mongorestore --uri="$RESTORE_URI" --quiet --drop \
    --archive=/backup/mongo.archive.gz --gzip
  docker exec "$DRILL_CONTAINER" mongosh "$RESTORE_URI" --quiet --eval '
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
' > "$WORK_DIR/mongo-stats-restored.json"
  # The host has no node.js (the app runs in containers); count with grep.
  COLLECTION_COUNT="$(grep -o '"collection"' "$WORK_DIR/mongo-stats-restored.json" | wc -l)"
  test "${COLLECTION_COUNT}" -gt 0 || { echo "Restore drill produced no restored-collection stats"; cat "$WORK_DIR/mongo-stats-restored.json"; exit 1; }
  echo "Restored stats: $(cat "$WORK_DIR/mongo-stats-restored.json")"
  echo "RESTORE_DRILL_PASS restored_collections=${COLLECTION_COUNT}"
  exit 0
fi

[ -n "${AURA_RESTORE_URI:-}" ] || { echo "AURA_RESTORE_URI is required for a live restore"; exit 1; }
[ "${AURA_RESTORE_CONFIRM:-}" = "YES" ] || {
  echo "Live restore drops all data in AURA_RESTORE_URI. Re-run with AURA_RESTORE_CONFIRM=YES to proceed."
  exit 1
}

if ! command -v mongorestore >/dev/null 2>&1; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64) tools_arch="x86_64" ;;
    aarch64) tools_arch="aarch64" ;;
    *) echo "Unsupported architecture: $arch"; exit 1 ;;
  esac
  tools_rpm="/tmp/mongodb-database-tools.rpm"
  curl -fsSL "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-amazon2023-${tools_arch}-100.11.0.rpm" -o "$tools_rpm"
  sudo dnf install -y "$tools_rpm" >/dev/null
fi

mongorestore --uri "$AURA_RESTORE_URI" --drop --archive="$WORK_DIR/mongo.archive.gz" --gzip
echo "RESTORE_COMPLETE target=${AURA_RESTORE_URI} source=${RESTORE_S3_KEY}"
