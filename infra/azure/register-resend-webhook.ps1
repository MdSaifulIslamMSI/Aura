[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ResendApiKey,

    [string]$WebhookEndpoint = "https://aura-msi-api-ca.wittycliff-f743de69.southeastasia.azurecontainerapps.io/api/email-webhooks/resend",
    [string]$ResourceGroup = "rg-aura-prod",
    [string]$KeyVaultName = "aura-msi-20260318-kv",
    [string]$ApiContainerAppName = "aura-msi-api-ca",
    [string]$WorkerContainerAppName = "aura-msi-worker-ca",
    [string]$ManagedIdentityResourceId = "/subscriptions/f7bef511-7ed6-4896-a010-45e5ecd699ef/resourceGroups/rg-aura-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/aura-msi-backend-id",
    [string[]]$Events = @(
        "email.sent",
        "email.delivered",
        "email.delivery_delayed",
        "email.bounced",
        "email.complained",
        "email.opened",
        "email.clicked",
        "email.failed",
        "email.suppressed"
    )
)

$ErrorActionPreference = "Stop"

function Invoke-ResendApi {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("GET", "POST", "PATCH")]
        [string]$Method,

        [Parameter(Mandatory = $true)]
        [string]$Path,

        [object]$Body
    )

    $uri = "https://api.resend.com$Path"
    $headers = @{
        Authorization = "Bearer $ResendApiKey"
        "Content-Type" = "application/json"
    }

    if ($PSBoundParameters.ContainsKey("Body")) {
        $jsonBody = $Body | ConvertTo-Json -Depth 8
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $jsonBody
    }

    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Ensure-WebhookSigningSecret {
    Write-Host "Checking existing Resend webhooks..." -ForegroundColor Cyan
    $listResponse = Invoke-ResendApi -Method GET -Path "/webhooks"
    $webhooks = @($listResponse.data)

    $matchingWebhook = $webhooks | Where-Object { $_.endpoint -eq $WebhookEndpoint } | Select-Object -First 1
    $desiredEvents = @($Events | Sort-Object -Unique)

    if ($null -eq $matchingWebhook) {
        Write-Host "Creating Resend webhook..." -ForegroundColor Cyan
        $createResponse = Invoke-ResendApi -Method POST -Path "/webhooks" -Body @{
            endpoint = $WebhookEndpoint
            events   = $desiredEvents
        }
        $created = $createResponse.data
        if (-not $created.id -or -not $created.signing_secret) {
            throw "Resend webhook creation did not return id and signing_secret."
        }
        return [pscustomobject]@{
            Id            = $created.id
            SigningSecret = $created.signing_secret
            Created       = $true
        }
    }

    $currentEvents = @($matchingWebhook.events | Sort-Object -Unique)
    $eventsDiffer = ($currentEvents.Count -ne $desiredEvents.Count) -or (Compare-Object -ReferenceObject $currentEvents -DifferenceObject $desiredEvents)
    $status = [string]$matchingWebhook.status

    if ($eventsDiffer -or $status -ne "enabled") {
        Write-Host "Updating existing Resend webhook..." -ForegroundColor Cyan
        Invoke-ResendApi -Method PATCH -Path "/webhooks/$($matchingWebhook.id)" -Body @{
            endpoint = $WebhookEndpoint
            events   = $desiredEvents
            status   = "enabled"
        } | Out-Null
    } else {
        Write-Host "Existing Resend webhook already matches the desired endpoint and events." -ForegroundColor Cyan
    }

    $getResponse = Invoke-ResendApi -Method GET -Path "/webhooks/$($matchingWebhook.id)"
    $resolved = $getResponse.data
    if (-not $resolved.id -or -not $resolved.signing_secret) {
        throw "Resend webhook retrieval did not return id and signing_secret."
    }

    return [pscustomobject]@{
        Id            = $resolved.id
        SigningSecret = $resolved.signing_secret
        Created       = $false
    }
}

function Set-KeyVaultSecretValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SecretName,

        [Parameter(Mandatory = $true)]
        [string]$SecretValue
    )

    az keyvault secret set `
        --vault-name $KeyVaultName `
        --name $SecretName `
        --value $SecretValue `
        --output none | Out-Null
}

function Sync-ContainerAppWebhookSecret {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerAppName,

        [switch]$PromoteLatestRevision
    )

    $secretUrl = "https://$KeyVaultName.vault.azure.net/secrets/resend-webhook-secret"
    az containerapp secret set `
        --resource-group $ResourceGroup `
        --name $ContainerAppName `
        --secrets "resendweb=keyvaultref:$secretUrl,identityref:$ManagedIdentityResourceId" `
        --output none | Out-Null

    az containerapp update `
        --resource-group $ResourceGroup `
        --name $ContainerAppName `
        --set-env-vars "RESEND_WEBHOOK_SECRET=secretref:resendweb" `
        --output none | Out-Null

    if ($PromoteLatestRevision.IsPresent) {
        az containerapp ingress traffic set `
            --resource-group $ResourceGroup `
            --name $ContainerAppName `
            --revision-weight latest=100 `
            --output none | Out-Null
    }
}

function Get-ContainerAppEnvState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerAppName
    )

    $query = "properties.template.containers[0].env[?name=='RESEND_WEBHOOK_SECRET'].{name:name,secretRef:secretRef}"
    az containerapp show `
        --resource-group $ResourceGroup `
        --name $ContainerAppName `
        --query $query `
        --output json | ConvertFrom-Json
}

$webhook = Ensure-WebhookSigningSecret
Write-Host "Storing Resend webhook signing secret in Azure Key Vault..." -ForegroundColor Cyan
Set-KeyVaultSecretValue -SecretName "resend-webhook-secret" -SecretValue $webhook.SigningSecret

Write-Host "Updating Azure Container Apps..." -ForegroundColor Cyan
Sync-ContainerAppWebhookSecret -ContainerAppName $ApiContainerAppName -PromoteLatestRevision
Sync-ContainerAppWebhookSecret -ContainerAppName $WorkerContainerAppName

$apiEnvState = Get-ContainerAppEnvState -ContainerAppName $ApiContainerAppName
$workerEnvState = Get-ContainerAppEnvState -ContainerAppName $WorkerContainerAppName

Write-Host ""
Write-Host "Resend webhook registration complete." -ForegroundColor Green
Write-Host ("Webhook ID: " + $webhook.Id)
Write-Host ("Endpoint: " + $WebhookEndpoint)
Write-Host ("Created: " + [string]$webhook.Created)
Write-Host ("API env ref: " + (($apiEnvState | ConvertTo-Json -Compress)))
Write-Host ("Worker env ref: " + (($workerEnvState | ConvertTo-Json -Compress)))
