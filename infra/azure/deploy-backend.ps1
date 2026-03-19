param(
    [string]$SubscriptionId = "",
    [string]$ResourceGroup = "rg-aura-prod",
    [string]$Location = "southeastasia",
    [string]$Prefix = "aura-msi-20260318",
    [string]$FrontendOrigin = "https://app-plum-iota.vercel.app",
    [string]$ApiPublicUrl = "",
    [string]$SecretsEnvFile = "",
    [string]$PlanSku = "B1",
    [string]$RedisSku = "Basic",
    [string]$RedisVmSize = "c0",
    [string]$RedisName = "",
    [switch]$SkipDeploy,
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

$script:AzCliPath = $null
$script:AzCliMode = "cmd"
$script:SecretKeys = @(
    "MONGO_URI",
    "REDIS_URL",
    "CRON_SECRET",
    "METRICS_SECRET",
    "FIREBASE_SERVICE_ACCOUNT",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_CLIENT_EMAIL",
    "AUTH_VAULT_SECRET",
    "AUTH_VAULT_PREVIOUS_SECRETS",
    "UPLOAD_SIGNING_SECRET",
    "OTP_FLOW_SECRET",
    "OTP_CHALLENGE_SECRET",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "SIMULATED_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "GMAIL_APP_PASSWORD",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "TWILIO_WHATSAPP_FROM",
    "GROQ_API_KEY",
    "VOYAGE_API_KEY",
    "ELEVENLABS_API_KEY",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "AZURE_STORAGE_CONNECTION_STRING"
)
$script:GeneratedSecretKeys = @(
    "AUTH_VAULT_SECRET",
    "UPLOAD_SIGNING_SECRET",
    "OTP_FLOW_SECRET",
    "OTP_CHALLENGE_SECRET",
    "CRON_SECRET",
    "METRICS_SECRET"
)

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

    $candidates = @(
        "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
        "C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            $script:AzCliMode = "cmd"
            return $candidate
        }
    }

    throw "Azure CLI is not installed. Install Azure CLI, run 'az login', then rerun this script."
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
    $env:Path = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;$env:Path"

    $null = Invoke-AzCli account show --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI is not authenticated. Run 'az login' first."
    }

    if ($SubscriptionId) {
        Invoke-AzCli account set --subscription $SubscriptionId | Out-Null
    }

    Invoke-AzCli config set extension.use_dynamic_install=yes_without_prompt | Out-Null
}

function Ensure-ResourceProvider {
    param([string]$Namespace)

    $state = Invoke-AzCli provider show -n $Namespace --query registrationState --output tsv
    if ($state -ne "Registered") {
        Write-Host "Registering resource provider $Namespace..." -ForegroundColor Cyan
        Invoke-AzCli provider register -n $Namespace --wait | Out-Null
    }
}

function Ensure-RoleAssignment {
    param(
        [string]$Scope,
        [string]$RoleName,
        [string]$PrincipalObjectId,
        [string]$PrincipalType
    )

    $existing = Invoke-AzCli role assignment list `
        --scope $Scope `
        --assignee-object-id $PrincipalObjectId `
        --query "[?roleDefinitionName=='$RoleName'].id | [0]" `
        --output tsv

    if (-not [string]::IsNullOrWhiteSpace($existing)) {
        return
    }

    Invoke-AzCli role assignment create `
        --scope $Scope `
        --assignee-object-id $PrincipalObjectId `
        --assignee-principal-type $PrincipalType `
        --role $RoleName | Out-Null
}

function Remove-MalformedAppSettings {
    param(
        [string]$ResourceGroupName,
        [string]$AppName
    )

    $settingsJson = Invoke-AzCli webapp config appsettings list --resource-group $ResourceGroupName --name $AppName --output json
    $settings = @()
    if (-not [string]::IsNullOrWhiteSpace($settingsJson)) {
        $settings = $settingsJson | ConvertFrom-Json
    }

    $toDelete = @()
    foreach ($setting in $settings) {
        if ([string]$setting.value -match '\s[A-Z0-9_]+=') {
            $toDelete += [string]$setting.name
        }
    }

    if ($toDelete.Count -eq 0) {
        return
    }

    Write-Host "Removing malformed app settings from $AppName..." -ForegroundColor Cyan
    $deleteArgs = @("webapp", "config", "appsettings", "delete", "--resource-group", $ResourceGroupName, "--name", $AppName, "--setting-names") + $toDelete
    Invoke-AzCli @deleteArgs | Out-Null
}

