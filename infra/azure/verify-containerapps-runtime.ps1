param(
    [string]$SubscriptionId = "",
    [string]$ResourceGroup = "rg-aura-prod",
    [string]$KeyVaultName = "aura-msi-20260318-kv",
    [string]$ApiAppName = "aura-msi-api-ca",
    [string]$WorkerAppName = "aura-msi-worker-ca",
    [string]$IntelligenceAppName = "aura-msi-intelligence-ca",
    [string]$SourceEnvFile = "",
    [string]$ManifestPath = "",
    [string]$FrontendOrigin = "",
    [string]$ApiPublicUrl = "",
    [switch]$SkipKeyVaultValueCheck,
    [string]$ReportOutputPath = ""
)

$ErrorActionPreference = "Stop"
$script:AzCliPath = $null
$script:AzCliMode = "cmd"

function Resolve-AzureCliCommand {
    $pythonCandidates = @(
        "C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe",
        "C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\python.exe"
    )

    foreach ($candidate in $pythonCandidates) {
        if (Test-Path $candidate) {
            $script:AzCliMode = "python"
            return $candidate
        }
    }

    $cmd = Get-Command az -ErrorAction SilentlyContinue
    if ($cmd) {
        $script:AzCliMode = "cmd"
        return $cmd.Source
    }

    throw "Azure CLI is not installed. Install Azure CLI and rerun."
}

function Invoke-AzCli {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    if ($script:AzCliMode -eq "python") {
        & $script:AzCliPath -m azure.cli @Arguments
    } else {
        & $script:AzCliPath @Arguments
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed."
    }
}

function Require-AzureCli {
    $script:AzCliPath = Resolve-AzureCliCommand
    $null = Invoke-AzCli account show --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI is not authenticated. Run 'az login' first."
    }

    if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
        Invoke-AzCli account set --subscription $SubscriptionId | Out-Null
    }
}

function Trim-OrDefault {
    param(
        [string]$Value,
        [string]$Fallback = ""
    )

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return $Fallback
    }

    return [string]$Value.Trim()
}

function Read-EnvFile {
    param([string]$Path)

    $map = [ordered]@{}
    if (-not $Path -or -not (Test-Path $Path)) {
        return $map
    }

    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
        $parts = $line -split "=", 2
        $key = $parts[0].Trim()
        $value = $parts[1]
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $map[$key] = $value
    }

    return $map
}

function Convert-EnvNameToSecretName {
    param([string]$EnvName)
    return $EnvName.Trim().ToLowerInvariant().Replace("_", "-")
}

function Test-IsSecretEnvName {
    param([string]$EnvName)

    $upper = $EnvName.Trim().ToUpperInvariant()
    if ([string]::IsNullOrWhiteSpace($upper)) { return $false }

    if ($upper -match '(^|_)(SECRET|TOKEN|PASSWORD)$') { return $true }
    if ($upper -match '(^|_)API_KEY$') { return $true }
    if ($upper -match '(^|_)PRIVATE_KEY$') { return $true }
    if ($upper -match '(^|_)CONNECTION_STRING$') { return $true }
    if ($upper -match '_URI$') { return $true }
    if ($upper -match '_WEBHOOK_SECRET$') { return $true }
    if ($upper -match '_SERVICE_ACCOUNT$') { return $true }
    if ($upper -match '_KEY_SECRET$') { return $true }

    return $false
}

function Get-ServiceAppName {
    param([string]$ServiceKey)

    switch ($ServiceKey) {
        "api" { return $ApiAppName }
        "worker" { return $WorkerAppName }
        "intelligence" { return $IntelligenceAppName }
        default { throw "Unknown service key $ServiceKey" }
    }
}

