#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_env AWS_REGION
need_env STAGING_BUCKET_NAME
require_no_prod_value "STAGING_BUCKET_NAME" "$STAGING_BUCKET_NAME" ""
ensure_state

if aws_cli s3api head-bucket --bucket "$STAGING_BUCKET_NAME" >/dev/null 2>&1; then
  log "Reusing existing S3 bucket $STAGING_BUCKET_NAME"
else
  log "Creating S3 bucket $STAGING_BUCKET_NAME"
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws_cli s3api create-bucket --bucket "$STAGING_BUCKET_NAME" --region "$AWS_REGION" >/dev/null
  else
    aws_cli s3api create-bucket \
      --bucket "$STAGING_BUCKET_NAME" \
      --region "$AWS_REGION" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
fi

aws_cli s3api put-public-access-block --bucket "$STAGING_BUCKET_NAME" --public-access-block-configuration '{
  "BlockPublicAcls": true,
  "IgnorePublicAcls": true,
  "BlockPublicPolicy": true,
  "RestrictPublicBuckets": true
}' >/dev/null

aws_cli s3api put-bucket-encryption --bucket "$STAGING_BUCKET_NAME" --server-side-encryption-configuration '{
  "Rules": [
    {
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }
  ]
}' >/dev/null

aws_cli s3api put-bucket-versioning --bucket "$STAGING_BUCKET_NAME" --versioning-configuration Status=Suspended >/dev/null

lifecycle_file="$STATE_DIR/s3-lifecycle.json"
cat > "$lifecycle_file" <<'JSON'
{
  "Rules": [
    {
      "ID": "expire-staging-uploads",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "uploads/"
      },
      "Expiration": {
        "Days": 14
      },
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 1
      }
    }
  ]
}
JSON
aws_cli s3api put-bucket-lifecycle-configuration --bucket "$STAGING_BUCKET_NAME" --lifecycle-configuration "$(aws_file_uri "$lifecycle_file")" >/dev/null

aws_cli s3api put-bucket-tagging --bucket "$STAGING_BUCKET_NAME" --tagging "TagSet=[{Key=Project,Value=$PROJECT_NAME},{Key=Environment,Value=staging},{Key=ManagedBy,Value=codex-staging-bootstrap}]" >/dev/null

state_set bucket "$STAGING_BUCKET_NAME"
log "S3 bucket is private and lifecycle-managed: $STAGING_BUCKET_NAME"