function Convert-EnvNameToSecretName {
    param([string]$EnvName)
    return $EnvName.Trim().ToLower().Replace("_", "-")
}

function Read-EnvFile {
    param([string]$Path)

    $map = [ordered]@{}
    if (-not $Path -or -not (Test-Path $Path)) {
        return $map
    }

    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $parts = $line -split "=", 2
        if ($parts.Count -ne 2) { return }
        $key = $parts[0].Trim()
        $value = $parts[1]
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if ($key -eq "FIREBASE_SERVICE_ACCOUNT" -and $value.Contains('\"')) {
            $placeholder = "__AURA_ESCAPED_NEWLINE__"
            $value = $value.Replace('\\n', $placeholder)
            $value = $value.Replace('\n', [Environment]::NewLine)
            $value = $value.Replace('\"', '"')
            $value = $value.Replace($placeholder, '\n')
        }

        if ($key) {
            $map[$key] = $value
        }
    }

    return $map
}

function Parse-Boolean {
    param(
        [string]$Value,
        [bool]$Fallback = $false
    )

    if ($null -eq $Value -or $Value -eq "") {
        return $Fallback
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    if ($normalized -in @("1", "true", "yes", "on")) {
        return $true
    }
    if ($normalized -in @("0", "false", "no", "off")) {
        return $false
    }

    return $Fallback
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

function New-RandomSecret {
    param([int]$Bytes = 48)

    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($buffer).TrimEnd("=")
}

function Set-IfMissing {
    param(
        [hashtable]$Map,
        [string]$Key,
        [string]$Value
    )

    if (-not $Map.Contains($Key) -or [string]::IsNullOrWhiteSpace([string]$Map[$Key])) {
        $Map[$Key] = $Value
    }
}

function Read-FrontendEnvFallbacks {
    param([string]$RepositoryRoot)

    $result = [ordered]@{}
    $candidates = @(
        (Join-Path $RepositoryRoot "app\.env.local"),
        (Join-Path $RepositoryRoot "app\.env")
    )

    foreach ($candidate in $candidates) {
        $values = Read-EnvFile -Path $candidate
        foreach ($entry in $values.GetEnumerator()) {
            if (-not $result.Contains($entry.Key)) {
                $result[$entry.Key] = $entry.Value
            }
        }
    }

    return $result
}

function Get-SourceEnvValues {
    param(
        [string]$EnvFilePath,
        [string]$RepositoryRoot
    )

    $values = Read-EnvFile -Path $EnvFilePath
    $frontendValues = Read-FrontendEnvFallbacks -RepositoryRoot $RepositoryRoot

    Set-IfMissing -Map $values -Key "FIREBASE_PROJECT_ID" -Value (Trim-OrDefault $frontendValues["VITE_FIREBASE_PROJECT_ID"])
    Set-IfMissing -Map $values -Key "ORDER_EMAIL_FROM_ADDRESS" -Value (Trim-OrDefault $values["GMAIL_USER"])
    Set-IfMissing -Map $values -Key "ORDER_EMAIL_REPLY_TO" -Value (Trim-OrDefault $values["GMAIL_USER"])
    Set-IfMissing -Map $values -Key "ORDER_EMAIL_ALERT_TO" -Value (Trim-OrDefault $values["GMAIL_USER"])

    return $values
}

function Add-GeneratedSecretsIfMissing {
    param([hashtable]$Values)

    foreach ($key in $script:GeneratedSecretKeys) {
        Set-IfMissing -Map $Values -Key $key -Value (New-RandomSecret)
    }
}

function Get-MissingCriticalSecrets {
    param([hashtable]$Values)

    $missing = @()

    if ([string]::IsNullOrWhiteSpace([string]$Values["MONGO_URI"])) {
        $missing += "MONGO_URI"
    }

    $hasFirebaseServiceAccount = -not [string]::IsNullOrWhiteSpace([string]$Values["FIREBASE_SERVICE_ACCOUNT"])
    $hasFirebaseDiscreteFields = (-not [string]::IsNullOrWhiteSpace([string]$Values["FIREBASE_PRIVATE_KEY"])) `
        -and (-not [string]::IsNullOrWhiteSpace([string]$Values["FIREBASE_CLIENT_EMAIL"])) `
        -and (-not [string]::IsNullOrWhiteSpace([string]$Values["FIREBASE_PROJECT_ID"]))

    if (-not $hasFirebaseServiceAccount -and -not $hasFirebaseDiscreteFields) {
        $missing += "FIREBASE_SERVICE_ACCOUNT or FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL + FIREBASE_PROJECT_ID"
    }

    $paymentsEnabled = Parse-Boolean -Value $Values["PAYMENTS_ENABLED"] -Fallback $true
    $paymentProvider = Trim-OrDefault $Values["PAYMENT_PROVIDER"] "razorpay"
    if ($paymentsEnabled -and $paymentProvider.ToLowerInvariant() -eq "razorpay") {
        foreach ($key in @("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET")) {
            if ([string]::IsNullOrWhiteSpace([string]$Values[$key])) {
                $missing += $key
            }
        }
    }

    return $missing
}

function Apply-Overrides {
    param(
        [hashtable]$Settings,
        [string]$KeyVaultName,
        [string]$ApiUrl,
        [string]$FrontendUrl
    )

    $overrides = @{
        "APP_PUBLIC_URL" = $ApiUrl
        "FRONTEND_URL" = $FrontendUrl
        "CORS_ORIGIN" = $FrontendUrl
    }

    foreach ($entry in $overrides.GetEnumerator()) {
        if ($Settings.Contains($entry.Key)) {
            $Settings[$entry.Key] = $entry.Value
        }
    }

    $keys = @($Settings.Keys)
    foreach ($key in $keys) {
        $Settings[$key] = $Settings[$key] `
            -replace [regex]::Escape("<keyvault-name>"), $KeyVaultName `
            -replace [regex]::Escape("https://api.example.com"), $ApiUrl `
            -replace [regex]::Escape("https://app.example.com"), $FrontendUrl
    }

    return $Settings
}

function Apply-RuntimeOverrides {
    param(
        [hashtable]$ApiSettings,
        [hashtable]$WorkerSettings,
        [hashtable]$SourceValues
    )

    $sharedKeys = @(
        "FIREBASE_PROJECT_ID",
        "GMAIL_USER",
        "LIVEKIT_URL",
        "ELEVENLABS_VOICE_ID",
        "ORDER_EMAIL_FROM_ADDRESS",
        "ORDER_EMAIL_REPLY_TO",
        "ORDER_EMAIL_ALERT_TO",
        "TWILIO_WHATSAPP_FROM",
        "TWILIO_STATUS_CALLBACK_URL",
        "AI_DEFAULT_LOCALE"
    )

    foreach ($key in $sharedKeys) {
        $value = Trim-OrDefault $SourceValues[$key]
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($ApiSettings.Contains($key)) {
            $ApiSettings[$key] = $value
        }
        if ($WorkerSettings.Contains($key)) {
            $WorkerSettings[$key] = $value
        }
    }

    $sourceMirroredKeys = @(
        "PAYMENTS_ENABLED",
        "PAYMENT_PROVIDER",
        "PAYMENT_WEBHOOKS_ENABLED",
        "PAYMENT_CHALLENGE_ENABLED",
        "PAYMENT_DYNAMIC_ROUTING_ENABLED",
        "PAYMENT_SAVED_METHODS_ENABLED",
        "PAYMENT_REFUNDS_ENABLED",
        "PAYMENT_RISK_MODE",
        "PAYMENT_CAPTURE_MODE",
        "ORDER_EMAILS_ENABLED",
        "ORDER_EMAIL_PROVIDER",
        "OTP_SMS_ENABLED",
        "OTP_SMS_PROVIDER",
        "OTP_WHATSAPP_ENABLED",
        "CATALOG_IMPORTS_ENABLED",
        "CATALOG_SYNC_ENABLED",
        "CATALOG_DEFAULT_SYNC_PROVIDER",
        "CATALOG_PROVIDER_SOURCE_REF",
        "CATALOG_PROVIDER_MANIFEST_REF",
        "CATALOG_PUBLIC_DEMO_FALLBACK",
        "CATALOG_READINESS_REQUIRE_PUBLISHED",
        "CATALOG_SEARCH_CHECK_ON_BOOT",
        "CATALOG_SEARCH_INDEX_NAME",
        "COMMERCE_RECONCILIATION_ENABLED",
        "COMMERCE_RECONCILIATION_POLL_MS",
        "ACTIVITY_EMAILS_ENABLED",
        "ACTIVITY_EMAIL_COOLDOWN_SEC",
        "ACTIVITY_EMAIL_MAX_HIGHLIGHTS",
        "ACTIVITY_EMAIL_EXCLUDED_PATHS",
        "ACTIVITY_EMAIL_CTA_URL"
    )

    foreach ($key in $sourceMirroredKeys) {
        if (-not $SourceValues.Contains($key)) {
            continue
        }

        $value = [string]$SourceValues[$key]
        if ($null -eq $value) {
            continue
        }

        if ($ApiSettings.Contains($key)) {
            $ApiSettings[$key] = $value
        }
        if ($WorkerSettings.Contains($key)) {
            $WorkerSettings[$key] = $value
        }
    }

    $hasResend = -not [string]::IsNullOrWhiteSpace([string]$SourceValues["RESEND_API_KEY"])
    $hasGmail = (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["GMAIL_USER"])) `
        -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["GMAIL_APP_PASSWORD"]))

    if ($hasResend) {
        $ApiSettings["ORDER_EMAIL_PROVIDER"] = "resend"
        $WorkerSettings["ORDER_EMAIL_PROVIDER"] = "resend"
    } elseif ($hasGmail) {
        $ApiSettings["ORDER_EMAIL_PROVIDER"] = "gmail"
        $WorkerSettings["ORDER_EMAIL_PROVIDER"] = "gmail"
    } else {
        $ApiSettings["ORDER_EMAILS_ENABLED"] = "false"
        $WorkerSettings["ORDER_EMAILS_ENABLED"] = "false"
    }

    $hasTwilio = (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_ACCOUNT_SID"])) `
        -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_AUTH_TOKEN"])) `
        -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_FROM_NUMBER"]))

    if (-not $hasTwilio) {
        $ApiSettings["OTP_SMS_ENABLED"] = "false"
        $WorkerSettings["OTP_SMS_ENABLED"] = "false"
        $ApiSettings["OTP_WHATSAPP_ENABLED"] = "false"
        $WorkerSettings["OTP_WHATSAPP_ENABLED"] = "false"
    }

    return @{
        ApiSettings = $ApiSettings
        WorkerSettings = $WorkerSettings
    }
}

function Convert-SettingsToCliArgs {
    param([hashtable]$Settings)

    $args = @()
    foreach ($entry in $Settings.GetEnumerator()) {
        $args += "$($entry.Key)=$($entry.Value)"
    }
    return $args
}

function Import-SecretsToKeyVault {
    param(
        [string]$KeyVaultName,
        [hashtable]$Values
    )

    foreach ($key in $script:SecretKeys) {
        $value = Trim-OrDefault $Values[$key]
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        $secretName = Convert-EnvNameToSecretName -EnvName $key
        if ($value.Contains([Environment]::NewLine)) {
            $tempSecretFile = Join-Path $env:TEMP ("aura-secret-" + [Guid]::NewGuid().ToString("N") + ".txt")
            try {
                [System.IO.File]::WriteAllText($tempSecretFile, $value, [System.Text.Encoding]::UTF8)
                Invoke-AzCli keyvault secret set --vault-name $KeyVaultName --name $secretName --file $tempSecretFile --encoding utf-8 | Out-Null
            } finally {
                Remove-Item $tempSecretFile -Force -ErrorAction SilentlyContinue
            }
        } else {
            Invoke-AzCli keyvault secret set --vault-name $KeyVaultName --name $secretName --value $value | Out-Null
        }
    }
}

function Ensure-RedisUrl {
    param(
        [hashtable]$Values,
        [string]$CacheName,
        [string]$GroupName,
        [string]$AzureLocation
    )

    if (-not [string]::IsNullOrWhiteSpace([string]$Values["REDIS_URL"])) {
        return $Values["REDIS_URL"]
    }

    $existingRedis = ""
    try {
        $existingRedis = Invoke-AzCli redis show --name $CacheName --resource-group $GroupName --query name --output tsv
    } catch {
        $existingRedis = ""
    }

    if ([string]::IsNullOrWhiteSpace($existingRedis)) {
        Write-Host "Registering Microsoft.Cache provider..." -ForegroundColor Cyan
        Invoke-AzCli provider register -n Microsoft.Cache --wait | Out-Null

        Write-Host "Creating Azure Cache for Redis..." -ForegroundColor Cyan
        Invoke-AzCli redis create `
            --name $CacheName `
            --resource-group $GroupName `
            --location $AzureLocation `
            --sku $RedisSku `
            --vm-size $RedisVmSize `
            --minimum-tls-version 1.2 | Out-Null
    } else {
        Write-Host "Using existing Azure Cache for Redis $CacheName." -ForegroundColor Cyan
    }

    $redisHost = Invoke-AzCli redis show --name $CacheName --resource-group $GroupName --query hostName --output tsv
    $redisPrimaryKey = Invoke-AzCli redis list-keys --name $CacheName --resource-group $GroupName --query primaryKey --output tsv

    if ([string]::IsNullOrWhiteSpace($redisHost) -or [string]::IsNullOrWhiteSpace($redisPrimaryKey)) {
        throw "Failed to provision Azure Redis or resolve its connection details."
    }

    $Values["REDIS_URL"] = "rediss://:$redisPrimaryKey@$redisHost:6380"
    return $Values["REDIS_URL"]
}

function New-ServerPackageZip {
    param(
        [string]$RepositoryRoot,
        [hashtable]$SourceValues
    )

    $serverRoot = Join-Path $RepositoryRoot "server"
    $tempRoot = Join-Path $env:TEMP "aura-azure-deploy"
    $stagingRoot = Join-Path $tempRoot "server-package"
    $zipPath = Join-Path $tempRoot "server-package.zip"

    if (Test-Path $stagingRoot) {
        Remove-Item $stagingRoot -Recurse -Force
    }
    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }

    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

    $robocopyArgs = @(
        $serverRoot,
        $stagingRoot,
        "/MIR",
        "/XD", "node_modules", "coverage", ".cache", ".mongodb-binaries", ".run-logs", ".vercel", "tests", "data", "generated", "seeders",
        "/XF", ".env", ".env.azure-secrets", ".env.azure-secrets.example", "dev-server.log", "server-dev.log", "test_output.log", "test_output.txt", "test_results.json", "network_reset_instructions.md", "reset_network.ps1", "Dockerfile"
    )

    robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Failed to stage server package with robocopy."
    }

    Get-ChildItem -Path $stagingRoot -Recurse -File -Include 'test_output*', '*.log', '*.md' |
        Remove-Item -Force -ErrorAction SilentlyContinue

    $catalogRefs = @(
        Trim-OrDefault $SourceValues["CATALOG_PROVIDER_SOURCE_REF"],
        Trim-OrDefault $SourceValues["CATALOG_PROVIDER_MANIFEST_REF"]
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($catalogRef in $catalogRefs) {
        if ($catalogRef -match '^(?i)https?://') {
            continue
        }

        $candidatePaths = @(
            $catalogRef,
            (Join-Path $serverRoot $catalogRef),
            (Join-Path $serverRoot "data\$catalogRef"),
            (Join-Path $RepositoryRoot $catalogRef)
        ) | ForEach-Object {
            try {
                [System.IO.Path]::GetFullPath($_)
            } catch {
                $null
            }
        } | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

        foreach ($candidatePath in $candidatePaths) {
            $relativePath = [System.IO.Path]::GetRelativePath($serverRoot, $candidatePath)
            if ($relativePath.StartsWith("..")) {
                $targetPath = Join-Path $stagingRoot (Split-Path -Leaf $candidatePath)
            } else {
                $targetPath = Join-Path $stagingRoot $relativePath
            }

            $targetDir = Split-Path -Parent $targetPath
            if ($targetDir) {
                New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
            }

            Copy-Item -Path $candidatePath -Destination $targetPath -Force
        }
    }

    Push-Location $stagingRoot
    try {
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npmCommand) {
            $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
        }
        if (-not $npmCommand) {
            throw "npm is required to build the production server package."
        }

        $originalNodeEnv = $env:NODE_ENV
        $env:NODE_ENV = "production"
        & $npmCommand.Source ci --omit=dev --no-audit --no-fund | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install production node_modules for Azure deployment package."
        }
    } finally {
        $env:NODE_ENV = $originalNodeEnv
        Pop-Location
    }

    Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath -Force
    return $zipPath
}

