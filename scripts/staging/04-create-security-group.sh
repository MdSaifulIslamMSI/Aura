#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_env AWS_REGION
need_env STAGING_ALLOWED_SSH_CIDR
ensure_state

vpc_id="$(aws_cli ec2 describe-vpcs --region "$AWS_REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
[ -n "$vpc_id" ] && [ "$vpc_id" != "None" ] || die "No default VPC found in $AWS_REGION"

sg_name="${PROJECT_NAME}-${STAGING_NAME}-sg"
sg_id="$(aws_cli ec2 describe-security-groups --region "$AWS_REGION" --filters "Name=group-name,Values=$sg_name" "Name=vpc-id,Values=$vpc_id" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"

if [ -z "$sg_id" ] || [ "$sg_id" = "None" ]; then
  sg_id="$(aws_cli ec2 create-security-group \
    --region "$AWS_REGION" \
    --group-name "$sg_name" \
    --description "Free-tier staging SG for isolated staging backend" \
    --vpc-id "$vpc_id" \
    --query GroupId \
    --output text)"
  aws_cli ec2 create-tags --region "$AWS_REGION" --resources "$sg_id" --tags \
    "Key=Name,Value=$sg_name" \
    "Key=Project,Value=$PROJECT_NAME" \
    "Key=Environment,Value=staging" \
    "Key=ManagedBy,Value=codex-staging-bootstrap" >/dev/null
  log "Created security group $sg_id"
else
  log "Reusing security group $sg_id"
fi

authorize_ingress() {
  local port="$1"
  local cidr="$2"
  if ! aws_cli ec2 authorize-security-group-ingress \
    --region "$AWS_REGION" \
    --group-id "$sg_id" \
    --protocol tcp \
    --port "$port" \
    --cidr "$cidr" >/tmp/aura-sg.log 2>&1; then
    if ! grep -q InvalidPermission.Duplicate /tmp/aura-sg.log; then
      cat /tmp/aura-sg.log >&2
      die "Could not authorize ingress $port from $cidr"
    fi
  fi
}

authorize_ingress 22 "$STAGING_ALLOWED_SSH_CIDR"
authorize_ingress 80 "0.0.0.0/0"
authorize_ingress 443 "0.0.0.0/0"

existing_ssh_cidrs="$(aws_cli ec2 describe-security-groups \
  --region "$AWS_REGION" \
  --group-ids "$sg_id" \
  --query 'SecurityGroups[0].IpPermissions[?IpProtocol==`tcp` && FromPort==`22` && ToPort==`22`].IpRanges[].CidrIp' \
  --output text)"
for cidr in $existing_ssh_cidrs; do
  if [ "$cidr" != "$STAGING_ALLOWED_SSH_CIDR" ]; then
    aws_cli ec2 revoke-security-group-ingress \
      --region "$AWS_REGION" \
      --group-id "$sg_id" \
      --protocol tcp \
      --port 22 \
      --cidr "$cidr" >/dev/null || true
    log "Revoked stale SSH ingress from $cidr"
  fi
done

state_set vpc_id "$vpc_id"
state_set security_group_id "$sg_id"
log "Security group allows SSH only from $STAGING_ALLOWED_SSH_CIDR and web traffic on 80/443"
