param(
    [string]$ResourceGroup = "rg-aura-prod",
    [string]$Location = "southeastasia",
    [string]$ApiAppName = "aura-msi-api-ca",
    [string]$WorkerAppName = "aura-msi-worker-ca",
    [string]$ContainerEnvName = "aura-msi-ca-env",
    [string]$WorkspaceName = "workspace-rgauraprodL8p8",
    [string]$AppInsightsName = "aura-msi-20260318-appi",
    [string]$KeyVaultName = "aura-msi-20260318-kv",
    [string]$FrontDoorProfileName = "aura-msi-edge",
    [string]$FrontDoorEndpointName = "auramsi-edge-20260319",
    [string]$FrontDoorOriginGroupName = "api-origin-group",
    [string]$FrontDoorOriginName = "api-origin",
    [string]$FrontDoorRouteName = "all-backend",
    [string]$FrontDoorSecurityPolicyName = "aura-msi-edge-security",
    [string]$WafPolicyName = "aura-msi-edge-waf",
    [ValidateSet("Detection", "Prevention")]
    [string]$WafMode = "Detection",
    [string]$ActionGroupName = "aura-prod-action-group",
    [string]$AlertEmail = "",
    [string]$RedisCacheName = "auramsi20260319cache",
    [ValidateSet("Basic", "Standard")]
    [string]$RedisSku = "Basic",
    [ValidateSet("c0", "c1")]
    [string]$RedisVmSize = "c0",
    [switch]$EnableBudgetHeavyObservability,
    [switch]$MigrateRedis
)

$ErrorActionPreference = "Stop"

if (-not $EnableBudgetHeavyObservability) {
    throw "This script provisions extra billable Azure monitoring and alerting. Re-run with -EnableBudgetHeavyObservability only when you explicitly want that spend."
}

function Invoke-AzJson {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $output = az @Arguments --output json --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($output -join [Environment]::NewLine)
    }

    if (-not $output) {
        return $null
    }

    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Invoke-AzTsv {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $output = az @Arguments --output tsv --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($output -join [Environment]::NewLine)
    }

    return ($output -join [Environment]::NewLine).Trim()
}