Require-AzureCli

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptRoot)
$ApiSettingsPath = Join-Path $ScriptRoot "server-api.appsettings.example.env"
$WorkerSettingsPath = Join-Path $ScriptRoot "server-worker.appsettings.example.env"

$apiAppName = "$Prefix-api"
$workerAppName = "$Prefix-worker"
$appServicePlan = "$Prefix-asp"
$keyVaultName = ($Prefix + "-kv").ToLower()
$storageAccountName = (($Prefix -replace "[^a-zA-Z0-9]", "") + "media").ToLower()
if ($storageAccountName.Length -gt 24) {
    $storageAccountName = $storageAccountName.Substring(0, 24)
}
$redisCacheName = if ($RedisName) { $RedisName } else { "$Prefix-redis" }
$appInsightsName = "$Prefix-appi"
$apiUrl = if ($ApiPublicUrl) { $ApiPublicUrl } else { "https://$apiAppName.azurewebsites.net" }

$defaultSecretsEnvFile = Join-Path $RepoRoot "server\.env.azure-secrets"
if ([string]::IsNullOrWhiteSpace($SecretsEnvFile) -and (Test-Path $defaultSecretsEnvFile)) {
    $SecretsEnvFile = $defaultSecretsEnvFile
}

$sourceValues = Get-SourceEnvValues -EnvFilePath $SecretsEnvFile -RepositoryRoot $RepoRoot
Add-GeneratedSecretsIfMissing -Values $sourceValues
$missingCriticalSecrets = Get-MissingCriticalSecrets -Values $sourceValues

