param(
    [Parameter(Mandatory = $true)]
    [string]$Region,

    [string]$EcrRepository = "aura-api",
    [string]$EcsCluster = "aura-prod",
    [string]$CloudWatchLogGroup = "/ecs/aura-api",
    [string]$UploadBucket,
    [switch]$SkipBucket
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-AwsCli {
    if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
        throw "AWS CLI is required. Install it first, then rerun this script."
    }
}

function Invoke-AwsJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & aws @Arguments
    if (-not $output) {
        return $null
    }
    return $output | ConvertFrom-Json
}

function Ensure-EcrRepository {
    param([string]$RepositoryName)

    try {
        return Invoke-AwsJson -Arguments @("ecr", "describe-repositories", "--repository-names", $RepositoryName, "--region", $Region)
    } catch {
        Write-Host "Creating ECR repository $RepositoryName"
        return Invoke-AwsJson -Arguments @(
            "ecr", "create-repository",
            "--repository-name", $RepositoryName,
            "--image-scanning-configuration", "scanOnPush=true",
            "--region", $Region
        )
    }
}

function Ensure-EcsCluster {
    param([string]$ClusterName)

    $existing = Invoke-AwsJson -Arguments @("ecs", "describe-clusters", "--clusters", $ClusterName, "--region", $Region)
    if ($existing.clusters.Count -gt 0) {
        return $existing
    }

    Write-Host "Creating ECS cluster $ClusterName"
    return Invoke-AwsJson -Arguments @("ecs", "create-cluster", "--cluster-name", $ClusterName, "--region", $Region)
}

function Ensure-LogGroup {
    param([string]$LogGroupName)

    $existing = Invoke-AwsJson -Arguments @("logs", "describe-log-groups", "--log-group-name-prefix", $LogGroupName, "--region", $Region)
    $alreadyExists = $false
    if ($existing -and $existing.logGroups) {
        foreach ($group in $existing.logGroups) {
            if ($group.logGroupName -eq $LogGroupName) {
                $alreadyExists = $true
                break
            }
        }
    }

    if (-not $alreadyExists) {
        Write-Host "Creating CloudWatch log group $LogGroupName"
        & aws logs create-log-group --log-group-name $LogGroupName --region $Region | Out-Null
    }

    & aws logs put-retention-policy --log-group-name $LogGroupName --retention-in-days 30 --region $Region | Out-Null
}

function Ensure-S3Bucket {
    param([string]$BucketName)

    if ([string]::IsNullOrWhiteSpace($BucketName)) {
        throw "UploadBucket is required unless -SkipBucket is set."
    }

    $exists = $true
    try {
        & aws s3api head-bucket --bucket $BucketName 2>$null | Out-Null
    } catch {
        $exists = $false
    }

    if (-not $exists) {
        Write-Host "Creating S3 bucket $BucketName"
        if ($Region -eq "us-east-1") {
            & aws s3api create-bucket --bucket $BucketName --region $Region | Out-Null
        } else {
            & aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
        }
    }

    & aws s3api put-bucket-versioning --bucket $BucketName --versioning-configuration Status=Enabled --region $Region | Out-Null
    & aws s3api put-bucket-encryption --bucket $BucketName --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' --region $Region | Out-Null
}

Require-AwsCli

$identity = Invoke-AwsJson -Arguments @("sts", "get-caller-identity", "--region", $Region)
$accountId = [string]$identity.Account

Write-Host "Using AWS account $accountId in region $Region"

$repo = Ensure-EcrRepository -RepositoryName $EcrRepository
$cluster = Ensure-EcsCluster -ClusterName $EcsCluster
Ensure-LogGroup -LogGroupName $CloudWatchLogGroup

if (-not $SkipBucket) {
    Ensure-S3Bucket -BucketName $UploadBucket
}

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "ECR repository: $EcrRepository"
Write-Host "ECS cluster: $EcsCluster"
Write-Host "CloudWatch log group: $CloudWatchLogGroup"
if (-not $SkipBucket) {
    Write-Host "Upload bucket: $UploadBucket"
}
Write-Host ""
Write-Host "Next:"
Write-Host "1. Create IAM roles for ECS execution and task access."
Write-Host "2. Create Secrets Manager entries for Mongo, Redis, Bytez, and upload signing."
Write-Host "3. Configure the GitHub secrets listed in infra/aws/README.md."
Write-Host "4. Run the GitHub Actions workflow '.github/workflows/deploy-backend-aws.yml'."
