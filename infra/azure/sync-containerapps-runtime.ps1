param(
    [string]$SubscriptionId = "",
    [string]$ResourceGroup = "rg-aura-prod",
    [string]$KeyVaultName = "aura-msi-20260318-kv",
    [string]$ContainerEnvName = "aura-msi-ca-env",
    [string]$IdentityName = "aura-msi-backend-id",
    [string]$ApiAppName = "aura-msi-api-ca",
    [string]$WorkerAppName = "aura-msi-worker-ca",
    [string]$SourceEnvFile = "",
    [string]$ManifestPath = "",
    [string]$FrontendOrigin = "",
    [string]$ApiPublicUrl = "",
    [string]$ApiImageRef = "",
    [string]$WorkerImageRef = "",
    [switch]$SyncKeyVaultSecrets,
    [switch]$SkipSecretExistenceCheck,
    [switch]$DryRun,
    [switch]$DiscoverAzureUrlsInDryRun,
    [string]$PlanOutputPath = ""
)

$ErrorActionPreference = "Stop"

$script:AzCliPath = $null
$script:AzCliMode = "cmd"
$script:KeyVaultSecretExists = @{}
$script:IdentityResourceId = ""
$script:ContainerEnvId = ""
$script:DefaultFrontendUrl = "https://aurapilot.vercel.app"
$script:DefaultCorsOrigins = @(
    "https://aurapilot.vercel.app",
    "https://aura-cart-fix-preview.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173"
)
$script:GeneratedSecretKeys = @(
    "AUTH_VAULT_SECRET",
    "UPLOAD_SIGNING_SECRET",
    "OTP_FLOW_SECRET",
    "OTP_CHALLENGE_SECRET",
    "CRON_SECRET",
    "METRICS_SECRET"
)
$script:AlwaysSecretEnvNames = @(
    "MONGO_URI",
    "REDIS_URL",
    "FIREBASE_SERVICE_ACCOUNT",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "AUTH_VAULT_SECRET",
    "AUTH_VAULT_PREVIOUS_SECRETS",
    "AUTH_DEVICE_CHALLENGE_SECRET",
    "AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS",
    "UPLOAD_SIGNING_SECRET",
    "OTP_FLOW_SECRET",
    "OTP_CHALLENGE_SECRET",
    "CRON_SECRET",
    "METRICS_SECRET",
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
    "AZURE_STORAGE_CONNECTION_STRING",
    "AI_INTERNAL_TOOL_SECRET"
)
$script:NeverSecretEnvNames = @(
    "NODE_ENV",
    "PORT",
    "APP_PUBLIC_URL",
    "CORS_ORIGIN",
    "FRONTEND_URL",
    "JSON_BODY_LIMIT",
    "REQUEST_TIMEOUT_MS",
    "BOOT_GRACE_PERIOD_SEC",
    "GRACEFUL_SHUTDOWN_TIMEOUT_MS",
    "SPLIT_RUNTIME_ENABLED",
    "REDIS_ENABLED",
    "REDIS_REQUIRED",
    "REDIS_PREFIX",
    "REDIS_CONNECT_TIMEOUT_MS",
    "DISTRIBUTED_SECURITY_CONTROLS_ENABLED",
    "FIREBASE_PROJECT_ID",
    "AUTH_VAULT_SECRET_VERSION",
    "AUTH_DEVICE_CHALLENGE_MODE",
    "AUTH_DEVICE_CHALLENGE_SECRET_VERSION",
    "AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK",
    "AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN",
    "AUTH_WEBAUTHN_RP_NAME",
    "AUTH_WEBAUTHN_RP_ID",
    "AUTH_WEBAUTHN_ORIGIN",
    "AUTH_WEBAUTHN_USER_VERIFICATION",
    "AUTH_WEBAUTHN_TIMEOUT_MS",
    "AUTH_LATTICE_CHALLENGE_MODE",
    "AUTH_REQUIRE_OTP_FOR_ALL_PROTECTED",
    "CSRF_STRICT_CLIENT_SIGNALS",
    "ADMIN_STRICT_ACCESS_ENABLED",
    "ADMIN_REQUIRE_EMAIL_VERIFIED",
    "ADMIN_REQUIRE_FRESH_LOGIN_MINUTES",
    "ADMIN_REQUIRE_2FA",
    "ADMIN_REQUIRE_ALLOWLIST",
    "ADMIN_ALLOWLIST_EMAILS",
    "PAYMENTS_ENABLED",
    "PAYMENT_PROVIDER",
    "PAYMENT_RISK_MODE",
    "PAYMENT_CAPTURE_MODE",
    "PAYMENT_SAVED_METHODS_ENABLED",
    "PAYMENT_REFUNDS_ENABLED",
    "PAYMENT_CHALLENGE_ENABLED",
    "PAYMENT_DYNAMIC_ROUTING_ENABLED",
    "PAYMENT_WEBHOOKS_ENABLED",
    "ORDER_EMAILS_ENABLED",
    "ORDER_EMAIL_PROVIDER",
    "ORDER_EMAIL_FROM_NAME",
    "ORDER_EMAIL_FROM_ADDRESS",
    "ORDER_EMAIL_REPLY_TO",
    "ORDER_EMAIL_ALERT_TO",
    "ORDER_EMAIL_MAX_RETRIES",
    "ORDER_EMAIL_WORKER_POLL_MS",
    "GMAIL_USER",
    "EMAIL_SECURITY_ENABLED",
    "EMAIL_SECURITY_STRICT_MODE",
    "EMAIL_SECURITY_ALLOWED_EVENT_TYPES",
    "EMAIL_SECURITY_ALLOW_HTML",
    "EMAIL_SECURITY_MAX_SUBJECT_LEN",
    "EMAIL_SECURITY_MAX_TEXT_LEN",
    "EMAIL_SECURITY_MAX_HTML_LEN",
    "OTP_EMAIL_FAIL_CLOSED",
    "OTP_EMAIL_CONTEXT_ENABLED",
    "OTP_EMAIL_TTL_MINUTES",
    "OTP_EMAIL_SEND_IN_TEST",
    "OTP_LOGIN_REQUIRE_CREDENTIAL_PROOF",
    "OTP_LOGIN_AUTO_RECOVER_PROFILE",
    "OTP_SMS_ENABLED",
    "OTP_SMS_PROVIDER",
    "OTP_SMS_FAIL_CLOSED",
    "OTP_SMS_SEND_IN_TEST",
    "OTP_WHATSAPP_ENABLED",
    "OTP_SMS_TTL_MINUTES",
    "OTP_SMS_DEFAULT_COUNTRY_CODE",
    "OTP_SMS_BRAND",
    "TWILIO_STATUS_CALLBACK_URL",
    "ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA",
    "GROQ_CHAT_MODEL",
    "GROQ_VISION_MODEL",
    "GROQ_AUDIO_MODEL",
    "GROQ_MODERATION_MODEL",
    "GROQ_REQUEST_TIMEOUT_MS",
    "GROQ_RETRY_DELAY_MS",
    "GROQ_MAX_RETRIES",
    "VOYAGE_TEXT_EMBEDDING_MODEL",
    "VOYAGE_RERANK_MODEL",
    "VOYAGE_REQUEST_TIMEOUT_MS",
    "VOYAGE_RETRY_DELAY_MS",
    "VOYAGE_MAX_RETRIES",
    "ELEVENLABS_VOICE_ID",
    "ELEVENLABS_MODEL",
    "ELEVENLABS_REQUEST_TIMEOUT_MS",
    "LIVEKIT_URL",
    "LIVEKIT_TTL_SECONDS",
    "LIVEKIT_ROOM_NAME",
    "AI_DEFAULT_LOCALE",
    "CHAT_USER_WINDOW_MS",
    "CHAT_USER_MAX_REQUESTS",
    "APP_BUILD_SHA"
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

    Invoke-AzCli config set extension.use_dynamic_install=yes_without_prompt | Out-Null
    Invoke-AzCli extension add --name containerapp --upgrade | Out-Null
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

function Set-IfMissing {
    param(
        [System.Collections.IDictionary]$Map,
        [string]$Key,
        [string]$Value
    )

    if (-not $Map.Contains($Key) -or [string]::IsNullOrWhiteSpace([string]$Map[$Key])) {
        $Map[$Key] = $Value
    }
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

function Get-PrimaryOrigin {
    param([string]$Value)

    $trimmed = Trim-OrDefault $Value
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return ""
    }

    return ($trimmed -split ",")[0].Trim()
}

function Join-Origins {
    param([string[]]$Origins)

    $seen = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)
    $ordered = New-Object System.Collections.Generic.List[string]

    foreach ($originList in @($Origins)) {
        foreach ($origin in [string]$originList -split ",") {
            $trimmed = Trim-OrDefault $origin
            if ([string]::IsNullOrWhiteSpace($trimmed)) {
                continue
            }
            if ($seen.Add($trimmed)) {
                [void]$ordered.Add($trimmed)
            }
        }
    }

    return ($ordered.ToArray() -join ",")
}