if ($missingCriticalSecrets.Count -gt 0) {
    Write-Host "" -ForegroundColor Yellow
    Write-Host "Deployment readiness check failed." -ForegroundColor Yellow
    Write-Host "The following production secrets must be supplied before Azure resource creation:" -ForegroundColor Yellow
    foreach ($secret in $missingCriticalSecrets) {
        Write-Host " - $secret" -ForegroundColor Yellow
    }
    throw "Refusing to create billable Azure resources while production secrets are incomplete."
}

if ($ValidateOnly) {
    Write-Host "Azure backend validation passed." -ForegroundColor Green
    Write-Host "Ready resource prefix: $Prefix"
    exit 0
}

Write-Host "Creating Azure resource group..." -ForegroundColor Cyan
$existingGroupLocation = ""
try {
    $existingGroupLocation = Invoke-AzCli group show --name $ResourceGroup --query location --output tsv
} catch {
    $existingGroupLocation = ""
}

if ([string]::IsNullOrWhiteSpace($existingGroupLocation)) {
    Invoke-AzCli group create --name $ResourceGroup --location $Location | Out-Null
} else {
    Write-Host "Using existing resource group $ResourceGroup in $existingGroupLocation." -ForegroundColor Cyan
}

foreach ($namespace in @("Microsoft.Web", "Microsoft.Insights", "Microsoft.OperationalInsights", "Microsoft.KeyVault", "Microsoft.Storage", "Microsoft.Cache")) {
    Ensure-ResourceProvider -Namespace $namespace
}

