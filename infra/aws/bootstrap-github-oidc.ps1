param(
    [string]$RoleName = "aura-github-actions-deploy",
    [string]$Repository = "",
    [string]$Branch = "main",
    [string]$AwsRegion = "ap-south-1",
    [string]$DeployBucketName = "aura-backend-deployments",
    [string]$InstanceTagKey = "Name",
    [string]$InstanceTagValue = "aura-backend"
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Resolve-RepositorySlug {
    param([string]$ExplicitRepository)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitRepository)) {
        return $ExplicitRepository.Trim()
    }

    $originUrl = git config --get remote.origin.url
    if ([string]::IsNullOrWhiteSpace($originUrl)) {
        throw "Repository slug is required. Pass -Repository owner/repo."
    }

    if ($originUrl -match '[:/]([^/]+/[^/.]+?)(?:\.git)?$') {
        return $Matches[1]
    }

    throw "Could not infer repository slug from remote origin '$originUrl'."
}

function Get-OrCreateOidcProviderArn {
    $providers = aws iam list-open-id-connect-providers | ConvertFrom-Json
    foreach ($provider in ($providers.OpenIDConnectProviderList | ForEach-Object { $_.Arn })) {
        $details = aws iam get-open-id-connect-provider --open-id-connect-provider-arn $provider | ConvertFrom-Json
        if ($details.Url -eq "token.actions.githubusercontent.com") {
            return $provider
        }
    }

    $created = aws iam create-open-id-connect-provider `
        --url https://token.actions.githubusercontent.com `
        --client-id-list sts.amazonaws.com | ConvertFrom-Json
    return $created.OpenIDConnectProviderArn
}

Require-Command -Name "aws"
Require-Command -Name "git"

$repoSlug = Resolve-RepositorySlug -ExplicitRepository $Repository
$oidcProviderArn = Get-OrCreateOidcProviderArn
$subject = "repo:$repoSlug:ref:refs/heads/$Branch"

$trustPolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{
                Federated = $oidcProviderArn
            }
            Action = "sts:AssumeRoleWithWebIdentity"
            Condition = @{
                StringEquals = @{
                    "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
                    "token.actions.githubusercontent.com:sub" = $subject
                }
            }
        }
    )
} | ConvertTo-Json -Depth 8

$trustPolicyFile = Join-Path $env:TEMP "aura-github-oidc-trust.json"
$inlinePolicyFile = Join-Path $env:TEMP "aura-github-oidc-inline.json"
$trustPolicy | Set-Content -LiteralPath $trustPolicyFile -Encoding ascii

    $null = aws iam get-role --role-name $RoleName 2>$null
    $roleExists = ($LASTEXITCODE -eq 0)

if (-not $roleExists) {
    aws iam create-role `
        --role-name $RoleName `
        --assume-role-policy-document "file://$trustPolicyFile" | Out-Null
} else {
    aws iam update-assume-role-policy `
        --role-name $RoleName `
        --policy-document "file://$trustPolicyFile" | Out-Null
}

$deployBucketArn = "arn:aws:s3:::$DeployBucketName"
$deployBucketObjectsArn = "$deployBucketArn/*"
$inlinePolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Sid = "DeployArtifacts"
            Effect = "Allow"
            Action = @(
                "s3:AbortMultipartUpload",
                "s3:GetObject",
                "s3:ListBucket",
                "s3:PutObject"
            )
            Resource = @(
                $deployBucketArn,
                $deployBucketObjectsArn
            )
        },
        @{
            Sid = "DeployCommands"
            Effect = "Allow"
            Action = @(
                "ec2:DescribeInstances",
                "ssm:GetCommandInvocation",
                "ssm:ListCommandInvocations",
                "ssm:SendCommand"
            )
            Resource = "*"
        }
    )
} | ConvertTo-Json -Depth 8
$inlinePolicy | Set-Content -LiteralPath $inlinePolicyFile -Encoding ascii

aws iam put-role-policy `
    --role-name $RoleName `
    --policy-name "aura-github-actions-deploy" `
    --policy-document "file://$inlinePolicyFile" | Out-Null

$roleArn = (aws iam get-role --role-name $RoleName | ConvertFrom-Json).Role.Arn

Write-Host "GitHub OIDC deploy role ready."
Write-Host "Role ARN: $roleArn"
Write-Host "Repository: $repoSlug"
Write-Host "Suggested GitHub repository variables:"
Write-Host "  AWS_REGION=$AwsRegion"
Write-Host "  AWS_DEPLOY_BUCKET=$DeployBucketName"
Write-Host "  AWS_INSTANCE_TAG_KEY=$InstanceTagKey"
Write-Host "  AWS_INSTANCE_TAG_VALUE=$InstanceTagValue"
Write-Host "Suggested GitHub repository secret:"
Write-Host "  AWS_DEPLOY_ROLE_ARN=$roleArn"