function Convert-ToServiceBaseUrl {
    param([string]$Value)

    $trimmed = Trim-OrDefault $Value
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return ""
    }

    $normalized = $trimmed.TrimEnd("/")
    if ($normalized -match '/api$') {
        $normalized = $normalized.Substring(0, $normalized.Length - 4)
    }

    return $normalized.TrimEnd("/")
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
        [string]$RepositoryRoot,
        [string]$PreferredEnvFile
    )

    $resolvedPath = $PreferredEnvFile
    if (-not [string]::IsNullOrWhiteSpace($resolvedPath) -and -not (Test-Path $resolvedPath)) {
        throw "Source env file was not found at $resolvedPath"
    }

    if ([string]::IsNullOrWhiteSpace($resolvedPath)) {
        foreach ($candidate in @(
            (Join-Path $RepositoryRoot "server\.env.azure-secrets"),
            (Join-Path $RepositoryRoot "server\.env")
        )) {
            if (Test-Path $candidate) {
                $resolvedPath = $candidate
                break
            }
        }
    }

    $values = Read-EnvFile -Path $resolvedPath
    $frontendValues = Read-FrontendEnvFallbacks -RepositoryRoot $RepositoryRoot

    Set-IfMissing -Map $values -Key "FIREBASE_PROJECT_ID" -Value (Trim-OrDefault $frontendValues["VITE_FIREBASE_PROJECT_ID"])
    Set-IfMissing -Map $values -Key "APP_PUBLIC_URL" -Value (Convert-ToServiceBaseUrl $frontendValues["VITE_API_URL"])
    Set-IfMissing -Map $values -Key "ORDER_EMAIL_FROM_ADDRESS" -Value (Trim-OrDefault $values["GMAIL_USER"])
    Set-IfMissing -Map $values -Key "ORDER_EMAIL_REPLY_TO" -Value (Trim-OrDefault $values["GMAIL_USER"])
    Set-IfMissing -Map $values -Key "ORDER_EMAIL_ALERT_TO" -Value (Trim-OrDefault $values["GMAIL_USER"])
    Set-IfMissing -Map $values -Key "APP_BUILD_SHA" -Value (Trim-OrDefault $env:APP_BUILD_SHA)

    foreach ($generatedKey in $script:GeneratedSecretKeys) {
        Set-IfMissing -Map $values -Key $generatedKey -Value (New-RandomSecret)
    }

    return @{
        Path = $resolvedPath
        Values = $values
        IsAuthoritative = -not [string]::IsNullOrWhiteSpace($resolvedPath)
    }
}

