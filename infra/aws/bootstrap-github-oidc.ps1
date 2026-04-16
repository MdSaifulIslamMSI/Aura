param(
    [string]$RoleName = "aura-github-actions-deploy",
    [string]$Repository = "",
    [string]$Branch = "main",
    [string]$GitHubEnvironment = "",
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsProfile = "",
    [string]$DeployBucketName = "",
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

function Resolve-DeployBucketName {
    param(
        [string]$ExplicitBucketName,
        [string]$Region
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitBucketName)) {
        return $ExplicitBucketName.Trim()
    }

    $accountId = aws sts get-caller-identity --query "Account" --output text
    if ([string]::IsNullOrWhiteSpace($accountId) -or $accountId -eq "None") {
        throw "Could not resolve AWS account id for deploy bucket naming."
    }

    return "aura-backend-deployments-$accountId-$Region"
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

if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
    $env:AWS_PROFILE = $AwsProfile.Trim()
}

$repoSlug = Resolve-RepositorySlug -ExplicitRepository $Repository
$resolvedDeployBucketName = Resolve-DeployBucketName -ExplicitBucketName $DeployBucketName -Region $AwsRegion
$oidcProviderArn = Get-OrCreateOidcProviderArn
$subject = 'repo:{0}:ref:refs/heads/{1}' -f $repoSlug, $Branch
$allowedSubjects = @($subject)

if (-not [string]::IsNullOrWhiteSpace($GitHubEnvironment)) {
    $environmentSubject = 'repo:{0}:environment:{1}' -f $repoSlug, $GitHubEnvironment.Trim()
    $allowedSubjects += $environmentSubject
}

if ($subject -notmatch '^repo:[^/]+/[^:]+:ref:refs/heads/.+$') {
    throw "Resolved GitHub subject '$subject' is invalid."
}

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
                }
                StringLike = @{
                    "token.actions.githubusercontent.com:sub" = $allowedSubjects
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

$deployBucketArn = "arn:aws:s3:::$resolvedDeployBucketName"
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
Write-Host "Subjects:"
foreach ($allowedSubject in $allowedSubjects) {
    Write-Host "  $allowedSubject"
}
Write-Host "Suggested GitHub repository variables:"
Write-Host "  AWS_REGION=$AwsRegion"
Write-Host "  AWS_DEPLOY_BUCKET=$resolvedDeployBucketName"
Write-Host "  AWS_INSTANCE_TAG_KEY=$InstanceTagKey"
Write-Host "  AWS_INSTANCE_TAG_VALUE=$InstanceTagValue"
Write-Host "Suggested GitHub repository secret:"
Write-Host "  AWS_DEPLOY_ROLE_ARN=$roleArn"
