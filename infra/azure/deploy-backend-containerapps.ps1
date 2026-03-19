param(
    [string]$SubscriptionId = "",
    [string]$ResourceGroup = "rg-aura-prod",
    [string]$Location = "southeastasia",
    [string]$FrontendOrigin = "https://aurapilot.vercel.app",
    [string]$ApiPublicUrl = "",
    [string]$SecretsEnvFile = "C:\Users\mdsai\Downloads\aura-api.env",
    [string]$KeyVaultName = "aura-msi-20260318-kv",
    [string]$AppInsightsName = "aura-msi-20260318-appi",
    [string]$StorageAccountName = "auramsi20260318media",
    [string]$ContainerEnvName = "aura-msi-ca-env",
    [string]$RegistryName = "auramsi20260318acr",
    [string]$RegistrySku = "Standard",
    [string]$IdentityName = "aura-msi-backend-id",
    [string]$ApiAppName = "aura-msi-api-ca",
    [string]$WorkerAppName = "aura-msi-worker-ca",
    [int]$ApiMinReplicas = 1,
    [int]$ApiMaxReplicas = 3,
    [int]$WorkerMinReplicas = 1,
    [int]$WorkerMaxReplicas = 1,
    [bool]$UseBuildx = $true,
    [string]$ExistingImageRef = ""
)

$ErrorActionPreference = "Stop"

$script:AzCliPath = $null
$script:AzCliMode = "cmd"

$script:SecretAliases = [ordered]@{
    "MONGO_URI" = "mongo"
    "REDIS_URL" = "redis"
    "FIREBASE_SERVICE_ACCOUNT" = "fbsa"
    "AUTH_VAULT_SECRET" = "authvault"
    "AUTH_VAULT_PREVIOUS_SECRETS" = "authprev"
    "UPLOAD_SIGNING_SECRET" = "upsign"
    "OTP_FLOW_SECRET" = "otpflow"
    "OTP_CHALLENGE_SECRET" = "otpchall"
    "CRON_SECRET" = "cron"
    "METRICS_SECRET" = "metrics"
    "RAZORPAY_KEY_ID" = "rpayid"
    "RAZORPAY_KEY_SECRET" = "rpaysecret"
    "RAZORPAY_WEBHOOK_SECRET" = "rpayweb"
    "SIMULATED_WEBHOOK_SECRET" = "simweb"
    "RESEND_API_KEY" = "resend"
    "RESEND_WEBHOOK_SECRET" = "resendweb"
    "GMAIL_APP_PASSWORD" = "gmailapp"
    "TWILIO_ACCOUNT_SID" = "twiliosid"
    "TWILIO_AUTH_TOKEN" = "twiliotok"
    "TWILIO_FROM_NUMBER" = "twiliofrom"
    "TWILIO_WHATSAPP_FROM" = "twiliowhats"
    "GROQ_API_KEY" = "groq"
    "VOYAGE_API_KEY" = "voyage"
    "ELEVENLABS_API_KEY" = "eleven"
    "LIVEKIT_API_KEY" = "livekitkey"
    "LIVEKIT_API_SECRET" = "livekitsec"
    "AZURE_STORAGE_CONNECTION_STRING" = "storagecs"
}

$script:GeneratedSecretKeys = @(
    "AUTH_VAULT_SECRET",
    "UPLOAD_SIGNING_SECRET",
    "OTP_FLOW_SECRET",
    "OTP_CHALLENGE_SECRET",
    "CRON_SECRET",
    "METRICS_SECRET"
)

function Get-AppInsightsConnectionString {
    param(
        [string]$Name,
        [string]$GroupName
    )

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return ""
    }

    try {
        return (Invoke-AzCli monitor app-insights component show --app $Name --resource-group $GroupName --query connectionString --output tsv)
    } catch {
        return ""
    }
}

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

    throw "Azure CLI is not installed. Install Azure CLI and run 'az login' first."
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

        $map[$key] = $value
    }

    return $map
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

function Add-GeneratedSecretsIfMissing {
    param([hashtable]$Values)

    foreach ($key in $script:GeneratedSecretKeys) {
        Set-IfMissing -Map $Values -Key $key -Value (New-RandomSecret)
    }
}