function Convert-EnvNameToSecretName {
    param([string]$EnvName)
    return $EnvName.Trim().ToLowerInvariant().Replace("_", "-")
}

function Get-SecretAlias {
    param([string]$EnvName)

    $secretName = Convert-EnvNameToSecretName -EnvName $EnvName
    if ($secretName.Length -le 20) {
        return $secretName
    }

    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($secretName)
        $hash = [System.BitConverter]::ToString($sha1.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant().Substring(0, 8)
    } finally {
        $sha1.Dispose()
    }

    $prefixLength = [Math]::Min(11, $secretName.Length)
    return "{0}-{1}" -f $secretName.Substring(0, $prefixLength), $hash
}

function Test-IsSecretEnvName {
    param([string]$EnvName)

    $upper = $EnvName.Trim().ToUpperInvariant()
    if ([string]::IsNullOrWhiteSpace($upper)) {
        return $false
    }

    if ($script:NeverSecretEnvNames -contains $upper) {
        return $false
    }

    if ($script:AlwaysSecretEnvNames -contains $upper) {
        return $true
    }

    if ($upper -match '(^|_)(SECRET|TOKEN|PASSWORD)$') { return $true }
    if ($upper -match '(^|_)API_KEY$') { return $true }
    if ($upper -match '(^|_)PRIVATE_KEY$') { return $true }
    if ($upper -match '(^|_)CONNECTION_STRING$') { return $true }
    if ($upper -match '_URI$') { return $true }
    if ($upper -match '_WEBHOOK_SECRET$') { return $true }
    if ($upper -match '_SERVICE_ACCOUNT$') { return $true }
    if ($upper -match '_KEY_SECRET$') { return $true }
    if ($upper -match '_PREVIOUS_SECRETS$') { return $true }

    return $false
}

function Get-ServiceScopedPrefixes {
    param([string]$ServiceKey)

    $prefixes = @("SHARED__", "ALL__", "BACKEND__")
    switch ($ServiceKey) {
        "api" { return $prefixes + @("API__") }
        "worker" { return $prefixes + @("WORKER__") }
        default { return $prefixes }
    }
}

function Apply-ServiceScopedSourceOverrides {
    param(
        [string]$ServiceKey,
        [hashtable]$Settings,
        [hashtable]$SourceValues
    )

    $prefixes = Get-ServiceScopedPrefixes -ServiceKey $ServiceKey
    foreach ($entry in $SourceValues.GetEnumerator()) {
        $sourceKey = [string]$entry.Key
        $sourceValue = [string]$entry.Value
        foreach ($prefix in $prefixes) {
            if ($sourceKey.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $actualKey = $sourceKey.Substring($prefix.Length)
                if (-not [string]::IsNullOrWhiteSpace($actualKey)) {
                    $Settings[$actualKey] = $sourceValue
                }
                break
            }
        }
    }

    return $Settings
}

