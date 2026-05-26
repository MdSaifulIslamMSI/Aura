#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

[ "${CONFIRM_DESTROY_STAGING:-false}" = "true" ] || die "Set CONFIRM_DESTROY_STAGING=true to destroy staging resources"
[ "$STAGING_SSM_PREFIX" = "/aura/staging" ] || die "Refusing teardown because STAGING_SSM_PREFIX is not /aura/staging"
need_env AWS_REGION
ensure_state

instance_ids="$(aws_cli ec2 describe-instances --region "$AWS_REGION" \
  --filters \
    "Name=tag:Environment,Values=staging" \
    "Name=tag:ManagedBy,Values=codex-staging-bootstrap" \
    "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' \
  --output text)"

if [ -n "$instance_ids" ]; then
  log "Terminating staging EC2 instances: $instance_ids"
  aws_cli ec2 terminate-instances --region "$AWS_REGION" --instance-ids $instance_ids >/dev/null
  aws_cli ec2 wait instance-terminated --region "$AWS_REGION" --instance-ids $instance_ids
fi

sg_id="$(state_get security_group_id)"
if [ -n "$sg_id" ]; then
  env_tag="$(aws_cli ec2 describe-tags --region "$AWS_REGION" --filters "Name=resource-id,Values=$sg_id" "Name=key,Values=Environment" --query 'Tags[0].Value' --output text 2>/dev/null || true)"
  managed_tag="$(aws_cli ec2 describe-tags --region "$AWS_REGION" --filters "Name=resource-id,Values=$sg_id" "Name=key,Values=ManagedBy" --query 'Tags[0].Value' --output text 2>/dev/null || true)"
  assert_staging_tags "$sg_id" "$env_tag" "$managed_tag"
  aws_cli ec2 delete-security-group --region "$AWS_REGION" --group-id "$sg_id" >/dev/null || warn "Security group $sg_id is still in use or already deleted"
fi

if [ "${DELETE_STAGING_BUCKET:-false}" = "true" ]; then
  need_env STAGING_BUCKET_NAME
  require_no_prod_value "STAGING_BUCKET_NAME" "$STAGING_BUCKET_NAME" ""
  log "Emptying and deleting staging bucket $STAGING_BUCKET_NAME"
  aws_cli s3 rm "s3://$STAGING_BUCKET_NAME" --recursive >/dev/null || true
  aws_cli s3api delete-bucket --bucket "$STAGING_BUCKET_NAME" --region "$AWS_REGION" >/dev/null || warn "Bucket delete failed"
fi

if [ "${DELETE_STAGING_SSM:-false}" = "true" ]; then
  log "Deleting SSM parameters under /aura/staging"
  names="$(aws_cli ssm get-parameters-by-path --region "$AWS_REGION" --path /aura/staging --recursive --query 'Parameters[].Name' --output text)"
  if [ -n "$names" ]; then
    aws_cli ssm delete-parameters --region "$AWS_REGION" --names $names >/dev/null
  fi
fi

log "Staging teardown completed"