function Invoke-AzRaw {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & az @Arguments --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($Arguments -join ' ')"
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Provider {
    param([string]$Namespace)

    $state = Invoke-AzTsv provider show --namespace $Namespace --query registrationState
    if ($state -ne "Registered") {
        Write-Step "Registering resource provider $Namespace"
        Invoke-AzRaw provider register --namespace $Namespace --wait
    }
}

function Test-ResourceExists {
    param([scriptblock]$Resolver)

    try {
        $null = & $Resolver
        return $true
    } catch {
        return $false
    }
}

function Ensure-ActionGroup {
    param(
        [string]$Name,
        [string]$GroupName,
        [string]$ReceiverEmail
    )

    if (-not (Test-ResourceExists { Invoke-AzJson monitor action-group show --name $Name --resource-group $GroupName })) {
        Write-Step "Creating action group $Name"
        Invoke-AzRaw monitor action-group create `
            --name $Name `
            --resource-group $GroupName `
            --short-name "AuraOps" `
            --action email AuraOps $ReceiverEmail usecommonalertschema
    }

    return Invoke-AzTsv monitor action-group show --name $Name --resource-group $GroupName --query id
}

function Ensure-FrontDoorProfile {
    param([string]$GroupName, [string]$Name)

    if (-not (Test-ResourceExists { Invoke-AzJson afd profile show --profile-name $Name --resource-group $GroupName })) {
        Write-Step "Creating Front Door profile $Name"
        Invoke-AzRaw afd profile create `
            --profile-name $Name `
            --resource-group $GroupName `
            --sku Standard_AzureFrontDoor `
            --origin-response-timeout-seconds 60
    }

    return Invoke-AzJson afd profile show --profile-name $Name --resource-group $GroupName
}

function Ensure-FrontDoorEndpoint {
    param([string]$GroupName, [string]$ProfileName, [string]$EndpointName)

    if (-not (Test-ResourceExists { Invoke-AzJson afd endpoint show --endpoint-name $EndpointName --profile-name $ProfileName --resource-group $GroupName })) {
        Write-Step "Creating Front Door endpoint $EndpointName"
        Invoke-AzRaw afd endpoint create `
            --endpoint-name $EndpointName `
            --profile-name $ProfileName `
            --resource-group $GroupName `
            --enabled-state Enabled
    }

    return Invoke-AzJson afd endpoint show --endpoint-name $EndpointName --profile-name $ProfileName --resource-group $GroupName
}

function Ensure-OriginGroup {
    param(
        [string]$GroupName,
        [string]$ProfileName,
        [string]$OriginGroupName
    )

    if (-not (Test-ResourceExists { Invoke-AzJson afd origin-group show --origin-group-name $OriginGroupName --profile-name $ProfileName --resource-group $GroupName })) {
        Write-Step "Creating Front Door origin group $OriginGroupName"
        Invoke-AzRaw afd origin-group create `
            --origin-group-name $OriginGroupName `
            --profile-name $ProfileName `
            --resource-group $GroupName `
            --enable-health-probe true `
            --probe-path /health/live `
            --probe-protocol Https `
            --probe-request-type GET `
            --probe-interval-in-seconds 30 `
            --sample-size 4 `
            --successful-samples-required 3 `
            --additional-latency-in-milliseconds 50 `
            --session-affinity-state Disabled
    }

    return Invoke-AzJson afd origin-group show --origin-group-name $OriginGroupName --profile-name $ProfileName --resource-group $GroupName
}

function Ensure-Origin {
    param(
        [string]$GroupName,
        [string]$ProfileName,
        [string]$OriginGroupName,
        [string]$OriginName,
        [string]$HostName
    )

    if (-not (Test-ResourceExists { Invoke-AzJson afd origin show --origin-name $OriginName --origin-group-name $OriginGroupName --profile-name $ProfileName --resource-group $GroupName })) {
        Write-Step "Creating Front Door origin $OriginName"
        Invoke-AzRaw afd origin create `
            --origin-name $OriginName `
            --origin-group-name $OriginGroupName `
            --profile-name $ProfileName `
            --resource-group $GroupName `
            --host-name $HostName `
            --origin-host-header $HostName `
            --priority 1 `
            --weight 1000 `
            --enabled-state Enabled `
            --http-port 80 `
            --https-port 443 `
            --enforce-certificate-name-check true
    } else {
        Invoke-AzRaw afd origin update `
            --origin-name $OriginName `
            --origin-group-name $OriginGroupName `
            --profile-name $ProfileName `
            --resource-group $GroupName `
            --host-name $HostName `
            --origin-host-header $HostName `
            --priority 1 `
            --weight 1000 `
            --enabled-state Enabled `
            --http-port 80 `
            --https-port 443 `
            --enforce-certificate-name-check true
    }

    return Invoke-AzJson afd origin show --origin-name $OriginName --origin-group-name $OriginGroupName --profile-name $ProfileName --resource-group $GroupName
}

function Ensure-Route {
    param(
        [string]$GroupName,
        [string]$ProfileName,
        [string]$EndpointName,
        [string]$RouteName,
        [string]$OriginGroupId
    )

    $patterns = @("/*")

    if (-not (Test-ResourceExists { Invoke-AzJson afd route show --route-name $RouteName --endpoint-name $EndpointName --profile-name $ProfileName --resource-group $GroupName })) {
        Write-Step "Creating Front Door route $RouteName"
        Invoke-AzRaw afd route create `
            --route-name $RouteName `
            --endpoint-name $EndpointName `
            --profile-name $ProfileName `
            --resource-group $GroupName `
            --origin-group $OriginGroupId `
            --supported-protocols Http Https `
            --https-redirect Enabled `
            --forwarding-protocol HttpsOnly `
            --link-to-default-domain Enabled `
            --patterns-to-match $patterns
    } else {
        Invoke-AzRaw afd route update `
            --route-name $RouteName `
            --endpoint-name $EndpointName `
            --profile-name $ProfileName `
            --resource-group $GroupName `
            --origin-group $OriginGroupId `
            --supported-protocols Http Https `
            --https-redirect Enabled `
            --forwarding-protocol HttpsOnly `
            --link-to-default-domain Enabled `
            --patterns-to-match $patterns
    }

    return Invoke-AzJson afd route show --route-name $RouteName --endpoint-name $EndpointName --profile-name $ProfileName --resource-group $GroupName
}

function Ensure-WafPolicy {
    param(
        [string]$GroupName,
        [string]$PolicyName,
        [string]$Mode
    )

    if (-not (Test-ResourceExists { Invoke-AzJson network front-door waf-policy show --policy-name $PolicyName --resource-group $GroupName })) {
        Write-Step "Creating WAF policy $PolicyName in $Mode mode"
        $managedRules = @{
            "managed-rule-sets" = @(
                @{
                    "rule-set-type" = "DefaultRuleSet"
                    "rule-set-version" = "2.1"
                    "rule-set-action" = if ($Mode -eq "Prevention") { "Block" } else { "Log" }
                }
            )
        }

        $managedRulesFile = Join-Path $env:TEMP ("aura-waf-managed-rules-" + [Guid]::NewGuid().ToString("N") + ".json")
        try {
            $managedRules | ConvertTo-Json -Depth 10 | Set-Content -Path $managedRulesFile -Encoding utf8
            Invoke-AzRaw network front-door waf-policy create `
                --policy-name $PolicyName `
                --resource-group $GroupName `
                --location Global `
                --sku Standard_AzureFrontDoor `
                --mode $Mode `
                --request-body-check Enabled `
                --managed-rules "@$managedRulesFile"
        } finally {
            Remove-Item $managedRulesFile -Force -ErrorAction SilentlyContinue
        }
    }

    return Invoke-AzTsv network front-door waf-policy show --policy-name $PolicyName --resource-group $GroupName --query id
}

function Ensure-SecurityPolicy {
    param(
        [string]$GroupName,
        [string]$ProfileName,
        [string]$PolicyName,
        [string]$WafPolicyId,
        [string]$EndpointId
    )

    if (-not (Test-ResourceExists { Invoke-AzJson afd security-policy show --security-policy-name $PolicyName --profile-name $ProfileName --resource-group $GroupName })) {
        Write-Step "Attaching WAF policy to Front Door endpoint"
        Invoke-AzRaw afd security-policy create `
            --security-policy-name $PolicyName `
            --profile-name $ProfileName `
            --resource-group $GroupName `
            --domains $EndpointId `
            --waf-policy $WafPolicyId
    }
}

function Ensure-DiagnosticSetting {
    param(
        [string]$Name,
        [string]$ResourceId,
        [string]$WorkspaceId
    )

    $categories = Invoke-AzJson monitor diagnostic-settings categories list --resource $ResourceId
    $logCategories = @(
        "FrontdoorAccessLog",
        "FrontdoorHealthProbeLog",
        "FrontdoorWebApplicationFirewallLog"
    ) | Where-Object { $_ -in $categories.name }

    $logs = @()
    foreach ($category in $logCategories) {
        $logs += @{
            category = $category
            enabled = $true
            retentionPolicy = @{
                enabled = $false
                days = 0
            }
        }
    }

    $metrics = @(
        @{
            category = "AllMetrics"
            enabled = $true
            retentionPolicy = @{
                enabled = $false
                days = 0
            }
        }
    )

    $logsFile = Join-Path $env:TEMP ("aura-ds-logs-" + [Guid]::NewGuid().ToString("N") + ".json")
    $metricsFile = Join-Path $env:TEMP ("aura-ds-metrics-" + [Guid]::NewGuid().ToString("N") + ".json")

    try {
        $logs | ConvertTo-Json -Depth 8 | Set-Content -Path $logsFile -Encoding utf8
        $metrics | ConvertTo-Json -Depth 8 | Set-Content -Path $metricsFile -Encoding utf8
        Write-Step "Configuring diagnostic settings on $ResourceId"
        Invoke-AzRaw monitor diagnostic-settings create `
            --name $Name `
            --resource $ResourceId `
            --workspace $WorkspaceId `
            --export-to-resource-specific true `
            --logs "@$logsFile" `
            --metrics "@$metricsFile"
    } finally {
        Remove-Item $logsFile -Force -ErrorAction SilentlyContinue
        Remove-Item $metricsFile -Force -ErrorAction SilentlyContinue
    }
}

function Upsert-MetricAlert {
    param(
        [string]$Name,
        [string]$Scope,
        [string]$Condition,
        [string]$Description,
        [string]$ActionGroupId,
        [int]$Severity = 2,
        [string]$WindowSize = "5m",
        [string]$EvaluationFrequency = "1m"
    )

    if (Test-ResourceExists { Invoke-AzJson monitor metrics alert show --name $Name --resource-group $ResourceGroup }) {
        Invoke-AzRaw monitor metrics alert delete --name $Name --resource-group $ResourceGroup
    }

    Write-Step "Creating metric alert $Name"
    Invoke-AzRaw monitor metrics alert create `
        --name $Name `
        --resource-group $ResourceGroup `
        --scopes $Scope `
        --condition $Condition `
        --description $Description `
        --severity $Severity `
        --window-size $WindowSize `
        --evaluation-frequency $EvaluationFrequency `
        --action $ActionGroupId
}

function Remove-MetricAlertIfExists {
    param([string]$Name)

    if (Test-ResourceExists { Invoke-AzJson monitor metrics alert show --name $Name --resource-group $ResourceGroup }) {
        Write-Step "Removing metric alert $Name"
        Invoke-AzRaw monitor metrics alert delete --name $Name --resource-group $ResourceGroup
    }
}

function Upsert-ScheduledQueryAlert {
    param(
        [string]$Name,
        [string]$Scope,
        [string]$LocationName,
        [string]$QueryPlaceholder,
        [string]$QueryText,
        [string]$Condition,
        [string]$Description,
        [string]$ActionGroupId,
        [int]$Severity = 2,
        [string]$WindowSize = "10m",
        [string]$EvaluationFrequency = "5m"
    )

    if (Test-ResourceExists { Invoke-AzJson monitor scheduled-query show --name $Name --resource-group $ResourceGroup }) {
        Invoke-AzRaw monitor scheduled-query delete --name $Name --resource-group $ResourceGroup --yes
    }

    Write-Step "Creating scheduled query alert $Name"
    Invoke-AzRaw monitor scheduled-query create `
        --name $Name `
        --resource-group $ResourceGroup `
        --location $LocationName `
        --scopes $Scope `
        --condition $Condition `
        --condition-query "$QueryPlaceholder=$QueryText" `
        --description $Description `
        --severity $Severity `
        --window-size $WindowSize `
        --evaluation-frequency $EvaluationFrequency `
        --action-groups $ActionGroupId `
        --skip-query-validation true
}

function Ensure-AppInsightsTelemetry {
    param(
        [string]$EnvironmentName,
        [string]$GroupName,
        [string]$ConnectionString
    )

    Write-Step "Enabling Application Insights telemetry on Container Apps environment"
    Invoke-AzRaw containerapp env telemetry app-insights set `
        --name $EnvironmentName `
        --resource-group $GroupName `
        --connection-string $ConnectionString `
        --enable-open-telemetry-logs true `
        --enable-open-telemetry-traces true

    $envTelemetryConnection = Invoke-AzTsv containerapp env show --name $EnvironmentName --resource-group $GroupName --query properties.appInsightsConfiguration.connectionString
    if ([string]::IsNullOrWhiteSpace($envTelemetryConnection)) {
        Write-Warning "Container Apps environment telemetry binding still reports a null Application Insights connection string. Per-app telemetry env vars will be enforced as a deterministic fallback."
    }
}

function Ensure-ContainerAppScale {
    param(
        [string]$AppName,
        [int]$MinReplicas,
        [int]$MaxReplicas,
        [string]$PublicUrl = ""
    )

    $app = Invoke-AzJson containerapp show --name $AppName --resource-group $ResourceGroup
    $image = $app.properties.template.containers[0].image
    $updateArgs = @(
        "containerapp", "update",
        "--name", $AppName,
        "--resource-group", $ResourceGroup,
        "--image", $image,
        "--min-replicas", "$MinReplicas",
        "--max-replicas", "$MaxReplicas"
    )

    if (-not [string]::IsNullOrWhiteSpace($PublicUrl)) {
        $updateArgs += @("--set-env-vars", "APP_PUBLIC_URL=$PublicUrl")
    }

    Invoke-AzRaw @updateArgs
}

function Ensure-ContainerAppTelemetryEnv {
    param(
        [string]$AppName,
        [string]$ConnectionString
    )

    if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
        return
    }

    Write-Step "Setting explicit Application Insights env vars on $AppName"
    Invoke-AzRaw containerapp update `
        --name $AppName `
        --resource-group $ResourceGroup `
        --set-env-vars "APPLICATIONINSIGHTS_CONNECTION_STRING=$ConnectionString" "APPINSIGHTS_CONNECTIONSTRING=$ConnectionString"
}

function Ensure-AzureRedis {
    param(
        [string]$CacheName,
        [string]$GroupName,
        [string]$LocationName,
        [string]$Sku,
        [string]$VmSize
    )

    if (-not (Test-ResourceExists { Invoke-AzJson redis show --name $CacheName --resource-group $GroupName })) {
        Write-Step "Creating Azure Redis cache $CacheName"
        Invoke-AzRaw redis create `
            --name $CacheName `
            --resource-group $GroupName `
            --location $LocationName `
            --sku $Sku `
            --vm-size $VmSize `
            --minimum-tls-version 1.2
    }

    return Invoke-AzJson redis show --name $CacheName --resource-group $GroupName
}

function Set-KeyVaultSecret {
    param(
        [string]$VaultName,
        [string]$SecretName,
        [string]$SecretValue
    )

    Invoke-AzRaw keyvault secret set --vault-name $VaultName --name $SecretName --value $SecretValue
}

function Get-CurrentAccountEmail {
    return Invoke-AzTsv account show --query user.name
}

function Get-CurrentSubscriptionName {
    return Invoke-AzTsv account show --query name
}

function Wait-ForHttpOk {
    param(
        [string]$Url,
        [int]$Attempts = 30,
        [int]$SleepSeconds = 15
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds $SleepSeconds
            continue
        }

        Start-Sleep -Seconds $SleepSeconds
    }

    return $false
}

Write-Step "Ensuring Azure providers are registered"
foreach ($namespace in @("Microsoft.Cdn", "Microsoft.Network", "Microsoft.Insights", "Microsoft.OperationalInsights", "Microsoft.Cache", "Microsoft.App")) {
    Ensure-Provider -Namespace $namespace
}

if ([string]::IsNullOrWhiteSpace($AlertEmail)) {
    $AlertEmail = Get-CurrentAccountEmail
}

$workspaceId = Invoke-AzTsv monitor log-analytics workspace show --name $WorkspaceName --resource-group $ResourceGroup --query id
$apiApp = Invoke-AzJson containerapp show --name $ApiAppName --resource-group $ResourceGroup
$workerApp = Invoke-AzJson containerapp show --name $WorkerAppName --resource-group $ResourceGroup
$apiAppId = $apiApp.id
$workerAppId = $workerApp.id
$apiFqdn = $apiApp.properties.configuration.ingress.fqdn
$appInsights = Invoke-AzJson monitor app-insights component show --app $AppInsightsName --resource-group $ResourceGroup
$appInsightsConnectionString = $appInsights.connectionString

$frontDoorEnabled = (Get-CurrentSubscriptionName) -notmatch "Student"
$publicApiUrl = "https://$apiFqdn"

if ($frontDoorEnabled) {
    $profile = Ensure-FrontDoorProfile -GroupName $ResourceGroup -Name $FrontDoorProfileName
    $endpoint = Ensure-FrontDoorEndpoint -GroupName $ResourceGroup -ProfileName $FrontDoorProfileName -EndpointName $FrontDoorEndpointName
    $originGroup = Ensure-OriginGroup -GroupName $ResourceGroup -ProfileName $FrontDoorProfileName -OriginGroupName $FrontDoorOriginGroupName
    $origin = Ensure-Origin -GroupName $ResourceGroup -ProfileName $FrontDoorProfileName -OriginGroupName $FrontDoorOriginGroupName -OriginName $FrontDoorOriginName -HostName $apiFqdn
    $route = Ensure-Route -GroupName $ResourceGroup -ProfileName $FrontDoorProfileName -EndpointName $FrontDoorEndpointName -RouteName $FrontDoorRouteName -OriginGroupId $originGroup.id
    $wafPolicyId = Ensure-WafPolicy -GroupName $ResourceGroup -PolicyName $WafPolicyName -Mode $WafMode
    Ensure-SecurityPolicy -GroupName $ResourceGroup -ProfileName $FrontDoorProfileName -PolicyName $FrontDoorSecurityPolicyName -WafPolicyId $wafPolicyId -EndpointId $endpoint.id
    Ensure-DiagnosticSetting -Name "send-to-law" -ResourceId $profile.id -WorkspaceId $workspaceId
    $publicApiUrl = "https://$($endpoint.hostName)"
} else {
    Write-Warning "Azure Front Door is not available on the current Azure for Students subscription. Continuing with direct Container App ingress, telemetry, and alerts."
}

Ensure-AppInsightsTelemetry -EnvironmentName $ContainerEnvName -GroupName $ResourceGroup -ConnectionString $appInsightsConnectionString

Write-Step "Pinning persistent scale and public URL on Container Apps"
Ensure-ContainerAppScale -AppName $ApiAppName -MinReplicas 1 -MaxReplicas 3 -PublicUrl $publicApiUrl
Ensure-ContainerAppScale -AppName $WorkerAppName -MinReplicas 1 -MaxReplicas 1
Ensure-ContainerAppTelemetryEnv -AppName $ApiAppName -ConnectionString $appInsightsConnectionString
Ensure-ContainerAppTelemetryEnv -AppName $WorkerAppName -ConnectionString $appInsightsConnectionString

$actionGroupId = Ensure-ActionGroup -Name $ActionGroupName -GroupName $ResourceGroup -ReceiverEmail $AlertEmail

Remove-MetricAlertIfExists -Name "aura-api-restarts"
Remove-MetricAlertIfExists -Name "aura-worker-restarts"

Upsert-MetricAlert `
    -Name "aura-api-5xx-spike" `
    -Scope $apiAppId `
    -Condition "total Requests > 5 where statusCodeCategory includes 5xx" `
    -Description "Aura API is returning repeated 5xx responses." `
    -ActionGroupId $actionGroupId `
    -Severity 1 `
    -WindowSize "5m" `
    -EvaluationFrequency "1m"

Upsert-MetricAlert `
    -Name "aura-api-no-replicas" `
    -Scope $apiAppId `
    -Condition "min Replicas < 1" `
    -Description "Aura API lost all live replicas." `
    -ActionGroupId $actionGroupId `
    -Severity 0 `
    -WindowSize "10m" `
    -EvaluationFrequency "5m"

$controlPlaneQuery = @"
ContainerAppSystemLogs_CL
| where TimeGenerated > ago(10m)
| where ContainerAppName_s in~ ('$ApiAppName', '$WorkerAppName')
| where Type_s in~ ('Error')
    or Reason_s in~ ('ImagePullBackOff', 'ErrImagePull', 'ContainerCrashing', 'RevisionFailed', 'RevisionProvisioningError', 'ProbeFailed', 'HealthCheckFailed')
"@

$unexpectedTerminationQuery = @"
ContainerAppSystemLogs_CL
| where TimeGenerated > ago(10m)
| where ContainerAppName_s in~ ('$ApiAppName', '$WorkerAppName')
| where Type_s =~ 'ContainerTerminated'
| where Reason_s !in~ ('ManuallyStopped')
"@

$probeFailureQuery = @"
ContainerAppSystemLogs_CL
| where TimeGenerated > ago(5m)
| where ContainerAppName_s in~ ('$ApiAppName', '$WorkerAppName')
| where Reason_s in~ ('ProbeFailed', 'HealthCheckFailed')
"@

Upsert-ScheduledQueryAlert `
    -Name "aura-containerapp-control-plane-errors" `
    -Scope $workspaceId `
    -LocationName $Location `
    -QueryPlaceholder "CriticalControlPlaneEvents" `
    -QueryText $controlPlaneQuery `
    -Condition "count 'CriticalControlPlaneEvents' > 0" `
    -Description "Aura Container Apps emitted fatal platform or revision events." `
    -ActionGroupId $actionGroupId `
    -Severity 1 `
    -WindowSize "10m" `
    -EvaluationFrequency "5m"

Upsert-ScheduledQueryAlert `
    -Name "aura-containerapp-unexpected-terminations" `
    -Scope $workspaceId `
    -LocationName $Location `
    -QueryPlaceholder "UnexpectedTerminations" `
    -QueryText $unexpectedTerminationQuery `
    -Condition "count 'UnexpectedTerminations' > 0" `
    -Description "Aura Container Apps terminated a container for a reason other than a controlled rollout stop." `
    -ActionGroupId $actionGroupId `
    -Severity 1 `
    -WindowSize "10m" `
    -EvaluationFrequency "5m"

Upsert-ScheduledQueryAlert `
    -Name "aura-containerapp-probe-failures" `
    -Scope $workspaceId `
    -LocationName $Location `
    -QueryPlaceholder "ProbeFailures" `
    -QueryText $probeFailureQuery `
    -Condition "count 'ProbeFailures' > 2" `
    -Description "Aura Container Apps are accumulating readiness or startup probe failures before a restart happens." `
    -ActionGroupId $actionGroupId `
    -Severity 2 `
    -WindowSize "5m" `
    -EvaluationFrequency "5m"

if ($MigrateRedis) {
    $redis = Ensure-AzureRedis -CacheName $RedisCacheName -GroupName $ResourceGroup -LocationName $Location -Sku $RedisSku -VmSize $RedisVmSize
    $redisHost = $redis.hostName
    $redisSslPort = $redis.sslPort
    $redisPrimaryKey = Invoke-AzTsv redis list-keys --name $RedisCacheName --resource-group $ResourceGroup --query primaryKey
    $redisUrl = "rediss://:$redisPrimaryKey@$redisHost`:$redisSslPort"

    Write-Step "Updating Key Vault redis-url secret to Azure Redis"
    Set-KeyVaultSecret -VaultName $KeyVaultName -SecretName "redis-url" -SecretValue $redisUrl

    Write-Step "Restarting live revisions to pick up the rotated Redis secret"
    $apiLiveRevision = Invoke-AzTsv containerapp show --name $ApiAppName --resource-group $ResourceGroup --query properties.latestReadyRevisionName
    $workerLiveRevision = Invoke-AzTsv containerapp show --name $WorkerAppName --resource-group $ResourceGroup --query properties.latestReadyRevisionName
    Invoke-AzRaw containerapp revision restart --name $ApiAppName --resource-group $ResourceGroup --revision $apiLiveRevision
    Invoke-AzRaw containerapp revision restart --name $WorkerAppName --resource-group $ResourceGroup --revision $workerLiveRevision
}

Write-Step "Waiting for public API health endpoint"
if (-not (Wait-ForHttpOk -Url "$publicApiUrl/health/live")) {
    throw "Public API health check did not come online in time."
}

Write-Host ""
if ($frontDoorEnabled) {
    Write-Host "Front Door URL: $publicApiUrl" -ForegroundColor Green
    Write-Host "API through Front Door: $publicApiUrl/api" -ForegroundColor Green
    Write-Host "WAF mode: $WafMode" -ForegroundColor Green
} else {
    Write-Host "Public API URL: $publicApiUrl" -ForegroundColor Yellow
    Write-Host "Front Door/WAF skipped because Azure for Students blocks Azure Front Door." -ForegroundColor Yellow
}
Write-Host "Alert action group email: $AlertEmail" -ForegroundColor Green
if ($MigrateRedis) {
    Write-Host "Redis provider: Azure Cache for Redis ($RedisCacheName)" -ForegroundColor Green
}
