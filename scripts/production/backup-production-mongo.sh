#!/usr/bin/env bash
# Production Mongo logical backup. Runs ON the backend EC2 host via SSM
# (dispatched by .github/workflows/production-db-backup.yml) - mongodump is a
# host-level tool and the database is not part of the api compose stack.
# Hot logical per-collection dump uploaded to S3 with checksums and a
# manifest. No --oplog: the database is an Atlas shared-tier cluster, which
# does not expose the oplog (mongodump --oplog exits 1 with no error output
# there). Restore with `mongorestore --archive --gzip`.
set -euo pipefail

BACKUP_ID="$(date -u +%Y%m%d-%H%M%S)"
WORK_DIR="/opt/aura/backup-work/${BACKUP_ID}"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

MONGO_URI=""
for env_file in /opt/aura/shared/runtime-secrets.env /opt/aura/shared/base.env; do
  if [ -z "$MONGO_URI" ] && grep -q '^MONGO_URI=' "$env_file" 2>/dev/null; then
    MONGO_URI="$(grep '^MONGO_URI=' "$env_file" | head -1 | cut -d= -f2-)"
  fi
done
[ -n "$MONGO_URI" ] || { echo "MONGO_URI not found in /opt/aura/shared/*.env"; exit 1; }
[ -n "${AURA_BACKUP_BUCKET:-}" ] || { echo "AURA_BACKUP_BUCKET is required"; exit 1; }
[ -n "${AWS_REGION:-}" ] || { echo "AWS_REGION is required"; exit 1; }

if ! command -v mongodump >/dev/null 2>&1; then
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

mongodump --uri "$MONGO_URI" --archive --gzip --quiet > "$WORK_DIR/mongo.archive.gz"
test -s "$WORK_DIR/mongo.archive.gz"

(cd "$WORK_DIR" && sha256sum mongo.archive.gz > checksums.sha256)
printf '{"formatVersion":1,"createdAt":"%s","environment":"production","consistencyMode":"hot-logical-per-collection","restoreRequires":"mongorestore --archive --gzip","upload":"ec2-direct-s3"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$WORK_DIR/manifest.json"

# --sse aws: S3-managed encryption (SSE-S3) so archives are never at rest
# unencrypted even if bucket default encryption is misconfigured.
aws s3 cp "$WORK_DIR/mongo.archive.gz" "s3://${AURA_BACKUP_BUCKET}/production/mongo/${BACKUP_ID}/mongo.archive.gz" \
  --region "$AWS_REGION" --sse aws --metadata "environment=production,backup-id=${BACKUP_ID}" --only-show-errors
aws s3 cp "$WORK_DIR/checksums.sha256" "s3://${AURA_BACKUP_BUCKET}/production/mongo/${BACKUP_ID}/checksums.sha256" --sse aws --only-show-errors
aws s3 cp "$WORK_DIR/manifest.json" "s3://${AURA_BACKUP_BUCKET}/production/mongo/${BACKUP_ID}/manifest.json" --sse aws --only-show-errors

echo "BACKUP_S3_KEY=production/mongo/${BACKUP_ID}/mongo.archive.gz"