function Get-PlanFromSyncScript {
    $syncScript = Join-Path $PSScriptRoot "sync-containerapps-runtime.ps1"
    $powershellExe = (Get-Command powershell -ErrorAction Stop).Source
    $tempPlan = Join-Path $env:TEMP ("aura-runtime-plan-" + [guid]::NewGuid().ToString("N") + ".json")
    try {
        $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $syncScript, "-DryRun", "-DiscoverAzureUrlsInDryRun", "-PlanOutputPath", $tempPlan)
        if (-not [string]::IsNullOrWhiteSpace($SourceEnvFile)) {
            $args += @("-SourceEnvFile", $SourceEnvFile)
        }
        if (-not [string]::IsNullOrWhiteSpace($ManifestPath)) {
            $args += @("-ManifestPath", $ManifestPath)
        }
        if (-not [string]::IsNullOrWhiteSpace($FrontendOrigin)) {
            $args += @("-FrontendOrigin", $FrontendOrigin)
        }
        if (-not [string]::IsNullOrWhiteSpace($ApiPublicUrl)) {
            $args += @("-ApiPublicUrl", $ApiPublicUrl)
        }
        & $powershellExe @args | Out-Null
        return Get-Content $tempPlan -Raw | ConvertFrom-Json
    } finally {
        Remove-Item $tempPlan -Force -ErrorAction SilentlyContinue
    }
}

function Parse-EnvArgs {
    param([string[]]$Items)

    $map = [ordered]@{}
    foreach ($item in $Items) {
        $parts = $item -split "=", 2
        if ($parts.Count -eq 2) {
            $map[$parts[0]] = $parts[1]
        }
    }
    return $map
}

function Parse-SecretArgs {
    param([string[]]$Items)

    $map = [ordered]@{}
    foreach ($item in $Items) {
        $parts = $item -split "=", 2
        if ($parts.Count -ne 2) { continue }
        $alias = $parts[0]
        $details = [ordered]@{}
        foreach ($fragment in ($parts[1] -split ",")) {
            $fragParts = $fragment -split ":", 2
            if ($fragParts.Count -eq 2) {
                $details[$fragParts[0]] = $fragParts[1]
            }
        }
        $map[$alias] = $details
    }
    return $map
}

function Get-ActualContainerAppState {
    param([string]$AppName)

    $envJson = Invoke-AzCli containerapp show --name $AppName --resource-group $ResourceGroup --query "properties.template.containers[0].env" --output json
    $secretJson = Invoke-AzCli containerapp show --name $AppName --resource-group $ResourceGroup --query "properties.configuration.secrets" --output json

    $envMap = [ordered]@{}
    foreach ($entry in ($envJson | ConvertFrom-Json)) {
        if ($entry.secretRef) {
            $envMap[[string]$entry.name] = "secretref:$([string]$entry.secretRef)"
        } else {
            $envMap[[string]$entry.name] = [string]$entry.value
        }
    }

    $secretMap = [ordered]@{}
    foreach ($entry in ($secretJson | ConvertFrom-Json)) {
        $secretMap[[string]$entry.name] = [ordered]@{
            keyVaultUrl = [string]$entry.keyVaultUrl
            identity = [string]$entry.identity
        }
    }

    return @{
        Env = $envMap
        Secrets = $secretMap
    }
}

function Compare-Maps {
    param(
        [System.Collections.IDictionary]$Expected,
        [System.Collections.IDictionary]$Actual
    )

    $drift = @()
    foreach ($key in $Expected.Keys) {
        if (-not $Actual.Contains($key)) {
            $drift += [pscustomobject]@{ type = "missing"; key = $key; expected = $Expected[$key]; actual = $null }
            continue
        }
        if ([string]$Expected[$key] -ne [string]$Actual[$key]) {
            $drift += [pscustomobject]@{ type = "mismatch"; key = $key; expected = $Expected[$key]; actual = $Actual[$key] }
        }
    }
    return $drift
}