function Import-SecretsToKeyVault {
    param(
        [string]$VaultName,
        [hashtable]$Values
    )

    foreach ($entry in $Values.GetEnumerator()) {
        $envName = [string]$entry.Key
        if (-not (Test-IsSecretEnvName -EnvName $envName)) {
            continue
        }

        $value = Trim-OrDefault $entry.Value
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

        $script:KeyVaultSecretExists[$secretName] = $true
    }
}

function Get-SecretValuesForRuntimeSync {
    param(
        [object[]]$Services,
        [hashtable]$SourceValues,
        [string]$ResolvedApiUrl,
        [string]$ResolvedFrontendUrl,
        [string]$RepositoryRoot,
        [bool]$SourceIsAuthoritative
    )

    $secretValues = [ordered]@{}

    foreach ($service in $Services) {
        $templatePath = Join-Path $RepositoryRoot $service.templatePath
        $settings = Read-EnvFile -Path $templatePath
        $settings = Apply-ServiceOverrides -ServiceKey $service.key -Settings $settings -SourceValues $SourceValues -ResolvedApiUrl $ResolvedApiUrl -ResolvedFrontendUrl $ResolvedFrontendUrl -SourceIsAuthoritative $SourceIsAuthoritative

        foreach ($entry in $settings.GetEnumerator()) {
            $envName = [string]$entry.Key
            if (-not (Test-IsSecretEnvName -EnvName $envName)) {
                continue
            }

            $value = Trim-OrDefault $entry.Value
            if ([string]::IsNullOrWhiteSpace($value)) {
                continue
            }

            $secretValues[$envName] = $value
        }
    }

    return $secretValues
}

function Test-KeyVaultSecretExists {
    param(
        [string]$VaultName,
        [string]$SecretName
    )

    if ($script:KeyVaultSecretExists.ContainsKey($SecretName)) {
        return [bool]$script:KeyVaultSecretExists[$SecretName]
    }

    if ($SkipSecretExistenceCheck -or $DryRun) {
        $script:KeyVaultSecretExists[$SecretName] = $true
        return $true
    }

    try {
        $secretId = Invoke-AzCli keyvault secret show --vault-name $VaultName --name $SecretName --query id --output tsv 2>$null
        $exists = -not [string]::IsNullOrWhiteSpace($secretId)
    } catch {
        $exists = $false
    }

    $script:KeyVaultSecretExists[$SecretName] = $exists
    return $exists
}

function Get-ServiceAppName {
    param([string]$ServiceKey)

    switch ($ServiceKey) {
        "api" { return $ApiAppName }
        "worker" { return $WorkerAppName }
        default { throw "Unknown service key $ServiceKey" }
    }
}

function Get-ServiceImageRef {
    param([string]$ServiceKey)

    switch ($ServiceKey) {
        "api" { return $ApiImageRef }
        "worker" { return $(if ($WorkerImageRef) { $WorkerImageRef } else { $ApiImageRef }) }
        default { return "" }
    }
}

function Resolve-ApiUrl {
    param(
        [hashtable]$SourceValues,
        [bool]$CanUseAzure
    )

    $explicit = Convert-ToServiceBaseUrl $ApiPublicUrl
    if (-not [string]::IsNullOrWhiteSpace($explicit)) {
        return $explicit
    }

    $fromEnv = Convert-ToServiceBaseUrl $SourceValues["APP_PUBLIC_URL"]
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
        return $fromEnv
    }

    if ($CanUseAzure) {
        try {
            $fqdn = Invoke-AzCli containerapp show --name $ApiAppName --resource-group $ResourceGroup --query properties.configuration.ingress.fqdn --output tsv
            if (-not [string]::IsNullOrWhiteSpace($fqdn)) {
                return "https://$fqdn"
            }
        } catch {
        }
    }

    return "https://api.example.com"
}

function Resolve-FrontendUrl {
    param([hashtable]$SourceValues)

    $explicit = Trim-OrDefault $FrontendOrigin
    if (-not [string]::IsNullOrWhiteSpace($explicit)) {
        return $explicit
    }

    foreach ($candidate in @(
        (Trim-OrDefault $SourceValues["FRONTEND_URL"]),
        (Get-PrimaryOrigin -Value $SourceValues["CORS_ORIGIN"])
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            return $candidate
        }
    }

    return $script:DefaultFrontendUrl
}

function Load-Manifest {
    param([string]$Path)

    $manifestToUse = $Path
    if ([string]::IsNullOrWhiteSpace($manifestToUse)) {
        $manifestToUse = Join-Path $PSScriptRoot "containerapps.runtime.manifest.json"
    }

    if (-not (Test-Path $manifestToUse)) {
        throw "Runtime manifest not found at $manifestToUse"
    }

    return Get-Content $manifestToUse -Raw | ConvertFrom-Json
}