$redisUrl = Ensure-RedisUrl -Values $sourceValues -CacheName $redisCacheName -GroupName $ResourceGroup -AzureLocation $Location

Write-Host "Creating App Service plan..." -ForegroundColor Cyan
$existingPlan = ""
try {
    $existingPlan = Invoke-AzCli appservice plan show --name $appServicePlan --resource-group $ResourceGroup --query name --output tsv
} catch {
    $existingPlan = ""
}
if ([string]::IsNullOrWhiteSpace($existingPlan)) {
    Invoke-AzCli appservice plan create --name $appServicePlan --resource-group $ResourceGroup --location $Location --sku $PlanSku --is-linux | Out-Null
} else {
    Write-Host "Using existing App Service plan $appServicePlan." -ForegroundColor Cyan
}

Write-Host "Creating Application Insights..." -ForegroundColor Cyan
$existingAppInsights = ""
try {
    $existingAppInsights = Invoke-AzCli monitor app-insights component show --app $appInsightsName --resource-group $ResourceGroup --query appId --output tsv
} catch {
    $existingAppInsights = ""
}
if ([string]::IsNullOrWhiteSpace($existingAppInsights)) {
    Invoke-AzCli monitor app-insights component create --app $appInsightsName --location $Location --resource-group $ResourceGroup --kind web --application-type web | Out-Null
} else {
    Write-Host "Using existing Application Insights $appInsightsName." -ForegroundColor Cyan
}
$appInsightsConnectionString = Invoke-AzCli monitor app-insights component show --app $appInsightsName --resource-group $ResourceGroup --query connectionString --output tsv

