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
# (production/mongo/<backup-id>/mongo.archive.gz[.enc]).
set -euo pipefail

[ -n "${AURA_BACKUP_BUCKET:-}" ] || { echo "AURA_BACKUP_BUCKET is required"; exit 1; }
[ -n "${AWS_REGION:-}" ] || { echo "AWS_REGION is required"; exit 1; }
[ -n "${RESTORE_S3_KEY:-}" ] || { echo "RESTORE_S3_KEY is required (e.g. production/mongo/<backup-id>/mongo.archive.gz or .gz.enc)"; exit 1; }
case "${RESTORE_S3_KEY}" in
  production/mongo/*/mongo.archive.gz) ARCHIVE_FILE="mongo.archive.gz" ;;
  production/mongo/*/mongo.archive.gz.enc) ARCHIVE_FILE="mongo.archive.gz.enc" ;;
  *) echo "RESTORE_S3_KEY must match production/mongo/<backup-id>/mongo.archive.gz[.enc]"; exit 1 ;;
esac

WORK_DIR="/opt/aura/restore-work/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

BASE_KEY="${RESTORE_S3_KEY%/$ARCHIVE_FILE}"
aws s3 cp "s3://${AURA_BACKUP_BUCKET}/${BASE_KEY}/$ARCHIVE_FILE" "$WORK_DIR/$ARCHIVE_FILE" \
  --region "$AWS_REGION" --only-show-errors
aws s3 cp "s3://${AURA_BACKUP_BUCKET}/${BASE_KEY}/checksums.sha256" "$WORK_DIR/checksums.sha256" \
  --region "$AWS_REGION" --only-show-errors
aws s3 cp "s3://${AURA_BACKUP_BUCKET}/${BASE_KEY}/manifest.json" "$WORK_DIR/manifest.json" \
  --region "$AWS_REGION" --only-show-errors

(cd "$WORK_DIR" && sha256sum --check checksums.sha256)
grep -Fq '"environment":"production"' "$WORK_DIR/manifest.json"
echo "Archive integrity verified for ${RESTORE_S3_KEY}"

# Client-side envelope decryption (backups uploaded with
# AURA_BACKUP_ENCRYPTION_KMS_KEY_ID). The data key is unwrapped ON THE HOST with
# the instance role; it exists only in memory and is never written to disk.
if [ "$ARCHIVE_FILE" = "mongo.archive.gz.enc" ]; then
  [ -n "${BACKUP_CRYPTO_JS:-}" ] && [ -f "${BACKUP_CRYPTO_JS}" ] || { echo "BACKUP_CRYPTO_JS must point to backup-archive-crypto.js to restore encrypted backups"; exit 1; }
  HEADER_JSON="$(sed -n '2p' "$WORK_DIR/mongo.archive.gz.enc")"
  WRAPPED_B64="$(printf '%s' "$HEADER_JSON" | jq -r '.wrapped // empty')"
  KDF_MODE="$(printf '%s' "$HEADER_JSON" | jq -r '.kdf.mode // empty')"

  run_restore_crypto() {
    local mode="$1" in_file="$2" out_file="$3"
    if command -v node >/dev/null 2>&1; then
      node "$BACKUP_CRYPTO_JS" "$mode" "$in_file" "$out_file"
    elif command -v docker >/dev/null 2>&1; then
      docker run --rm --network none \
        -v "$(cd "$(dirname "$BACKUP_CRYPTO_JS")" && pwd):/crypto:ro" \
        -v "$WORK_DIR:/work" \
        -e DEK_B64 -e AURA_BACKUP_ENCRYPTION_MASTER_KEY \
        node:22-alpine node "/crypto/$(basename "$BACKUP_CRYPTO_JS")" \
        "$mode" "/work/$(basename "$in_file")" "/work/$(basename "$out_file")"
    else
      echo "Restoring encrypted backups requires node or docker on the host"; exit 1
    fi
  }

  if [ -n "$WRAPPED_B64" ]; then
    printf '%s' "$WRAPPED_B64" | base64 -d > "$WORK_DIR/wrapped.bin"
    DEK_B64="$(aws kms decrypt --ciphertext-blob "fileb://$WORK_DIR/wrapped.bin" \
      --region "$AWS_REGION" --output text --query 'Plaintext')"
    rm -f "$WORK_DIR/wrapped.bin"
    export DEK_B64
  elif [ "$KDF_MODE" = "scrypt" ]; then
    [ -n "${AURA_BACKUP_ENCRYPTION_MASTER_KEY:-}" ] || { echo "This archive was encrypted in local-master mode; AURA_BACKUP_ENCRYPTION_MASTER_KEY is required"; exit 1; }
    export AURA_BACKUP_ENCRYPTION_MASTER_KEY
  else
    echo "Encrypted archive header has no key reference; refusing to restore"; exit 1
  fi

  run_restore_crypto decrypt "$WORK_DIR/mongo.archive.gz.enc" "$WORK_DIR/mongo.archive.gz"
  test -s "$WORK_DIR/mongo.archive.gz" || { echo "Decrypted archive is missing"; exit 1; }
  unset DEK_B64 WRAPPED_B64 AURA_BACKUP_ENCRYPTION_MASTER_KEY || true
fi

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
