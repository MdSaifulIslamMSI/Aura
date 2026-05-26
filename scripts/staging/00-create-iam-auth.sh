#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

need_env AWS_REGION
need_env AWS_ACCOUNT_ID
need_env STAGING_BUCKET_NAME

admin_profile="${STAGING_IAM_ADMIN_PROFILE:-${AWS_PROFILE:-default}}"
operator_role_name="${STAGING_BOOTSTRAP_ROLE_NAME:-$PROJECT_NAME-$STAGING_NAME-bootstrap-operator}"
operator_policy_name="${operator_role_name}-policy"
operator_profile_name="${STAGING_OPERATOR_PROFILE_NAME:-$PROJECT_NAME-$STAGING_NAME-bootstrap}"
instance_role_name="${STAGING_INSTANCE_ROLE_NAME:-$PROJECT_NAME-$STAGING_NAME-ec2-role}"
instance_profile_name="${STAGING_INSTANCE_PROFILE_NAME:-$PROJECT_NAME-$STAGING_NAME-ec2-profile}"
instance_policy_name="${instance_role_name}-policy"

ensure_state
require_no_prod_value "STAGING_BUCKET_NAME" "$STAGING_BUCKET_NAME" ""
[ "$STAGING_SSM_PREFIX" = "/aura/staging" ] || die "STAGING_SSM_PREFIX must be /aura/staging"

aws_admin() {
  aws --profile "$admin_profile" "$@"
}

caller_json="$(aws_admin sts get-caller-identity --output json)"
caller_arn="$(node -e 'let input=""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(input).Arn || ""));' <<< "$caller_json")"
caller_account="$(node -e 'let input=""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(input).Account || ""));' <<< "$caller_json")"
[ "$caller_account" = "$AWS_ACCOUNT_ID" ] || die "AWS account mismatch for IAM admin profile: expected $AWS_ACCOUNT_ID, got $caller_account"