function Ensure-StorageConnectionString {
    param(
        [hashtable]$Values,
        [string]$GroupName,
        [string]$AccountName
    )

    if (-not [string]::IsNullOrWhiteSpace([string]$Values["AZURE_STORAGE_CONNECTION_STRING"])) {
        return
    }

    $storageId = ""
    try {
        $storageId = Invoke-AzCli storage account show --name $AccountName --resource-group $GroupName --query id --output tsv
    } catch {
        $storageId = ""
    }

    if ([string]::IsNullOrWhiteSpace($storageId)) {
        throw "Azure storage account $AccountName was not found."
    }

    $storageKey = Invoke-AzCli storage account keys list --account-name $AccountName --resource-group $GroupName --query "[0].value" --output tsv
    if ([string]::IsNullOrWhiteSpace($storageKey)) {
        throw "Failed to resolve a storage account key for $AccountName."
    }

    $Values["AZURE_STORAGE_CONNECTION_STRING"] = "DefaultEndpointsProtocol=https;AccountName=$AccountName;AccountKey=$storageKey;EndpointSuffix=core.windows.net"
}

function Convert-EnvNameToSecretName {
    param([string]$EnvName)
    return $EnvName.Trim().ToLower().Replace("_", "-")
}

function Import-SecretsToKeyVault {
    param(
        [string]$VaultName,
        [hashtable]$Values
    )

    foreach ($entry in $script:SecretAliases.GetEnumerator()) {
        $envName = $entry.Key
        $value = Trim-OrDefault $Values[$envName]
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        $secretName = Convert-EnvNameToSecretName -EnvName $envName
        if ($value.Contains([Environment]::NewLine)) {
            $tempSecretFile = Join-Path $env:TEMP ("aura-secret-" + [Guid]::NewGuid().ToString("N") + ".txt")
            try {
                $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                [System.IO.File]::WriteAllText($tempSecretFile, $value, $utf8NoBom)
                Invoke-AzCli keyvault secret set --vault-name $VaultName --name $secretName --file $tempSecretFile --encoding utf-8 | Out-Null
            } finally {
                Remove-Item $tempSecretFile -Force -ErrorAction SilentlyContinue
            }
        } else {
            Invoke-AzCli keyvault secret set --vault-name $VaultName --name $secretName --value $value | Out-Null
        }
    }
}

function Ensure-RoleAssignment {
    param(
        [string]$Scope,
        [string]$RoleName,
        [string]$PrincipalObjectId,
        [string]$PrincipalType
    )

    $existing = Invoke-AzCli role assignment list --scope $Scope --assignee-object-id $PrincipalObjectId --query "[?roleDefinitionName=='$RoleName'].id | [0]" --output tsv
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
        return
    }

    Invoke-AzCli role assignment create --scope $Scope --assignee-object-id $PrincipalObjectId --assignee-principal-type $PrincipalType --role $RoleName | Out-Null
}

function Require-DockerEngine {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        throw "Docker CLI is not installed. Install Docker Desktop and rerun."
    }

    & $docker.Source version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker engine is not running. Start Docker Desktop and rerun."
    }
}

function Ensure-DockerBuilder {
    param([string]$BuilderName = "aura-builder")

    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        throw "Docker CLI is not installed. Install Docker Desktop and rerun."
    }

    & $docker.Source buildx inspect $BuilderName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        & $docker.Source buildx create --name $BuilderName --use --driver docker-container | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create Docker buildx builder $BuilderName."
        }
    } else {
        & $docker.Source buildx use $BuilderName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to select Docker buildx builder $BuilderName."
        }
    }

    & $docker.Source buildx inspect --bootstrap | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to bootstrap Docker buildx."
    }
}

