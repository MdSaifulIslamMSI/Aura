param(
    [string]$SubscriptionId = "",
    [string]$ResourceGroup = "rg-aura-prod",
    [string]$RegistryName = "auramsi20260318acr",
    [string]$KeyVaultName = "aura-msi-20260318-kv",
    [string]$IdentityName = "aura-msi-backend-id",
    [string]$AppRegistrationName = "aura-github-actions-prod",
    [string]$RepoOwner = "MdSaifulIslamMSI",
    [string]$RepoName = "Aura",
    [string]$Branch = "main",
    [string]$FederatedCredentialName = "github-main",
    [string]$OutputFile = "infra/azure/github-oidc.env"
)

$ErrorActionPreference = "Stop"

function Invoke-AzJson {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $raw = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($Arguments -join ' ')"
    }

    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }

    return $raw | ConvertFrom-Json
}

function Invoke-AzText {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $raw = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($Arguments -join ' ')"
    }

    return ($raw | Out-String).Trim()
}

function Ensure-RoleAssignment {
    param(
        [string]$PrincipalObjectId,
        [string]$RoleName,
        [string]$Scope
    )

    $existing = Invoke-AzJson -Arguments @(
        "role", "assignment", "list",
        "--assignee-object-id", $PrincipalObjectId,
        "--scope", $Scope,
        "--query", "[?roleDefinitionName=='$RoleName']",
        "--output", "json"
    )

    if ($existing -and $existing.Count -gt 0) {
        Write-Host "Role assignment already present: $RoleName @ $Scope" -ForegroundColor DarkGray
        return
    }

    Write-Host "Creating role assignment: $RoleName @ $Scope" -ForegroundColor Cyan
    & az role assignment create `
        --assignee-object-id $PrincipalObjectId `
        --assignee-principal-type ServicePrincipal `
        --role $RoleName `
        --scope $Scope | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create role assignment $RoleName."
    }
}

if ($SubscriptionId) {
    & az account set --subscription $SubscriptionId | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to select Azure subscription $SubscriptionId."
    }
}

$account = Invoke-AzJson -Arguments @("account", "show", "--output", "json")
$tenantId = $account.tenantId
$subscriptionId = $account.id

$resourceGroupId = Invoke-AzText -Arguments @("group", "show", "--name", $ResourceGroup, "--query", "id", "--output", "tsv")
$registryId = Invoke-AzText -Arguments @("acr", "show", "--name", $RegistryName, "--resource-group", $ResourceGroup, "--query", "id", "--output", "tsv")
try {
    $keyVaultId = Invoke-AzText -Arguments @("keyvault", "show", "--name", $KeyVaultName, "--resource-group", $ResourceGroup, "--query", "id", "--output", "tsv")
} catch {
    throw "Azure Key Vault $KeyVaultName was not found in resource group $ResourceGroup. Create it or pass -KeyVaultName before bootstrapping GitHub OIDC."
}
try {
    $identityId = Invoke-AzText -Arguments @("identity", "show", "--name", $IdentityName, "--resource-group", $ResourceGroup, "--query", "id", "--output", "tsv")
} catch {
    throw "Azure user-assigned managed identity $IdentityName was not found in resource group $ResourceGroup. Create it or pass -IdentityName before bootstrapping GitHub OIDC."
}

$existingApp = Invoke-AzJson -Arguments @("ad", "app", "list", "--display-name", $AppRegistrationName, "--query", "[0]", "--output", "json")
if (-not $existingApp) {
    Write-Host "Creating app registration $AppRegistrationName" -ForegroundColor Cyan
    $existingApp = Invoke-AzJson -Arguments @("ad", "app", "create", "--display-name", $AppRegistrationName, "--output", "json")
} else {
    Write-Host "Using existing app registration $AppRegistrationName" -ForegroundColor DarkGray
}

$appObjectId = $existingApp.id
$clientId = $existingApp.appId

$servicePrincipal = Invoke-AzJson -Arguments @("ad", "sp", "list", "--filter", "appId eq '$clientId'", "--query", "[0]", "--output", "json")
if (-not $servicePrincipal) {
    Write-Host "Creating service principal for $clientId" -ForegroundColor Cyan
    $servicePrincipal = Invoke-AzJson -Arguments @("ad", "sp", "create", "--id", $clientId, "--output", "json")
} else {
    Write-Host "Using existing service principal for $clientId" -ForegroundColor DarkGray
}

$principalObjectId = $servicePrincipal.id

$subject = "repo:${RepoOwner}/${RepoName}:ref:refs/heads/${Branch}"
$credentialPayload = @{
    name = $FederatedCredentialName
    issuer = "https://token.actions.githubusercontent.com"
    subject = $subject
    audiences = @("api://AzureADTokenExchange")
} | ConvertTo-Json -Depth 5

$tempFile = Join-Path $env:TEMP "github-federated-credential.json"
$credentialPayload | Set-Content -Path $tempFile -Encoding utf8

$existingCredential = Invoke-AzJson -Arguments @("ad", "app", "federated-credential", "list", "--id", $appObjectId, "--query", "[?name=='$FederatedCredentialName'] | [0]", "--output", "json")
if ($existingCredential) {
    Write-Host "Refreshing federated credential $FederatedCredentialName" -ForegroundColor Cyan
    & az ad app federated-credential delete --id $appObjectId --federated-credential-id $FederatedCredentialName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to delete existing federated credential $FederatedCredentialName."
    }
} else {
    Write-Host "Creating federated credential $FederatedCredentialName" -ForegroundColor Cyan
}

& az ad app federated-credential create --id $appObjectId --parameters "@$tempFile" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create federated credential $FederatedCredentialName."
}

Ensure-RoleAssignment -PrincipalObjectId $principalObjectId -RoleName "Reader" -Scope $resourceGroupId
Ensure-RoleAssignment -PrincipalObjectId $principalObjectId -RoleName "Container Apps Contributor" -Scope $resourceGroupId
Ensure-RoleAssignment -PrincipalObjectId $principalObjectId -RoleName "AcrPush" -Scope $registryId
Ensure-RoleAssignment -PrincipalObjectId $principalObjectId -RoleName "Key Vault Secrets Officer" -Scope $keyVaultId
Ensure-RoleAssignment -PrincipalObjectId $principalObjectId -RoleName "Managed Identity Operator" -Scope $identityId

$outputContent = @"
AZURE_CLIENT_ID=$clientId
AZURE_TENANT_ID=$tenantId
AZURE_SUBSCRIPTION_ID=$subscriptionId
AZURE_RESOURCE_GROUP=$ResourceGroup
AZURE_ACR_NAME=$RegistryName
"@

$outputDir = Split-Path -Parent $OutputFile
if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$outputContent | Set-Content -Path $OutputFile -Encoding utf8

Write-Host ""
Write-Host "Azure GitHub OIDC bootstrap complete." -ForegroundColor Green
Write-Host "Reference file written to $OutputFile" -ForegroundColor Green
Write-Host ""
Write-Host "The current workflows already inline these non-secret OIDC IDs:" -ForegroundColor Yellow
Write-Host "  AZURE_CLIENT_ID=$clientId"
Write-Host "  AZURE_TENANT_ID=$tenantId"
Write-Host "  AZURE_SUBSCRIPTION_ID=$subscriptionId"
