param(
    [string]$EnvFile = "",
    [string]$Repo = "",
    [switch]$TriggerWorkflow,
    [string]$WorkflowFile = "sync-azure-runtime.yml",
    [string]$Ref = "main"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoFromGitRemote {
    $remote = git config --get remote.origin.url
    if ([string]::IsNullOrWhiteSpace($remote)) {
        throw "Could not resolve GitHub repo from git remote."
    }

    if ($remote -match 'github\.com[:/](.+?)(?:\.git)?$') {
        return $matches[1]
    }

    throw "Remote origin is not a GitHub repository URL."
}

function Resolve-EnvPath {
    param([string]$RepositoryRoot, [string]$Preferred)

    if (-not [string]::IsNullOrWhiteSpace($Preferred)) {
        $candidate = $Preferred
        if (-not [System.IO.Path]::IsPathRooted($candidate)) {
            $candidate = Join-Path $RepositoryRoot $candidate
        }
        if (-not (Test-Path $candidate)) {
            throw "Env file not found at $candidate"
        }
        return $candidate
    }

    foreach ($candidate in @(
        (Join-Path $RepositoryRoot "server\.env.azure-secrets"),
        (Join-Path $RepositoryRoot "server\.env")
    )) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "Could not find server/.env.azure-secrets or server/.env"
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resolvedRepo = if ($Repo) { $Repo } else { Resolve-RepoFromGitRemote }
$resolvedEnvFile = Resolve-EnvPath -RepositoryRoot $repoRoot -Preferred $EnvFile

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    throw "GitHub CLI is required. Install gh and run 'gh auth login' first."
}

& $gh.Source auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
}

Write-Host "Publishing $resolvedEnvFile to GitHub secret AZURE_RUNTIME_ENV_FILE for $resolvedRepo..." -ForegroundColor Cyan
Get-Content $resolvedEnvFile -Raw | & $gh.Source secret set AZURE_RUNTIME_ENV_FILE --repo $resolvedRepo
if ($LASTEXITCODE -ne 0) {
    throw "Failed to update GitHub secret AZURE_RUNTIME_ENV_FILE."
}

if ($TriggerWorkflow) {
    Write-Host "Triggering GitHub workflow $WorkflowFile on $resolvedRepo..." -ForegroundColor Cyan
    & $gh.Source workflow run $WorkflowFile --repo $resolvedRepo --ref $Ref
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to trigger workflow $WorkflowFile."
    }
}

Write-Host "Azure runtime env published successfully." -ForegroundColor Green