function Apply-ServiceOverrides {
    param(
        [string]$ServiceKey,
        [hashtable]$Settings,
        [hashtable]$SourceValues,
        [string]$ResolvedApiUrl,
        [string]$ResolvedFrontendUrl,
        [bool]$SourceIsAuthoritative
    )

    foreach ($key in @($Settings.Keys)) {
        $value = [string]$Settings[$key]
        if ($SourceValues.Contains($key) -and -not [string]::IsNullOrWhiteSpace([string]$SourceValues[$key])) {
            $value = [string]$SourceValues[$key]
        }

        $value = $value `
            -replace [regex]::Escape("<keyvault-name>"), $KeyVaultName `
            -replace [regex]::Escape("https://api.example.com"), $ResolvedApiUrl `
            -replace [regex]::Escape("https://app.example.com"), $ResolvedFrontendUrl

        $Settings[$key] = $value
    }

    if ($Settings.Contains("APP_PUBLIC_URL")) {
        $Settings["APP_PUBLIC_URL"] = $ResolvedApiUrl
    }
    if ($Settings.Contains("FRONTEND_URL")) {
        $Settings["FRONTEND_URL"] = $ResolvedFrontendUrl
    }
    if ($Settings.Contains("CORS_ORIGIN")) {
        $Settings["CORS_ORIGIN"] = Join-Origins @(
            (Trim-OrDefault $SourceValues["CORS_ORIGIN"]),
            $ResolvedFrontendUrl,
            ($script:DefaultCorsOrigins -join ",")
        )
    }
    if ($Settings.Contains("FIREBASE_PROJECT_ID")) {
        $Settings["FIREBASE_PROJECT_ID"] = Trim-OrDefault $SourceValues["FIREBASE_PROJECT_ID"] $Settings["FIREBASE_PROJECT_ID"]
    }
    if ($Settings.Contains("ORDER_EMAIL_FROM_ADDRESS")) {
        $Settings["ORDER_EMAIL_FROM_ADDRESS"] = Trim-OrDefault $SourceValues["ORDER_EMAIL_FROM_ADDRESS"] $Settings["ORDER_EMAIL_FROM_ADDRESS"]
    }
    if ($Settings.Contains("ORDER_EMAIL_REPLY_TO")) {
        $Settings["ORDER_EMAIL_REPLY_TO"] = Trim-OrDefault $SourceValues["ORDER_EMAIL_REPLY_TO"] $Settings["ORDER_EMAIL_REPLY_TO"]
    }
    if ($Settings.Contains("ORDER_EMAIL_ALERT_TO")) {
        $Settings["ORDER_EMAIL_ALERT_TO"] = Trim-OrDefault $SourceValues["ORDER_EMAIL_ALERT_TO"] $Settings["ORDER_EMAIL_ALERT_TO"]
    }

    $Settings = Apply-ServiceScopedSourceOverrides -ServiceKey $ServiceKey -Settings $Settings -SourceValues $SourceValues

    if ($SourceIsAuthoritative) {
        $hasResend = -not [string]::IsNullOrWhiteSpace([string]$SourceValues["RESEND_API_KEY"])
        $hasGmail = (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["GMAIL_USER"])) -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["GMAIL_APP_PASSWORD"]))
        if ($Settings.Contains("ORDER_EMAIL_PROVIDER")) {
            if ($hasResend) {
                $Settings["ORDER_EMAIL_PROVIDER"] = "resend"
            } elseif ($hasGmail) {
                $Settings["ORDER_EMAIL_PROVIDER"] = "gmail"
            }
        }
        if ($Settings.Contains("ORDER_EMAILS_ENABLED") -and -not $hasResend -and -not $hasGmail) {
            $Settings["ORDER_EMAILS_ENABLED"] = "false"
        }
        if (-not $hasResend) {
            foreach ($emailSecretKey in @("RESEND_API_KEY", "RESEND_WEBHOOK_SECRET")) {
                if ($Settings.Contains($emailSecretKey)) { $Settings[$emailSecretKey] = "" }
            }
        }
        if (-not $hasGmail) {
            foreach ($gmailKey in @("GMAIL_USER", "GMAIL_APP_PASSWORD")) {
                if ($Settings.Contains($gmailKey)) { $Settings[$gmailKey] = "" }
            }
        }

        $hasTwilio = (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_ACCOUNT_SID"])) `
            -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_AUTH_TOKEN"])) `
            -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["TWILIO_FROM_NUMBER"]))
        if (-not $hasTwilio) {
            if ($Settings.Contains("OTP_SMS_ENABLED")) { $Settings["OTP_SMS_ENABLED"] = "false" }
            if ($Settings.Contains("OTP_WHATSAPP_ENABLED")) { $Settings["OTP_WHATSAPP_ENABLED"] = "false" }
            foreach ($twilioKey in @("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_WHATSAPP_FROM")) {
                if ($Settings.Contains($twilioKey)) { $Settings[$twilioKey] = "" }
            }
        }

        $paymentsEnabled = Trim-OrDefault $SourceValues["PAYMENTS_ENABLED"]
        $paymentProvider = Trim-OrDefault $SourceValues["PAYMENT_PROVIDER"]
        $hasRazorpay = (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["RAZORPAY_KEY_ID"])) `
            -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["RAZORPAY_KEY_SECRET"])) `
            -and (-not [string]::IsNullOrWhiteSpace([string]$SourceValues["RAZORPAY_WEBHOOK_SECRET"]))
        $shouldRunRazorpay = $hasRazorpay -and ($paymentProvider -eq "" -or $paymentProvider -eq "razorpay") -and ($paymentsEnabled -eq "" -or $paymentsEnabled -match '^(?i:true|1|yes|on)$')
        if (-not $shouldRunRazorpay) {
            if ($Settings.Contains("PAYMENTS_ENABLED")) { $Settings["PAYMENTS_ENABLED"] = "false" }
            if ($Settings.Contains("PAYMENT_WEBHOOKS_ENABLED")) { $Settings["PAYMENT_WEBHOOKS_ENABLED"] = "false" }
            foreach ($razorpayKey in @("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET")) {
                if ($Settings.Contains($razorpayKey)) { $Settings[$razorpayKey] = "" }
            }
        }
    }

    return $Settings
}

