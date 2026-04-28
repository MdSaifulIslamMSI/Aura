param(
    [string]$RoleName = "aura-github-actions-frontend-deploy",
    [string]$Repository = "",
    [string]$Branch = "main",
    [string]$GitHubEnvironment = "aws-frontend-production",
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsProfile = "",
    [string]$BucketName = ""
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

function Resolve-BucketName {
    param(
        [string]$ExplicitBucketName,
        [string]$Region
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitBucketName)) {
        return $ExplicitBucketName.Trim()
    }

    $accountId = aws sts get-caller-identity --query "Account" --output text
    if ([string]::IsNullOrWhiteSpace($accountId) -or $accountId -eq "None") {
        throw "Could not resolve AWS account id for frontend bucket naming."
    }

    return "aura-frontend-$accountId-$Region"
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
$resolvedBucketName = Resolve-BucketName -ExplicitBucketName $BucketName -Region $AwsRegion
$oidcProviderArn = Get-OrCreateOidcProviderArn
$branchSubject = 'repo:{0}:ref:refs/heads/{1}' -f $repoSlug, $Branch
$allowedSubjects = @($branchSubject)

if (-not [string]::IsNullOrWhiteSpace($GitHubEnvironment)) {
    $allowedSubjects += ('repo:{0}:environment:{1}' -f $repoSlug, $GitHubEnvironment.Trim())
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

$inlinePolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Sid = "ListFrontendBucket"
            Effect = "Allow"
            Action = @(
                "s3:GetBucketLocation",
                "s3:ListBucket"
            )
            Resource = "arn:aws:s3:::$resolvedBucketName"
        },
        @{
            Sid = "PublishFrontendObjects"
            Effect = "Allow"
            Action = @(
                "s3:DeleteObject",
                "s3:GetObject",
                "s3:PutObject"
            )
            Resource = "arn:aws:s3:::$resolvedBucketName/*"
        }
    )
} | ConvertTo-Json -Depth 8

$trustPolicyFile = Join-Path $env:TEMP "$RoleName-trust.json"
$inlinePolicyFile = Join-Path $env:TEMP "$RoleName-inline.json"
$trustPolicy | Set-Content -LiteralPath $trustPolicyFile -Encoding ascii
$inlinePolicy | Set-Content -LiteralPath $inlinePolicyFile -Encoding ascii

$nativeErrorPreferenceVariable = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
if ($nativeErrorPreferenceVariable) {
    $previousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
}

$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    aws iam get-role --role-name $RoleName 1>$null 2>$null
    $roleExists = ($LASTEXITCODE -eq 0)
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
    if ($nativeErrorPreferenceVariable) {
        $PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
    }
}

if ($roleExists) {
    aws iam update-assume-role-policy `
        --role-name $RoleName `
        --policy-document "file://$trustPolicyFile" | Out-Null
} else {
    aws iam create-role `
        --role-name $RoleName `
        --assume-role-policy-document "file://$trustPolicyFile" | Out-Null
}

aws iam put-role-policy `
    --role-name $RoleName `
    --policy-name "$RoleName-inline" `
    --policy-document "file://$inlinePolicyFile" | Out-Null

$roleArn = aws iam get-role --role-name $RoleName --query "Role.Arn" --output text

Write-Host "GitHub OIDC frontend deploy role ready."
Write-Host "Role ARN: $roleArn"
Write-Host "Repository: $repoSlug"
Write-Host "Bucket: $resolvedBucketName"
Write-Host "Subjects:"
foreach ($allowedSubject in $allowedSubjects) {
    Write-Host "  $allowedSubject"
}
Write-Host "Suggested GitHub repository variables:"
Write-Host "  AWS_REGION=$AwsRegion"
Write-Host "  AWS_FRONTEND_BUCKET=$resolvedBucketName"
Write-Host "  AWS_FRONTEND_DEPLOY_ROLE_ARN=$roleArn"
