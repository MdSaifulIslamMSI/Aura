param(
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsProfile = "",
    [string]$BucketName = "",
    [string]$BackendOrigin = "",
    [string]$DistDir = "app/dist",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Trim-TrailingSlash {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    return $Value.Trim().TrimEnd("/")
}

Require-Command -Name "aws"
Require-Command -Name "node"
Require-Command -Name "npm"

if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
    $env:AWS_PROFILE = $AwsProfile.Trim()
}

$accountId = aws sts get-caller-identity --query "Account" --output text
if ([string]::IsNullOrWhiteSpace($accountId) -or $accountId -eq "None") {
    throw "Could not resolve AWS account id."
}

$resolvedBucketName = if ([string]::IsNullOrWhiteSpace($BucketName)) {
    "aura-frontend-$accountId-$AwsRegion"
} else {
    $BucketName.Trim()
}

$resolvedBackendOrigin = if ([string]::IsNullOrWhiteSpace($BackendOrigin)) {
    node ./app/scripts/print_hosted_backend_origin.mjs
} else {
    $BackendOrigin
}
$resolvedBackendOrigin = Trim-TrailingSlash -Value $resolvedBackendOrigin

if (-not ($resolvedBackendOrigin -match '^https?://')) {
    throw "Backend origin must be an absolute http(s) URL. Received '$resolvedBackendOrigin'."
}

if (-not $SkipBuild) {
    $env:VITE_DEPLOY_TARGET = "multi-host"
    $env:VITE_API_URL = "$resolvedBackendOrigin/api"
    $env:VITE_RELEASE_CHANNEL = "production"
    $env:VITE_RELEASE_SOURCE = "local-aws-s3"
    $env:VITE_RELEASE_TIME = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")

    npm --prefix app run build
}

$resolvedDistDir = Resolve-Path -LiteralPath $DistDir

aws s3 sync "$resolvedDistDir" "s3://$resolvedBucketName" `
    --region $AwsRegion `
    --delete `
    --cache-control "public,max-age=300" | Out-Null

$assetsDir = Join-Path $resolvedDistDir "assets"
if (Test-Path -LiteralPath $assetsDir) {
    aws s3 sync "$assetsDir" "s3://$resolvedBucketName/assets" `
        --region $AwsRegion `
        --delete `
        --cache-control "public,max-age=31536000,immutable" | Out-Null
}

$indexPath = Join-Path $resolvedDistDir "index.html"
aws s3 cp "$indexPath" "s3://$resolvedBucketName/index.html" `
    --region $AwsRegion `
    --cache-control "no-cache,no-store,must-revalidate" `
    --content-type "text/html" | Out-Null

$websiteUrl = "http://$resolvedBucketName.s3-website.$AwsRegion.amazonaws.com"

Write-Host "AWS frontend deployed."
Write-Host "Bucket: $resolvedBucketName"
Write-Host "Website URL: $websiteUrl"
Write-Host "Backend origin baked into build: $resolvedBackendOrigin"