function New-ServiceRuntimePlan {
    param(
        [pscustomobject]$Service,
        [hashtable]$SourceValues,
        [string]$ResolvedApiUrl,
        [string]$ResolvedFrontendUrl,
        [string]$RepositoryRoot,
        [bool]$SourceIsAuthoritative
    )

    $templatePath = Join-Path $RepositoryRoot $Service.templatePath
    $settings = Read-EnvFile -Path $templatePath
    $settings = Apply-ServiceOverrides -ServiceKey $Service.key -Settings $settings -SourceValues $SourceValues -ResolvedApiUrl $ResolvedApiUrl -ResolvedFrontendUrl $ResolvedFrontendUrl -SourceIsAuthoritative $SourceIsAuthoritative

    $boundSecrets = @()
    $missingSecrets = @()
    $envArgs = @()
    $secretArgs = @()
    foreach ($entry in $settings.GetEnumerator()) {
        $key = [string]$entry.Key
        $value = [string]$entry.Value

        if (Test-IsSecretEnvName -EnvName $key) {
            if ([string]::IsNullOrWhiteSpace($value) -and -not $SourceValues.Contains($key)) {
                continue
            }
            $secretName = Convert-EnvNameToSecretName -EnvName $key
            if (Test-KeyVaultSecretExists -VaultName $KeyVaultName -SecretName $secretName) {
                $alias = Get-SecretAlias -EnvName $key
                $boundSecrets += [pscustomobject]@{
                    env = $key
                    alias = $alias
                    secretName = $secretName
                }
                $secretArgs += "$alias=keyvaultref:https://$KeyVaultName.vault.azure.net/secrets/$secretName,identityref:$IdentityResourceId"
                $envArgs += "$key=secretref:$alias"
            } else {
                $missingSecrets += [pscustomobject]@{
                    env = $key
                    secretName = $secretName
                }
            }
            continue
        }

        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $envArgs += "$key=$value"
        }
    }

    return [pscustomobject]@{
        key = $Service.key
        appName = Get-ServiceAppName -ServiceKey $Service.key
        imageRef = Get-ServiceImageRef -ServiceKey $Service.key
        templatePath = $templatePath
        settings = $settings
        envArgs = $envArgs
        secretArgs = $secretArgs
        boundSecrets = $boundSecrets
        missingSecrets = $missingSecrets
        service = $Service
    }
}

function Ensure-IdentityResource {
    $subscriptionId = Trim-OrDefault $SubscriptionId
    if ([string]::IsNullOrWhiteSpace($subscriptionId)) {
        $subscriptionId = Trim-OrDefault (Invoke-AzCli account show --query id --output tsv)
    }
    if ([string]::IsNullOrWhiteSpace($subscriptionId)) {
        throw "Could not resolve the Azure subscription id for managed identity resource construction."
    }

    return @{
        Id = "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.ManagedIdentity/userAssignedIdentities/$IdentityName"
    }
}

function Ensure-ContainerAppEnvironmentId {
    return Invoke-AzCli containerapp env show --name $ContainerEnvName --resource-group $ResourceGroup --query id --output tsv
}

function Test-ContainerAppExists {
    param([string]$AppName)

    try {
        $null = Invoke-AzCli containerapp show --name $AppName --resource-group $ResourceGroup --output none
        return $true
    } catch {
        return $false
    }
}