function Build-And-Push-BackendImage {
    param(
        [string]$ImageRef,
        [string]$RepoRoot,
        [string]$RegistryLoginServer,
        [bool]$PreferBuildx
    )

    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        throw "Docker CLI is not installed. Install Docker Desktop and rerun."
    }

    $dockerFile = Join-Path $RepoRoot "server\Dockerfile"
    $buildContext = Join-Path $RepoRoot "server"

    if ($PreferBuildx) {
        Ensure-DockerBuilder

        $cacheRef = "$RegistryLoginServer/aura-backend:buildcache"
        $outputArg = "type=image,name=$ImageRef,push=true,compression=zstd,compression-level=3,force-compression=true"

        $buildxArgs = @(
            "buildx", "build",
            "--platform", "linux/amd64",
            "-f", $dockerFile,
            "--output", $outputArg,
            "--cache-from", "type=registry,ref=$cacheRef",
            "--cache-to", "type=registry,ref=$cacheRef,mode=max,compression=zstd",
            $buildContext
        )

        & $docker.Source @buildxArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to build and push backend Docker image with buildx."
        }

        return
    }

    $dockerArgs = @("build", "-f", $dockerFile, "-t", $ImageRef, $buildContext)
    & $docker.Source @dockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to build backend Docker image locally."
    }

    & $docker.Source push $ImageRef
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to push backend Docker image to ACR."
    }
}

function Apply-Overrides {
    param(
        [hashtable]$Settings,
        [string]$KeyVaultNameUnused,
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
        "AI_DEFAULT_LOCALE",
        "CORS_ORIGIN"
    )

    foreach ($key in $sharedKeys) {
        $value = Trim-OrDefault $SourceValues[$key]
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($ApiSettings.Contains($key)) { $ApiSettings[$key] = $value }
        if ($WorkerSettings.Contains($key)) { $WorkerSettings[$key] = $value }
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

        if ($ApiSettings.Contains($key)) { $ApiSettings[$key] = $value }
        if ($WorkerSettings.Contains($key)) { $WorkerSettings[$key] = $value }
    }

    $hasResend = -not [string]::IsNullOrWhiteSpace([string]$SourceValues["RESEND_API_KEY"])
    $hasGmail = (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["GMAIL_USER"])) -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["GMAIL_APP_PASSWORD"]))
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

    $hasTwilio = (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_ACCOUNT_SID"])) -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_AUTH_TOKEN"])) -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_FROM_NUMBER"]))
    if (-not $hasTwilio) {
        $ApiSettings["OTP_SMS_ENABLED"] = "false"
        $WorkerSettings["OTP_SMS_ENABLED"] = "false"
        $ApiSettings["OTP_WHATSAPP_ENABLED"] = "false"
        $WorkerSettings["OTP_WHATSAPP_ENABLED"] = "false"
    }

    if ([string]::IsNullOrWhiteSpace([string]$ApiSettings["ACTIVITY_EMAIL_CTA_URL"])) {
        $ApiSettings["ACTIVITY_EMAIL_CTA_URL"] = "$FrontendOrigin/profile"
    }

    return @{
        ApiSettings = $ApiSettings
        WorkerSettings = $WorkerSettings
    }
}

function Convert-SettingsToContainerEnvArgs {
    param(
        [hashtable]$Settings,
        [hashtable]$SourceValues
    )

    $args = @()
    foreach ($entry in $Settings.GetEnumerator()) {
        $key = [string]$entry.Key
        $value = [string]$entry.Value
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($script:SecretAliases.Contains($key)) {
            $sourceValue = ""
            if ($null -ne $SourceValues -and $SourceValues.Contains($key)) {
                $sourceValue = Trim-OrDefault $SourceValues[$key]
            }
            if ([string]::IsNullOrWhiteSpace($sourceValue)) {
                continue
            }
            $alias = $script:SecretAliases[$key]
            $args += "$key=secretref:$alias"
        } else {
            $args += "$key=$value"
        }
    }
    return $args
}

function Convert-SecretsToContainerSecretArgs {
    param(
        [hashtable]$Values,
        [string]$VaultName,
        [string]$IdentityResourceId
    )

    $args = @()
    foreach ($entry in $script:SecretAliases.GetEnumerator()) {
        $envName = $entry.Key
        $alias = $entry.Value
        $value = Trim-OrDefault $Values[$envName]
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        $secretName = Convert-EnvNameToSecretName -EnvName $envName
        $secretUrl = "https://$VaultName.vault.azure.net/secrets/$secretName"
        $args += "$alias=keyvaultref:$secretUrl,identityref:$IdentityResourceId"
    }
    return $args
}