Write-Host "Creating Key Vault..." -ForegroundColor Cyan
$existingKeyVault = ""
try {
    $existingKeyVault = Invoke-AzCli keyvault show --name $keyVaultName --resource-group $ResourceGroup --query name --output tsv
} catch {
    $existingKeyVault = ""
}
if ([string]::IsNullOrWhiteSpace($existingKeyVault)) {
    Invoke-AzCli keyvault create --name $keyVaultName --resource-group $ResourceGroup --location $Location --sku standard | Out-Null
} else {
    Write-Host "Using existing Key Vault $keyVaultName." -ForegroundColor Cyan
}
$keyVaultId = Invoke-AzCli keyvault show --name $keyVaultName --resource-group $ResourceGroup --query id --output tsv
$signedInUserObjectId = Invoke-AzCli ad signed-in-user show --query id --output tsv
if (-not [string]::IsNullOrWhiteSpace($signedInUserObjectId)) {
    Write-Host "Granting current user Key Vault secrets access..." -ForegroundColor Cyan
    Ensure-RoleAssignment -Scope $keyVaultId -RoleName "Key Vault Secrets Officer" -PrincipalObjectId $signedInUserObjectId -PrincipalType "User"
    Start-Sleep -Seconds 15
}

Write-Host "Creating Storage Account and review-media container..." -ForegroundColor Cyan
$existingStorage = ""
try {
    $existingStorage = Invoke-AzCli storage account show --name $storageAccountName --resource-group $ResourceGroup --query name --output tsv
} catch {
    $existingStorage = ""
}
if ([string]::IsNullOrWhiteSpace($existingStorage)) {
    Invoke-AzCli storage account create --name $storageAccountName --resource-group $ResourceGroup --location $Location --sku Standard_LRS --kind StorageV2 | Out-Null
} else {
    Write-Host "Using existing Storage account $storageAccountName." -ForegroundColor Cyan
}
$azureStorageConnectionString = Invoke-AzCli storage account show-connection-string --name $storageAccountName --resource-group $ResourceGroup --query connectionString --output tsv
Invoke-AzCli storage container create --account-name $storageAccountName --name review-media --auth-mode login | Out-Null