function Restart-ActiveContainerAppRevisions {
    param([string]$AppName)

    $activeRevisions = @(
        (Invoke-AzCli containerapp revision list --name $AppName --resource-group $ResourceGroup --query "[?properties.active].name" --output tsv) `
            -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )

    foreach ($revision in $activeRevisions) {
        Invoke-AzCli containerapp revision restart --name $AppName --resource-group $ResourceGroup --revision $revision | Out-Null
    }
}

function Update-ContainerAppRuntime {
    param([pscustomobject]$Plan)

    $appExists = Test-ContainerAppExists -AppName $Plan.appName
    $service = $Plan.service
    $imageRef = Trim-OrDefault $Plan.imageRef
    $shouldRestart = $false

    if (-not $appExists -and [string]::IsNullOrWhiteSpace($imageRef)) {
        throw "Container App $($Plan.appName) does not exist and no image ref was supplied for service $($Plan.key)."
    }

    if ($appExists) {
        if ($Plan.secretArgs.Count -gt 0) {
            $secretArgs = @("containerapp", "secret", "set", "--name", $Plan.appName, "--resource-group", $ResourceGroup, "--secrets") + $Plan.secretArgs
            Invoke-AzCli @secretArgs | Out-Null
            $shouldRestart = $true
        }

        $updateArgs = @("containerapp", "update", "--name", $Plan.appName, "--resource-group", $ResourceGroup)
        if (-not [string]::IsNullOrWhiteSpace($imageRef)) {
            $updateArgs += @("--image", $imageRef)
        }
        if ($service.cpu) {
            $updateArgs += @("--cpu", [string]$service.cpu)
        }
        if ($service.memory) {
            $updateArgs += @("--memory", [string]$service.memory)
        }
        if ($service.minReplicas -ne $null) {
            $updateArgs += @("--min-replicas", [string]$service.minReplicas)
        }
        if ($service.maxReplicas -ne $null) {
            $updateArgs += @("--max-replicas", [string]$service.maxReplicas)
        }
        if ($service.command) {
            $updateArgs += "--command"
            $updateArgs += @($service.command)
        }
        $updateArgs += "--replace-env-vars"
        $updateArgs += $Plan.envArgs
        Invoke-AzCli @updateArgs | Out-Null
    } else {
        $registryServer = ($imageRef -split "/", 2)[0]
        $createArgs = @(
            "containerapp", "create",
            "--name", $Plan.appName,
            "--resource-group", $ResourceGroup,
            "--environment", $ContainerEnvId,
            "--image", $imageRef,
            "--registry-server", $registryServer,
            "--registry-identity", $IdentityResourceId,
            "--user-assigned", $IdentityResourceId,
            "--cpu", [string]$service.cpu,
            "--memory", [string]$service.memory,
            "--min-replicas", [string]$service.minReplicas,
            "--max-replicas", [string]$service.maxReplicas,
            "--revisions-mode", [string]$service.revisionsMode
        )
        if ($service.ingress) {
            $createArgs += @("--ingress", [string]$service.ingress)
        }
        if ($service.targetPort) {
            $createArgs += @("--target-port", [string]$service.targetPort)
        }
        if ($service.transport) {
            $createArgs += @("--transport", [string]$service.transport)
        }
        if ($service.command) {
            $createArgs += "--command"
            $createArgs += @($service.command)
        }
        if ($Plan.secretArgs.Count -gt 0) {
            $createArgs += "--secrets"
            $createArgs += $Plan.secretArgs
        }
        $createArgs += "--env-vars"
        $createArgs += $Plan.envArgs
        Invoke-AzCli @createArgs | Out-Null
    }

    if ($service.revisionsMode -eq "single") {
        Invoke-AzCli containerapp revision set-mode --name $Plan.appName --resource-group $ResourceGroup --mode single | Out-Null
    }

    if ($Plan.boundSecrets.Count -gt 0) {
        $expectedAliases = @($Plan.boundSecrets | ForEach-Object { [string]$_.alias } | Sort-Object -Unique)
        $actualSecretNames = @(
            (Invoke-AzCli containerapp secret list --name $Plan.appName --resource-group $ResourceGroup --query "[].name" --output tsv) `
                -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
        $staleSecretNames = @($actualSecretNames | Where-Object { $expectedAliases -notcontains $_ })
        if ($staleSecretNames.Count -gt 0) {
            $removeArgs = @("containerapp", "secret", "remove", "--name", $Plan.appName, "--resource-group", $ResourceGroup, "--secret-names") + $staleSecretNames
            Invoke-AzCli @removeArgs | Out-Null
            $shouldRestart = $true
        }
    }

    if ($appExists -and $shouldRestart) {
        Restart-ActiveContainerAppRevisions -AppName $Plan.appName
    }
}

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$manifest = Load-Manifest -Path $ManifestPath
$sourceInfo = Get-SourceEnvValues -RepositoryRoot $RepoRoot -PreferredEnvFile $SourceEnvFile
$sourceValues = $sourceInfo.Values