Require-AzureCli

$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$ApiSettingsPath = Join-Path $PSScriptRoot "server-api.appsettings.example.env"
$WorkerSettingsPath = Join-Path $PSScriptRoot "server-worker.appsettings.example.env"

foreach ($namespace in @("Microsoft.App", "Microsoft.OperationalInsights", "Microsoft.ContainerRegistry", "Microsoft.ManagedIdentity", "Microsoft.KeyVault", "Microsoft.Storage")) {
    Ensure-ResourceProvider -Namespace $namespace
}

$sourceValues = Read-EnvFile -Path $SecretsEnvFile
Add-GeneratedSecretsIfMissing -Values $sourceValues
Ensure-StorageConnectionString -Values $sourceValues -GroupName $ResourceGroup -AccountName $StorageAccountName

Write-Host "Importing backend secrets into Key Vault..." -ForegroundColor Cyan
Import-SecretsToKeyVault -VaultName $KeyVaultName -Values $sourceValues

Write-Host "Creating or reusing Azure Container Registry..." -ForegroundColor Cyan
$acrId = ""
$currentAcrSku = ""
try {
    $acrId = Invoke-AzCli acr show --name $RegistryName --resource-group $ResourceGroup --query id --output tsv
    $currentAcrSku = Invoke-AzCli acr show --name $RegistryName --resource-group $ResourceGroup --query sku.name --output tsv
} catch {
    $acrId = ""
    $currentAcrSku = ""
}
if ([string]::IsNullOrWhiteSpace($acrId)) {
    Invoke-AzCli acr create --name $RegistryName --resource-group $ResourceGroup --sku $RegistrySku --location $Location | Out-Null
    $acrId = Invoke-AzCli acr show --name $RegistryName --resource-group $ResourceGroup --query id --output tsv
    $currentAcrSku = Invoke-AzCli acr show --name $RegistryName --resource-group $ResourceGroup --query sku.name --output tsv
} elseif (-not [string]::IsNullOrWhiteSpace($RegistrySku) -and $currentAcrSku -ne $RegistrySku) {
    Write-Host "Updating Azure Container Registry SKU from $currentAcrSku to $RegistrySku..." -ForegroundColor Cyan
    Invoke-AzCli acr update --name $RegistryName --resource-group $ResourceGroup --sku $RegistrySku | Out-Null
    $currentAcrSku = Invoke-AzCli acr show --name $RegistryName --resource-group $ResourceGroup --query sku.name --output tsv
}
$acrLoginServer = Invoke-AzCli acr show --name $RegistryName --resource-group $ResourceGroup --query loginServer --output tsv

Write-Host "Creating or reusing backend managed identity..." -ForegroundColor Cyan
$identityJson = $null
try {
    $identityJson = Invoke-AzCli identity show --name $IdentityName --resource-group $ResourceGroup --output json
} catch {
    $identityJson = $null
}
if ($null -eq $identityJson -or [string]::IsNullOrWhiteSpace([string]$identityJson)) {
    Invoke-AzCli identity create --name $IdentityName --resource-group $ResourceGroup --location $Location | Out-Null
    $identityJson = Invoke-AzCli identity show --name $IdentityName --resource-group $ResourceGroup --output json
}
$identity = $identityJson | ConvertFrom-Json
$identityId = $identity.id
$identityPrincipalId = $identity.principalId

$kvId = Invoke-AzCli keyvault show --name $KeyVaultName --resource-group $ResourceGroup --query id --output tsv
Ensure-RoleAssignment -Scope $kvId -RoleName "Key Vault Secrets User" -PrincipalObjectId $identityPrincipalId -PrincipalType "ServicePrincipal"
Ensure-RoleAssignment -Scope $acrId -RoleName "AcrPull" -PrincipalObjectId $identityPrincipalId -PrincipalType "ServicePrincipal"
Start-Sleep -Seconds 15