$sourceValues["REDIS_URL"] = $redisUrl
$sourceValues["AZURE_STORAGE_CONNECTION_STRING"] = $azureStorageConnectionString

Write-Host "Importing available secrets into Key Vault..." -ForegroundColor Cyan
Import-SecretsToKeyVault -KeyVaultName $keyVaultName -Values $sourceValues

Write-Host "Creating API and worker web apps..." -ForegroundColor Cyan
foreach ($webAppName in @($apiAppName, $workerAppName)) {
    $existingWebApp = ""
    try {
        $existingWebApp = Invoke-AzCli webapp show --resource-group $ResourceGroup --name $webAppName --query name --output tsv
    } catch {
        $existingWebApp = ""
    }

    if ([string]::IsNullOrWhiteSpace($existingWebApp)) {
        Invoke-AzCli webapp create --resource-group $ResourceGroup --plan $appServicePlan --name $webAppName --runtime "NODE|22-lts" | Out-Null
    } else {
        Write-Host "Using existing web app $webAppName." -ForegroundColor Cyan
    }
}

foreach ($appName in @($apiAppName, $workerAppName)) {
    Invoke-AzCli webapp identity assign --resource-group $ResourceGroup --name $appName | Out-Null
    $principalId = Invoke-AzCli webapp identity show --resource-group $ResourceGroup --name $appName --query principalId --output tsv
    if ($principalId) {
        Ensure-RoleAssignment -Scope $keyVaultId -RoleName "Key Vault Secrets User" -PrincipalObjectId $principalId -PrincipalType "ServicePrincipal"
    }
}