if (-not $DryRun) {
    Require-AzureCli
    $identityInfo = Ensure-IdentityResource
    $script:IdentityResourceId = $identityInfo.Id
    $script:ContainerEnvId = Ensure-ContainerAppEnvironmentId
} else {
    if ($DiscoverAzureUrlsInDryRun) {
        try {
            Require-AzureCli
        } catch {
        }
    }
    $script:IdentityResourceId = "/subscriptions/mock/resourceGroups/mock/providers/Microsoft.ManagedIdentity/userAssignedIdentities/$IdentityName"
    $script:ContainerEnvId = "/subscriptions/mock/resourceGroups/mock/providers/Microsoft.App/managedEnvironments/$ContainerEnvName"
}

$resolvedFrontendUrl = Resolve-FrontendUrl -SourceValues $sourceValues
$canUseAzureDiscovery = (-not $DryRun) -or $DiscoverAzureUrlsInDryRun
$resolvedApiUrl = Resolve-ApiUrl -SourceValues $sourceValues -CanUseAzure $canUseAzureDiscovery

$secretsToSync = Get-SecretValuesForRuntimeSync -Services $manifest.services -SourceValues $sourceValues -ResolvedApiUrl $resolvedApiUrl -ResolvedFrontendUrl $resolvedFrontendUrl -RepositoryRoot $RepoRoot -SourceIsAuthoritative ([bool]$sourceInfo.IsAuthoritative)

if ($SyncKeyVaultSecrets) {
    if ($DryRun) {
        Write-Host "Dry run: skipping Key Vault writes." -ForegroundColor Yellow
    } else {
        Write-Host "Syncing runtime-scoped secrets into Key Vault $KeyVaultName..." -ForegroundColor Cyan
        Import-SecretsToKeyVault -VaultName $KeyVaultName -Values $secretsToSync
    }
}

$plans = @()
foreach ($service in $manifest.services) {
    $plans += New-ServiceRuntimePlan -Service $service -SourceValues $sourceValues -ResolvedApiUrl $resolvedApiUrl -ResolvedFrontendUrl $resolvedFrontendUrl -RepositoryRoot $RepoRoot -SourceIsAuthoritative ([bool]$sourceInfo.IsAuthoritative)
}

$missingSecretBindings = @(
    $plans | ForEach-Object {
        $plan = $_
        foreach ($missing in $plan.missingSecrets) {
            [pscustomobject]@{
                service = $plan.key
                appName = $plan.appName
                env = $missing.env
                secretName = $missing.secretName
            }
        }
    }
)

$planSummary = [ordered]@{
    sourceEnvFile = $sourceInfo.Path
    keyVaultName = $KeyVaultName
    resourceGroup = $ResourceGroup
    frontendUrl = $resolvedFrontendUrl
    apiUrl = $resolvedApiUrl
    syncKeyVaultSecrets = [bool]$SyncKeyVaultSecrets
    missingSecretBindings = @(
        $missingSecretBindings | ForEach-Object {
            [ordered]@{
                service = $_.service
                appName = $_.appName
                env = $_.env
                secretName = $_.secretName
            }
        }
    )
    services = @(
        $plans | ForEach-Object {
            [ordered]@{
                key = $_.key
                appName = $_.appName
                imageRef = $_.imageRef
                envVarCount = $_.envArgs.Count
                secretBindingCount = $_.boundSecrets.Count
                envArgs = @($_.envArgs)
                secretArgs = @($_.secretArgs)
                boundSecrets = @(
                    $_.boundSecrets | ForEach-Object {
                        [ordered]@{
                            env = $_.env
                            alias = $_.alias
                            secretName = $_.secretName
                        }
                    }
                )
                templatePath = $_.templatePath
            }
        }
    )
}

if ($PlanOutputPath) {
    $planDir = Split-Path -Parent $PlanOutputPath
    if ($planDir) {
        New-Item -ItemType Directory -Path $planDir -Force | Out-Null
    }
    ($planSummary | ConvertTo-Json -Depth 8) | Set-Content -Path $PlanOutputPath -Encoding UTF8
}

if ($DryRun) {
    Write-Host "Azure runtime sync dry run complete." -ForegroundColor Green
    $planSummary | ConvertTo-Json -Depth 8
    return
}

if ($missingSecretBindings.Count -gt 0) {
    $missingList = $missingSecretBindings | ForEach-Object { "$($_.service):$($_.env)->$($_.secretName)" }
    throw "Refusing runtime sync because required Key Vault secrets are missing: $($missingList -join ', ')"
}

foreach ($plan in $plans) {
    Write-Host "Reconciling Container App runtime for $($plan.appName)..." -ForegroundColor Cyan
    Update-ContainerAppRuntime -Plan $plan
}

Write-Host ""
Write-Host "Azure runtime sync complete." -ForegroundColor Green
Write-Host "API URL: $resolvedApiUrl"
Write-Host "Frontend URL: $resolvedFrontendUrl"