source_principal="${STAGING_OPERATOR_SOURCE_ARN:-$caller_arn}"
if [[ "$source_principal" == arn:aws:sts::*:assumed-role/* ]]; then
  role_name="$(printf '%s' "$source_principal" | sed -E 's#^arn:aws:sts::[0-9]+:assumed-role/([^/]+)/.*$#\1#')"
  source_principal="arn:aws:iam::$AWS_ACCOUNT_ID:role/$role_name"
fi

operator_trust="$STATE_DIR/operator-trust-policy.json"
operator_policy="$STATE_DIR/operator-policy.json"
instance_trust="$STATE_DIR/instance-trust-policy.json"
instance_policy="$STATE_DIR/instance-policy.json"

cat > "$operator_trust" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "$source_principal"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

cat > "$operator_policy" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadBootstrapDiscovery",
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "ec2:GetConsoleOutput",
        "iam:GetInstanceProfile",
        "iam:GetRole",
        "s3:GetBucketLocation",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketTagging",
        "s3:GetEncryptionConfiguration",
        "s3:GetLifecycleConfiguration",
        "s3:ListBucket",
        "ssm:DescribeInstanceInformation",
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
        "budgets:ViewBudget"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ReadStagingCostExplorerUsage",
      "Effect": "Allow",
      "Action": "ce:GetCostAndUsage",
      "Resource": "*"
    },
    {
      "Sid": "RunStagingInstanceCommands",
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand"
      ],
      "Resource": [
        "arn:aws:ssm:$AWS_REGION::document/AWS-RunShellScript",
        "arn:aws:ec2:$AWS_REGION:$AWS_ACCOUNT_ID:instance/*"
      ],
      "Condition": {
        "StringEqualsIfExists": {
          "aws:ResourceTag/Environment": "staging",
          "ssm:resourceTag/Environment": "staging"
        }
      }
    },
    {
      "Sid": "ReadStagingCommandInvocations",
      "Effect": "Allow",
      "Action": [
        "ssm:GetCommandInvocation",
        "ssm:ListCommandInvocations",
        "ssm:ListCommands"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ManageStagingEc2",
      "Effect": "Allow",
      "Action": [
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:CreateKeyPair",
        "ec2:CreateSecurityGroup",
        "ec2:CreateTags",
        "ec2:DeleteKeyPair",
        "ec2:DeleteSecurityGroup",
        "ec2:RebootInstances",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:RunInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:TerminateInstances"
      ],
      "Resource": "*",
      "Condition": {
        "StringEqualsIfExists": {
          "aws:RequestTag/Environment": "staging",
          "aws:ResourceTag/Environment": "staging"
        }
      }
    },
    {
      "Sid": "ManageStagingBucket",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutBucketTagging",
        "s3:PutBucketVersioning",
        "s3:PutEncryptionConfiguration",
        "s3:PutLifecycleConfiguration",
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::$STAGING_BUCKET_NAME"
    },
    {
      "Sid": "ManageStagingBucketObjects",
      "Effect": "Allow",
      "Action": [
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::$STAGING_BUCKET_NAME/*"
    },
    {
      "Sid": "ManageStagingSsm",
      "Effect": "Allow",
      "Action": [
        "ssm:DeleteParameter",
        "ssm:DeleteParameters",
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
        "ssm:PutParameter"
      ],
      "Resource": "arn:aws:ssm:$AWS_REGION:$AWS_ACCOUNT_ID:parameter/aura/staging*"
    },
    {
      "Sid": "PassStagingEc2RoleOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::$AWS_ACCOUNT_ID:role/$instance_role_name",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ec2.amazonaws.com"
        }
      }
    },
    {
      "Sid": "ManageStagingBudget",
      "Effect": "Allow",
      "Action": [
        "budgets:CreateBudget",
        "budgets:ModifyBudget",
        "budgets:UpdateBudget",
        "budgets:ViewBudget"
      ],
      "Resource": "arn:aws:budgets::$AWS_ACCOUNT_ID:budget/$PROJECT_NAME-$STAGING_NAME-monthly-budget"
    }
  ]
}
JSON

cat > "$instance_trust" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

cat > "$instance_policy" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadStagingSsm",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:$AWS_REGION:$AWS_ACCOUNT_ID:parameter/aura/staging*"
    },
    {
      "Sid": "UseStagingUploadBucket",
      "Effect": "Allow",
      "Action": [
        "s3:AbortMultipartUpload",
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::$STAGING_BUCKET_NAME",
        "arn:aws:s3:::$STAGING_BUCKET_NAME/*"
      ]
    },
    {
      "Sid": "DecryptSsmSecureStringsViaSsm",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "ssm.$AWS_REGION.amazonaws.com"
        }
      }
    },
    {
      "Sid": "SsmManagedInstanceCore",
      "Effect": "Allow",
      "Action": [
        "ssm:UpdateInstanceInformation",
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
        "ec2messages:AcknowledgeMessage",
        "ec2messages:DeleteMessage",
        "ec2messages:FailMessage",
        "ec2messages:GetEndpoint",
        "ec2messages:GetMessages",
        "ec2messages:SendReply"
      ],
      "Resource": "*"
    }
  ]
}
JSON

if [ "${STAGING_IAM_DRY_RUN:-false}" = "true" ]; then
  log "DRY-RUN: wrote IAM policy documents under $STATE_DIR"
  exit 0
fi

if ! aws_admin iam get-role --role-name "$operator_role_name" >/dev/null 2>&1; then
  aws_admin iam create-role --role-name "$operator_role_name" --assume-role-policy-document "$(aws_file_uri "$operator_trust")" --tags \
    "Key=Project,Value=$PROJECT_NAME" \
    "Key=Environment,Value=staging" \
    "Key=ManagedBy,Value=codex-staging-bootstrap" >/dev/null
else
  aws_admin iam update-assume-role-policy --role-name "$operator_role_name" --policy-document "$(aws_file_uri "$operator_trust")" >/dev/null
fi
aws_admin iam put-role-policy --role-name "$operator_role_name" --policy-name "$operator_policy_name" --policy-document "$(aws_file_uri "$operator_policy")" >/dev/null

if ! aws_admin iam get-role --role-name "$instance_role_name" >/dev/null 2>&1; then
  aws_admin iam create-role --role-name "$instance_role_name" --assume-role-policy-document "$(aws_file_uri "$instance_trust")" --tags \
    "Key=Project,Value=$PROJECT_NAME" \
    "Key=Environment,Value=staging" \
    "Key=ManagedBy,Value=codex-staging-bootstrap" >/dev/null
fi
aws_admin iam put-role-policy --role-name "$instance_role_name" --policy-name "$instance_policy_name" --policy-document "$(aws_file_uri "$instance_policy")" >/dev/null

if ! aws_admin iam get-instance-profile --instance-profile-name "$instance_profile_name" >/dev/null 2>&1; then
  aws_admin iam create-instance-profile --instance-profile-name "$instance_profile_name" --tags \
    "Key=Project,Value=$PROJECT_NAME" \
    "Key=Environment,Value=staging" \
    "Key=ManagedBy,Value=codex-staging-bootstrap" >/dev/null
fi
aws_admin iam add-role-to-instance-profile --instance-profile-name "$instance_profile_name" --role-name "$instance_role_name" >/tmp/aura-add-instance-role.log 2>&1 || {
  if ! grep -q 'LimitExceeded\|EntityAlreadyExists' /tmp/aura-add-instance-role.log; then
    cat /tmp/aura-add-instance-role.log >&2
    die "Could not attach $instance_role_name to $instance_profile_name"
  fi
}

operator_role_arn="arn:aws:iam::$AWS_ACCOUNT_ID:role/$operator_role_name"
aws configure set "profile.$operator_profile_name.role_arn" "$operator_role_arn"
aws configure set "profile.$operator_profile_name.source_profile" "$admin_profile"
aws configure set "profile.$operator_profile_name.region" "$AWS_REGION"

state_set operator_role_name "$operator_role_name"
state_set operator_profile_name "$operator_profile_name"
state_set instance_role_name "$instance_role_name"
state_set instance_profile_name "$instance_profile_name"

log "Created/updated staging operator role $operator_role_name"
log "Created/updated EC2 instance profile $instance_profile_name"
log "Local AWS profile ready: $operator_profile_name"