function Get-KeyVaultValueDrift {
    param(
        [System.Collections.IDictionary]$SourceValues,
        [string[]]$ExpectedSecretEnvNames
    )

    if ($SkipKeyVaultValueCheck) {
        return @()
    }

    $expectedLookup = @{}
    foreach ($name in $ExpectedSecretEnvNames) {
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $expectedLookup[[string]$name] = $true
        }
    }

    $drift = @()
    foreach ($entry in $SourceValues.GetEnumerator()) {
        $envName = [string]$entry.Key
        if ($expectedLookup.Count -gt 0 -and -not $expectedLookup.ContainsKey($envName)) { continue }
        $expected = Trim-OrDefault $entry.Value
        if (-not (Test-IsSecretEnvName -EnvName $envName)) { continue }
        if ([string]::IsNullOrWhiteSpace($expected)) { continue }

        $secretName = Convert-EnvNameToSecretName -EnvName $envName
        try {
            $actual = Invoke-AzCli keyvault secret show --vault-name $KeyVaultName --name $secretName --query value --output tsv
        } catch {
            $actual = ""
        }

        if ([string]$expected -ne [string]$actual) {
            $drift += [pscustomobject]@{
                env = $envName
                secretName = $secretName
                type = if ([string]::IsNullOrWhiteSpace($actual)) { "missing" } else { "mismatch" }
            }
        }
    }

    return $drift
}

Require-AzureCli

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourcePath = $SourceEnvFile
if ([string]::IsNullOrWhiteSpace($sourcePath)) {
    foreach ($candidate in @(
        (Join-Path $repoRoot "server\.env.azure-secrets"),
        (Join-Path $repoRoot "server\.env")
    )) {
        if (Test-Path $candidate) {
            $sourcePath = $candidate
            break
        }
    }
}

$sourceValues = Read-EnvFile -Path $sourcePath
$plan = Get-PlanFromSyncScript
$expectedSecretEnvNames = @(
    $plan.services | ForEach-Object {
        foreach ($bound in $_.boundSecrets) {
            [string]$bound.env
        }
    } | Sort-Object -Unique
)

$serviceReports = @()
$totalDriftCount = 0
foreach ($service in $plan.services) {
    $appName = Get-ServiceAppName -ServiceKey $service.key
    $actual = Get-ActualContainerAppState -AppName $appName

    $expectedEnv = Parse-EnvArgs -Items @($service.envArgs)
    $envDrift = Compare-Maps -Expected $expectedEnv -Actual $actual.Env

    $expectedSecrets = Parse-SecretArgs -Items @($service.secretArgs)
    $secretDrift = @()
    foreach ($alias in $expectedSecrets.Keys) {
        $expectedSecret = $expectedSecrets[$alias]
        if (-not $actual.Secrets.Contains($alias)) {
            $secretDrift += [pscustomobject]@{ type = "missing"; alias = $alias; secretName = $expectedSecret["keyvaultref"] }
            continue
        }
        $actualSecret = $actual.Secrets[$alias]
        if ($actualSecret.keyVaultUrl -ne $expectedSecret["keyvaultref"]) {
            $secretDrift += [pscustomobject]@{
                type = "mismatch"
                alias = $alias
                expected = $expectedSecret["keyvaultref"]
                actual = $actualSecret.keyVaultUrl
            }
        }
    }

    $serviceReports += [pscustomobject]@{
        service = $service.key
        appName = $appName
        envDrift = $envDrift
        secretRefDrift = $secretDrift
    }
    $totalDriftCount += $envDrift.Count + $secretDrift.Count
}

$keyVaultDrift = Get-KeyVaultValueDrift -SourceValues $sourceValues -ExpectedSecretEnvNames $expectedSecretEnvNames
$totalDriftCount += $keyVaultDrift.Count

$report = [ordered]@{
    sourceEnvFile = $sourcePath
    resourceGroup = $ResourceGroup
    keyVaultName = $KeyVaultName
    totalDriftCount = $totalDriftCount
    services = $serviceReports
    keyVaultValueDrift = $keyVaultDrift
}

if ($ReportOutputPath) {
    $reportDir = Split-Path -Parent $ReportOutputPath
    if ($reportDir) {
        New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    }
    ($report | ConvertTo-Json -Depth 10) | Set-Content -Path $ReportOutputPath -Encoding UTF8
}

if ($totalDriftCount -gt 0) {
    $report | ConvertTo-Json -Depth 10
    throw "Azure runtime drift detected."
}

Write-Host "Azure runtime matches the local source model." -ForegroundColor Green