$apiSettings = Read-EnvFile -Path $ApiSettingsPath
$workerSettings = Read-EnvFile -Path $WorkerSettingsPath

$apiSettings["APPLICATIONINSIGHTS_CONNECTION_STRING"] = $appInsightsConnectionString
$workerSettings["APPLICATIONINSIGHTS_CONNECTION_STRING"] = $appInsightsConnectionString
$apiSettings["SCM_DO_BUILD_DURING_DEPLOYMENT"] = "false"
$workerSettings["SCM_DO_BUILD_DURING_DEPLOYMENT"] = "false"
$apiSettings["WEBSITES_PORT"] = "8080"
$workerSettings["WEBSITES_PORT"] = "8080"

$apiSettings = Apply-Overrides -Settings $apiSettings -KeyVaultName $keyVaultName -ApiUrl $apiUrl -FrontendUrl $FrontendOrigin
$workerSettings = Apply-Overrides -Settings $workerSettings -KeyVaultName $keyVaultName -ApiUrl $apiUrl -FrontendUrl $FrontendOrigin

$runtimeOverrides = Apply-RuntimeOverrides -ApiSettings $apiSettings -WorkerSettings $workerSettings -SourceValues $sourceValues
$apiSettings = $runtimeOverrides.ApiSettings
$workerSettings = $runtimeOverrides.WorkerSettings

Write-Host "Applying API app settings..." -ForegroundColor Cyan
Remove-MalformedAppSettings -ResourceGroupName $ResourceGroup -AppName $apiAppName
$apiAppSettingsArgs = @("webapp", "config", "appsettings", "set", "--resource-group", $ResourceGroup, "--name", $apiAppName, "--settings") + (Convert-SettingsToCliArgs -Settings $apiSettings)
Invoke-AzCli @apiAppSettingsArgs | Out-Null
Invoke-AzCli webapp config set --resource-group $ResourceGroup --name $apiAppName --startup-file "npm start" --always-on true --web-sockets-enabled true | Out-Null

Write-Host "Applying worker app settings..." -ForegroundColor Cyan
Remove-MalformedAppSettings -ResourceGroupName $ResourceGroup -AppName $workerAppName
$workerAppSettingsArgs = @("webapp", "config", "appsettings", "set", "--resource-group", $ResourceGroup, "--name", $workerAppName, "--settings") + (Convert-SettingsToCliArgs -Settings $workerSettings)
Invoke-AzCli @workerAppSettingsArgs | Out-Null
Invoke-AzCli webapp config set --resource-group $ResourceGroup --name $workerAppName --startup-file "npm run start:workers" --always-on true | Out-Null

if (-not $SkipDeploy) {
    Write-Host "Packaging server source..." -ForegroundColor Cyan
    $packageZip = New-ServerPackageZip -RepositoryRoot $RepoRoot -SourceValues $sourceValues

    Write-Host "Deploying API package..." -ForegroundColor Cyan
    Invoke-AzCli webapp deploy --resource-group $ResourceGroup --name $apiAppName --src-path $packageZip --type zip --clean true --restart true --track-status false | Out-Null

    Write-Host "Deploying worker package..." -ForegroundColor Cyan
    Invoke-AzCli webapp deploy --resource-group $ResourceGroup --name $workerAppName --src-path $packageZip --type zip --clean true --restart true --track-status false | Out-Null
}

Write-Host ""
Write-Host "Azure backend provisioning finished." -ForegroundColor Green
Write-Host "API URL: $apiUrl"
Write-Host "Worker app: https://$workerAppName.azurewebsites.net"
Write-Host "Key Vault: $keyVaultName"
Write-Host "Storage account: $storageAccountName"
Write-Host "Redis cache: $redisCacheName"
Write-Host ""
Write-Host "If you later rotate AUTH_VAULT_SECRET, preserve the old value in AUTH_VAULT_PREVIOUS_SECRETS." -ForegroundColor Yellow
