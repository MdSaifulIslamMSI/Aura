<#
.SYNOPSIS
    Bootstraps IAM permissions for the Aura project so the local dev
    user/role can manage S3, IAM, EC2, SSM, and STS resources.

.DESCRIPTION
    The existing IAM user (aura-local-emergency-ops-source) and assumed role
    (aura-local-emergency-ops) only have STS AssumeRole permissions.
    This script attaches the required managed + inline policies so the
    bootstrap-free-tier.ps1 script can run end-to-end.

    Run this ONCE with an admin or root AWS profile:
      .\bootstrap-iam-permissions.ps1 -AdminProfile <your-admin-profile>

.PARAMETER AdminProfile
    AWS CLI profile with IAM admin privileges (root or admin user).

.PARAMETER IamUserName
    The IAM user that assumes the role. Defaults to aura-local-emergency-ops-source.

.PARAMETER RoleName
    The assumed role name. Defaults to aura-local-emergency-ops.
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$AdminProfile,
    [string]$IamUserName = "aura-local-emergency-ops-source",
    [string]$RoleName    = "aura-local-emergency-ops",
    [string]$AwsRegion   = "ap-south-1"
)

$ErrorActionPreference = "Stop"

# ── 1. Create an inline policy on the ROLE for full Aura resource access ──────
Write-Host "Attaching inline Aura resource policy to role '$RoleName'..."

$rolePolicyDoc = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Sid      = "AuraS3Full"
            Effect   = "Allow"
            Action   = @("s3:*")
            Resource = @(
                "arn:aws:s3:::aura-*",
                "arn:aws:s3:::aura-*/*"
            )
        },
        @{
            Sid      = "AuraIAMBootstrap"
            Effect   = "Allow"
            Action   = @(
                "iam:CreateRole",
                "iam:GetRole",
                "iam:PutRolePolicy",
                "iam:AttachRolePolicy",
                "iam:CreateInstanceProfile",
                "iam:GetInstanceProfile",
                "iam:AddRoleToInstanceProfile",
                "iam:ListAttachedRolePolicies",
                "iam:ListRolePolicies",
                "iam:PassRole"
            )
            Resource = @(
                "arn:aws:iam::*:role/aura-*",
                "arn:aws:iam::*:instance-profile/aura-*"
            )
        },
        @{
            Sid      = "AuraEC2Bootstrap"
            Effect   = "Allow"
            Action   = @(
                "ec2:DescribeVpcs",
                "ec2:DescribeSubnets",
                "ec2:DescribeSecurityGroups",
                "ec2:CreateSecurityGroup",
                "ec2:AuthorizeSecurityGroupIngress",
                "ec2:RevokeSecurityGroupIngress",
                "ec2:DescribeInstanceTypes",
                "ec2:DescribeInstances",
                "ec2:RunInstances",
                "ec2:StartInstances",
                "ec2:CreateTags"
            )
            Resource = "*"
        },
        @{
            Sid      = "AuraSSM"
            Effect   = "Allow"
            Action   = @(
                "ssm:GetParameter",
                "ssm:GetParameters",
                "ssm:GetParametersByPath",
                "ssm:PutParameter",
                "ssm:DeleteParameter"
            )
            Resource = "arn:aws:ssm:${AwsRegion}:*:parameter/aura/*"
        }
    )
} | ConvertTo-Json -Depth 8 -Compress

$rolePolicyFile = Join-Path $env:TEMP "aura-role-inline-policy.json"
$rolePolicyDoc | Set-Content -LiteralPath $rolePolicyFile -Encoding ascii

aws iam put-role-policy `
    --profile $AdminProfile `
    --role-name $RoleName `
    --policy-name "AuraResourceAccess" `
    --policy-document "file://$rolePolicyFile"

Write-Host "  Done: inline policy 'AuraResourceAccess' attached to role '$RoleName'."

# ── 2. Grant the source IAM user permission to assume the role ────────────────
Write-Host "Verifying AssumeRole permission for user '$IamUserName'..."

$userPolicyDoc = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Sid      = "AssumeAuraRole"
            Effect   = "Allow"
            Action   = "sts:AssumeRole"
            Resource = "arn:aws:iam::*:role/$RoleName"
        }
    )
} | ConvertTo-Json -Depth 6 -Compress

$userPolicyFile = Join-Path $env:TEMP "aura-user-assume-policy.json"
$userPolicyDoc | Set-Content -LiteralPath $userPolicyFile -Encoding ascii

aws iam put-user-policy `
    --profile $AdminProfile `
    --user-name $IamUserName `
    --policy-name "AssumeAuraOpsRole" `
    --policy-document "file://$userPolicyFile"

Write-Host "  Done: user '$IamUserName' can assume role '$RoleName'."

# ── 3. Verify ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Bootstrap complete ==="
Write-Host "Now run the full bootstrap with your normal Aura profile:"
Write-Host "  .\bootstrap-free-tier.ps1"
Write-Host ""
Write-Host "Or test S3 access immediately:"
Write-Host "  aws s3api create-bucket --bucket aura-review-media --region $AwsRegion --create-bucket-configuration LocationConstraint=$AwsRegion"