Write-Host "Creating or reusing Container Apps environment..." -ForegroundColor Cyan
$containerEnvId = ""
try {
    $containerEnvId = Invoke-AzCli containerapp env show --name $ContainerEnvName --resource-group $ResourceGroup --query id --output tsv
} catch {
    $containerEnvId = ""
}
if ([string]::IsNullOrWhiteSpace($containerEnvId)) {
    Invoke-AzCli containerapp env create --name $ContainerEnvName --resource-group $ResourceGroup --location $Location | Out-Null
    $containerEnvId = Invoke-AzCli containerapp env show --name $ContainerEnvName --resource-group $ResourceGroup --query id --output tsv
}

$imageTag = "backend-" + (Get-Date -Format "yyyyMMddHHmmss")
$imageName = "aura-backend:$imageTag"
$imageRef = "$acrLoginServer/$imageName"

if (-not [string]::IsNullOrWhiteSpace($ExistingImageRef)) {
    $imageRef = $ExistingImageRef.Trim()
    Write-Host "Reusing existing backend image: $imageRef" -ForegroundColor Cyan
} else {
    Write-Host "Logging Docker into ACR..." -ForegroundColor Cyan
    Require-DockerEngine
    Invoke-AzCli acr login --name $RegistryName | Out-Null

    Write-Host "Building and pushing backend image..." -ForegroundColor Cyan
    Build-And-Push-BackendImage -ImageRef $imageRef -RepoRoot $RepoRoot -RegistryLoginServer $acrLoginServer -PreferBuildx $UseBuildx
}

$apiSettings = Read-EnvFile -Path $ApiSettingsPath
$workerSettings = Read-EnvFile -Path $WorkerSettingsPath
$appInsightsConnectionString = Get-AppInsightsConnectionString -Name $AppInsightsName -GroupName $ResourceGroup
$apiSettings["PORT"] = "8080"
$resolvedApiPublicUrl = if ([string]::IsNullOrWhiteSpace($ApiPublicUrl)) { "https://placeholder.invalid" } else { $ApiPublicUrl.Trim() }
$apiSettings["APP_PUBLIC_URL"] = $resolvedApiPublicUrl
$workerSettings["PORT"] = "8080"
if (-not [string]::IsNullOrWhiteSpace($appInsightsConnectionString)) {
    $apiSettings["APPLICATIONINSIGHTS_CONNECTION_STRING"] = $appInsightsConnectionString
    $apiSettings["APPINSIGHTS_CONNECTIONSTRING"] = $appInsightsConnectionString
    $workerSettings["APPLICATIONINSIGHTS_CONNECTION_STRING"] = $appInsightsConnectionString
    $workerSettings["APPINSIGHTS_CONNECTIONSTRING"] = $appInsightsConnectionString
}
$apiSettings = Apply-Overrides -Settings $apiSettings -KeyVaultNameUnused $KeyVaultName -ApiUrl $resolvedApiPublicUrl -FrontendUrl $FrontendOrigin
$workerSettings = Apply-Overrides -Settings $workerSettings -KeyVaultNameUnused $KeyVaultName -ApiUrl "https://placeholder.invalid" -FrontendUrl $FrontendOrigin
$runtimeOverrides = Apply-RuntimeOverrides -ApiSettings $apiSettings -WorkerSettings $workerSettings -SourceValues $sourceValues
$apiSettings = $runtimeOverrides.ApiSettings
$workerSettings = $runtimeOverrides.WorkerSettings

$apiSecretArgs = Convert-SecretsToContainerSecretArgs -Values $sourceValues -VaultName $KeyVaultName -IdentityResourceId $identityId
$apiEnvArgs = Convert-SettingsToContainerEnvArgs -Settings $apiSettings -SourceValues $sourceValues
$workerSecretArgs = Convert-SecretsToContainerSecretArgs -Values $sourceValues -VaultName $KeyVaultName -IdentityResourceId $identityId
$workerEnvArgs = Convert-SettingsToContainerEnvArgs -Settings $workerSettings -SourceValues $sourceValues

Write-Host "Creating or updating API Container App..." -ForegroundColor Cyan
$apiExists = $false
try {
    $null = Invoke-AzCli containerapp show --name $ApiAppName --resource-group $ResourceGroup --output none
    $apiExists = $true
} catch {
    $apiExists = $false
}

