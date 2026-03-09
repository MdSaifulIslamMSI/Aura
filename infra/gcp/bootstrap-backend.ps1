param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [string]$Region = "us-central1",
    [string]$ArtifactRegistryRepository = "aura-api",
    [string]$RuntimeServiceAccountName = "aura-backend",
    [string]$UploadBucket
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Gcloud {
    if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
        throw "Google Cloud CLI is required. Install it first, then rerun this script."
    }
}

function Invoke-GcloudJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & gcloud @Arguments
    if (-not $output) {
        return $null
    }
    return $output | ConvertFrom-Json
}

Require-Gcloud

& gcloud config set project $ProjectId | Out-Null

& gcloud services enable `
    run.googleapis.com `
    artifactregistry.googleapis.com `
    secretmanager.googleapis.com `
    cloudbuild.googleapis.com `
    storage.googleapis.com `
    iam.googleapis.com | Out-Null

$repoExists = $true
try {
    Invoke-GcloudJson -Arguments @("artifacts", "repositories", "describe", $ArtifactRegistryRepository, "--location=$Region", "--format=json") | Out-Null
} catch {
    $repoExists = $false
}

if (-not $repoExists) {
    & gcloud artifacts repositories create $ArtifactRegistryRepository `
        --repository-format=docker `
        --location=$Region `
        --description="Aura backend images" | Out-Null
}

if (-not [string]::IsNullOrWhiteSpace($UploadBucket)) {
    $bucketExists = $true
    try {
        & gcloud storage buckets describe "gs://$UploadBucket" --format=json | Out-Null
    } catch {
        $bucketExists = $false
    }

    if (-not $bucketExists) {
        & gcloud storage buckets create "gs://$UploadBucket" --location=$Region --uniform-bucket-level-access | Out-Null
    }
}

$runtimeServiceAccountEmail = "$RuntimeServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$serviceAccountExists = $true
try {
    Invoke-GcloudJson -Arguments @("iam", "service-accounts", "describe", $runtimeServiceAccountEmail, "--format=json") | Out-Null
} catch {
    $serviceAccountExists = $false
}

if (-not $serviceAccountExists) {
    & gcloud iam service-accounts create $RuntimeServiceAccountName `
        --display-name="Aura backend runtime" | Out-Null
}

if (-not [string]::IsNullOrWhiteSpace($UploadBucket)) {
    & gcloud storage buckets add-iam-policy-binding "gs://$UploadBucket" `
        --member="serviceAccount:$runtimeServiceAccountEmail" `
        --role="roles/storage.objectAdmin" | Out-Null
}

& gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$runtimeServiceAccountEmail" `
    --role="roles/secretmanager.secretAccessor" | Out-Null

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Project: $ProjectId"
Write-Host "Region: $Region"
Write-Host "Artifact Registry: $ArtifactRegistryRepository"
Write-Host "Runtime service account: $runtimeServiceAccountEmail"
if (-not [string]::IsNullOrWhiteSpace($UploadBucket)) {
    Write-Host "Upload bucket: $UploadBucket"
}
Write-Host ""
Write-Host "Next:"
Write-Host "1. Create Secret Manager secrets for Mongo, Redis, Bytez, and upload signing."
Write-Host "2. Configure GitHub Workload Identity Federation and repository secrets."
Write-Host "3. Run the GitHub workflow '.github/workflows/deploy-backend-gcp.yml'."
