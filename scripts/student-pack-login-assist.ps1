param(
    [switch]$All,
    [switch]$Doppler,
    [switch]$Sentry,
    [switch]$Datadog,
    [switch]$Testmail,
    [switch]$LambdaTest,
    [switch]$LocalStack
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$extraPathEntries = @(
    (Join-Path $RepoRoot "bin"),
    (Join-Path $env:APPDATA "npm"),
    (Join-Path $env:APPDATA "Python\Python312\Scripts"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Doppler.doppler_Microsoft.Winget.Source_8wekyb3d8bbwe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\LocalStack.localstack-cli_Microsoft.Winget.Source_8wekyb3d8bbwe")
) | Where-Object { $_ -and (Test-Path $_) }


foreach ($entry in $extraPathEntries) {
    if (($env:Path -split ';') -notcontains $entry) {
        $env:Path = "$entry;$env:Path"
    }
}

if (-not ($All -or $Doppler -or $Sentry -or $Datadog -or $Testmail -or $LambdaTest -or $LocalStack)) {
    $All = $true
}

function Start-VisibleCli {
    param(
        [string]$Title,
        [string]$Command
    )

    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Set-Location `"$RepoRoot`"; `$Host.UI.RawUI.WindowTitle = `"$Title`"; $Command"
    )
}

function Open-ProviderUrl {
    param([string]$Url)
    Start-Process $Url
}

Write-Host "Aura Student Pack live-login assist"
Write-Host "Complete the provider-owned browser/terminal prompts, then run:"
Write-Host "  npm run student-pack:auth:live -- --write"
Write-Host ""

if ($All -or $Doppler) {
    if (Get-Command doppler -ErrorAction SilentlyContinue) {
        Start-VisibleCli -Title "Aura Doppler Login" -Command "doppler login -y --scope `"$RepoRoot`"; doppler setup; Write-Host ''; Write-Host 'Doppler done. Re-run npm run student-pack:auth:live -- --write when all provider prompts are complete.'"
    } else {
        Open-ProviderUrl "https://dashboard.doppler.com/"
    }
}

if ($All -or $Sentry) {
    if (Get-Command sentry-cli -ErrorAction SilentlyContinue) {
        Start-VisibleCli -Title "Aura Sentry Login" -Command "sentry-cli login --global; Write-Host ''; Write-Host 'If prompted for a token, create one at https://sentry.io/settings/account/api/auth-tokens/ with project:read, org:read, release:admin, and project:releases scopes.'"
    }
    Open-ProviderUrl "https://sentry.io/settings/account/api/auth-tokens/"
}

if ($All -or $Datadog) {
    Open-ProviderUrl "https://app.datadoghq.com/organization-settings/api-keys"
    Open-ProviderUrl "https://app.datadoghq.com/organization-settings/application-keys"
}

if ($All -or $Testmail) {
    Open-ProviderUrl "https://testmail.app/console"
}

if ($All -or $LambdaTest) {
    Open-ProviderUrl "https://accounts.lambdatest.com/security"
    Open-ProviderUrl "https://automation.lambdatest.com/"
}

if ($All -or $LocalStack) {
    if (Get-Command localstack -ErrorAction SilentlyContinue) {
        Start-VisibleCli -Title "Aura LocalStack Auth" -Command "localstack auth set-token; Write-Host ''; Write-Host 'After setting the token, run npm run student-pack:start to boot the local AWS sandbox.'"
    }
    Open-ProviderUrl "https://app.localstack.cloud/workspace/auth-token"
}

Write-Host "Login assist launched."
Write-Host "No provider token was printed or written by this script."