if (-not $apiExists) {
    $createApiArgs = @(
        "containerapp", "create",
        "--name", $ApiAppName,
        "--resource-group", $ResourceGroup,
        "--environment", $containerEnvId,
        "--image", $imageRef,
        "--registry-server", $acrLoginServer,
        "--registry-identity", $identityId,
        "--user-assigned", $identityId,
        "--ingress", "external",
        "--target-port", "8080",
        "--transport", "auto",
        "--cpu", "1.0",
        "--memory", "2.0Gi",
        "--min-replicas", "$ApiMinReplicas",
        "--max-replicas", "$ApiMaxReplicas",
        "--revisions-mode", "multiple",
        "--secrets"
    ) + $apiSecretArgs + @("--env-vars") + $apiEnvArgs
    Invoke-AzCli @createApiArgs | Out-Null
} else {
    Invoke-AzCli containerapp update --name $ApiAppName --resource-group $ResourceGroup --image $imageRef --cpu 1.0 --memory 2.0Gi --min-replicas $ApiMinReplicas --max-replicas $ApiMaxReplicas --replace-env-vars @apiEnvArgs | Out-Null
    if ($apiSecretArgs.Count -gt 0) {
        $setApiSecretsArgs = @("containerapp", "secret", "set", "--name", $ApiAppName, "--resource-group", $ResourceGroup, "--secrets") + $apiSecretArgs
        Invoke-AzCli @setApiSecretsArgs | Out-Null
    }
}

Write-Host "Creating or updating worker Container App..." -ForegroundColor Cyan
$workerExists = $false
try {
    $null = Invoke-AzCli containerapp show --name $WorkerAppName --resource-group $ResourceGroup --output none
    $workerExists = $true
} catch {
    $workerExists = $false
}

if (-not $workerExists) {
    $createWorkerArgs = @(
        "containerapp", "create",
        "--name", $WorkerAppName,
        "--resource-group", $ResourceGroup,
        "--environment", $containerEnvId,
        "--image", $imageRef,
        "--registry-server", $acrLoginServer,
        "--registry-identity", $identityId,
        "--user-assigned", $identityId,
        "--command", "node", "workerProcess.js",
        "--cpu", "1.0",
        "--memory", "2.0Gi",
        "--min-replicas", "$WorkerMinReplicas",
        "--max-replicas", "$WorkerMaxReplicas",
        "--revisions-mode", "single",
        "--secrets"
    ) + $workerSecretArgs + @("--env-vars") + $workerEnvArgs
    Invoke-AzCli @createWorkerArgs | Out-Null
} else {
    Invoke-AzCli containerapp update --name $WorkerAppName --resource-group $ResourceGroup --image $imageRef --command "node" "workerProcess.js" --cpu 1.0 --memory 2.0Gi --min-replicas $WorkerMinReplicas --max-replicas $WorkerMaxReplicas --replace-env-vars @workerEnvArgs | Out-Null
    if ($workerSecretArgs.Count -gt 0) {
        $setWorkerSecretsArgs = @("containerapp", "secret", "set", "--name", $WorkerAppName, "--resource-group", $ResourceGroup, "--secrets") + $workerSecretArgs
        Invoke-AzCli @setWorkerSecretsArgs | Out-Null
    }
}

Start-Sleep -Seconds 20
$apiFqdn = Invoke-AzCli containerapp show --name $ApiAppName --resource-group $ResourceGroup --query properties.configuration.ingress.fqdn --output tsv
if ([string]::IsNullOrWhiteSpace($ApiPublicUrl) -and -not [string]::IsNullOrWhiteSpace($apiFqdn)) {
    Invoke-AzCli containerapp update --name $ApiAppName --resource-group $ResourceGroup --set-env-vars "APP_PUBLIC_URL=https://$apiFqdn" | Out-Null
}

Write-Host ""
Write-Host "Azure Container Apps backend deployment finished." -ForegroundColor Green
Write-Host "API URL: https://$apiFqdn"
Write-Host "Worker App: $WorkerAppName"
Write-Host "Image: $imageRef"
Write-Host "Managed Identity: $IdentityName"
