#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_env AWS_REGION
need_env STAGING_KEY_NAME
ensure_state

sg_id="$(state_get security_group_id)"
[ -n "$sg_id" ] || die "Missing security_group_id in $STATE_FILE. Run 04-create-security-group.sh first."
instance_profile_name="${STAGING_INSTANCE_PROFILE_NAME:-$(state_get instance_profile_name)}"
[ -n "$instance_profile_name" ] || die "Missing STAGING_INSTANCE_PROFILE_NAME. Run 00-create-iam-auth.sh or provide an existing staging EC2 instance profile."
key_file="$STATE_DIR/$STAGING_KEY_NAME.pem"

if ! aws_cli ec2 describe-key-pairs --region "$AWS_REGION" --key-names "$STAGING_KEY_NAME" >/dev/null 2>&1; then
  log "Creating staging EC2 key pair $STAGING_KEY_NAME"
  aws_cli ec2 create-key-pair \
    --region "$AWS_REGION" \
    --key-name "$STAGING_KEY_NAME" \
    --key-type rsa \
    --key-format pem \
    --tag-specifications "ResourceType=key-pair,Tags=[{Key=Project,Value=$PROJECT_NAME},{Key=Environment,Value=staging},{Key=ManagedBy,Value=codex-staging-bootstrap}]" \
    --query 'KeyMaterial' \
    --output text > "$key_file"
  chmod 600 "$key_file"
  state_set ssh_key_file "$key_file"
elif [ -f "$key_file" ]; then
  chmod 600 "$key_file"
  state_set ssh_key_file "$key_file"
else
  die "EC2 key pair $STAGING_KEY_NAME already exists, but $key_file is missing. Provide the matching private key or use a different STAGING_KEY_NAME."
fi

instance_id="$(aws_cli ec2 describe-instances --region "$AWS_REGION" \
  --filters \
    "Name=tag:Project,Values=$PROJECT_NAME" \
    "Name=tag:Environment,Values=staging" \
    "Name=tag:ManagedBy,Values=codex-staging-bootstrap" \
    "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[0].InstanceId' \
  --output text | awk '{print $1}')"

if [ -n "$instance_id" ] && [ "$instance_id" != "None" ]; then
  state="$(aws_cli ec2 describe-instances --region "$AWS_REGION" --instance-ids "$instance_id" --query 'Reservations[0].Instances[0].State.Name' --output text)"
  log "Reusing EC2 instance $instance_id ($state)"
  if [ "$state" = "stopped" ]; then
    aws_cli ec2 start-instances --region "$AWS_REGION" --instance-ids "$instance_id" >/dev/null
  fi
else
  ami_id="${STAGING_AMI_ID:-}"
  if [ -z "$ami_id" ]; then
    ami_id="$(aws_cli ssm get-parameter \
      --region "$AWS_REGION" \
      --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
      --query 'Parameter.Value' \
      --output text)"
  fi
  [ -n "$ami_id" ] || die "Could not resolve an AMI. Set STAGING_AMI_ID."

  user_data="$REPO_ROOT/infra/staging/cloud-init/user-data.sh"
  [ -f "$user_data" ] || die "Missing cloud-init user data: $user_data"

  instance_id="$(aws_cli ec2 run-instances \
    --region "$AWS_REGION" \
    --image-id "$ami_id" \
    --instance-type "$STAGING_INSTANCE_TYPE" \
    --key-name "$STAGING_KEY_NAME" \
    --security-group-ids "$sg_id" \
    --iam-instance-profile "Name=$instance_profile_name" \
    --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=2" \
    --user-data "$(aws_file_uri "$user_data")" \
    --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=$STAGING_ROOT_VOLUME_GB,VolumeType=gp3,DeleteOnTermination=true}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$PROJECT_NAME-$STAGING_NAME},{Key=Project,Value=$PROJECT_NAME},{Key=Environment,Value=staging},{Key=ManagedBy,Value=codex-staging-bootstrap}]" \
    --query 'Instances[0].InstanceId' \
    --output text)"
  log "Launched EC2 instance $instance_id"
fi

aws_cli ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$instance_id"
aws_cli ec2 wait instance-status-ok --region "$AWS_REGION" --instance-ids "$instance_id"

public_dns="$(aws_cli ec2 describe-instances --region "$AWS_REGION" --instance-ids "$instance_id" --query 'Reservations[0].Instances[0].PublicDnsName' --output text)"
public_ip="$(aws_cli ec2 describe-instances --region "$AWS_REGION" --instance-ids "$instance_id" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
[ -n "$public_dns" ] && [ "$public_dns" != "None" ] || die "EC2 instance has no public DNS"

if [ -n "${STAGING_API_HOST:-}" ] && [ "$ENABLE_CERTBOT" = "true" ]; then
  derived_api_url="https://$STAGING_API_HOST"
elif [ -n "${STAGING_API_HOST:-}" ]; then
  derived_api_url="http://$STAGING_API_HOST"
else
  derived_api_url="http://$public_dns"
fi

state_set instance_id "$instance_id"
state_set instance_profile_name "$instance_profile_name"
state_set public_dns "$public_dns"
state_set public_ip "$public_ip"
state_set staging_api_base_url "${STAGING_API_BASE_URL:-$derived_api_url}"
state_set staging_health_url "${STAGING_HEALTH_URL:-${STAGING_API_BASE_URL:-$derived_api_url}/health}"
state_set staging_base_url "${STAGING_BASE_URL:-${STAGING_API_BASE_URL:-$derived_api_url}}"

log "EC2 ready: $instance_id ($public_dns)"
log "Derived staging API URL: $(state_get staging_api_base_url)"
