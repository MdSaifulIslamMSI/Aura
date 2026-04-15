param(
    [ValidateSet("deploy", "runtime-sync", "rollback")]
    [string]$Mode = "deploy",
    [string]$SubscriptionId = "",
    [string]$ClientId = "",
    [string]$ResourceGroup = "rg-aura-prod",
    [string]$RegistryName = "auramsi20260318acr",
    [string]$KeyVaultName = "aura-msi-20260318-kv",
    [string]$IdentityName = "aura-msi-backend-id"
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

function Invoke-AzProbe {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $raw = & az @Arguments 2>&1
    $output = ($raw | Out-String).Trim()

    return [pscustomobject]@{
        Success = ($LASTEXITCODE -eq 0)
        Output = $output
    }
}

function Resolve-ClientId {
    param([string]$PreferredClientId)

    if (-not [string]::IsNullOrWhiteSpace($PreferredClientId)) {
        return $PreferredClientId.Trim()
    }

    $envClientId = [Environment]::GetEnvironmentVariable("AZURE_CLIENT_ID")
    if (-not [string]::IsNullOrWhiteSpace($envClientId)) {
        return $envClientId.Trim()
    }

    $account = Invoke-AzJson -Arguments @("account", "show", "--output", "json")
    $candidate = [string]$account.user.name
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw "Could not resolve the Azure principal client id. Pass -ClientId or set AZURE_CLIENT_ID."
    }

    return $candidate.Trim()
}

function Resolve-ResourceId {
    param(
        [string]$Label,
        [string[]]$Arguments,
        [string]$AuthHint,
        [string]$MissingHint
    )

    $probe = Invoke-AzProbe -Arguments $Arguments
    if ($probe.Success) {
        return $probe.Output
    }

    if ($probe.Output -match "AuthorizationFailed" -or $probe.Output -match "does not have authorization") {
        throw "$AuthHint`n$($probe.Output)"
    }

    throw "$MissingHint`n$($probe.Output)"
}

function Test-RoleAssignment {
    param(
        [string]$ResolvedClientId,
        [string]$TargetScope,
        [string[]]$AcceptedRoleNames
    )

    foreach ($roleName in $AcceptedRoleNames) {
        $probe = Invoke-AzProbe -Arguments @(
            "role", "assignment", "list",
            "--assignee", $ResolvedClientId,
            "--scope", $TargetScope,
            "--include-inherited",
            "--role", $roleName,
            "--fill-principal-name", "false",
            "--fill-role-definition-name", "false",
            "--query", "[0].id",
            "--output", "tsv"
        )

        if (-not $probe.Success) {
            throw "Failed to evaluate Azure RBAC role '$roleName' on scope '$TargetScope'.`n$($probe.Output)"
        }

        if (-not [string]::IsNullOrWhiteSpace($probe.Output)) {
            return $true
        }
    }

    return $false
}

function New-Requirement {
    param(
        [string]$Name,
        [string]$Scope,
        [string[]]$AcceptedRoleNames,
        [string]$Hint
    )

    return [pscustomobject]@{
        Name = $Name
        Scope = $Scope
        AcceptedRoleNames = @($AcceptedRoleNames)
        Hint = $Hint
    }
}

if ($SubscriptionId) {
    & az account set --subscription $SubscriptionId | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to select Azure subscription $SubscriptionId."
    }
}

$null = Invoke-AzJson -Arguments @("account", "show", "--output", "json")
$resolvedClientId = Resolve-ClientId -PreferredClientId $ClientId

$resourceGroupId = Resolve-ResourceId `
    -Label "resource group" `
    -Arguments @("group", "show", "--name", $ResourceGroup, "--query", "id", "--output", "tsv") `
    -AuthHint "Azure principal $resolvedClientId cannot read resource group $ResourceGroup. Grant Reader or Contributor on the resource group before rerunning the workflow." `
    -MissingHint "Azure resource group $ResourceGroup could not be resolved."

$requirements = @(
    (New-Requirement -Name "resource group read" -Scope $resourceGroupId -AcceptedRoleNames @("Reader", "Contributor", "Owner") -Hint "Grant Reader or Contributor on the backend resource group."),
    (New-Requirement -Name "Container Apps management" -Scope $resourceGroupId -AcceptedRoleNames @("Container Apps Contributor", "Contributor", "Owner") -Hint "Grant Container Apps Contributor on the backend resource group.")
)

if ($Mode -eq "deploy") {
    $registryId = Resolve-ResourceId `
        -Label "container registry" `
        -Arguments @("acr", "show", "--name", $RegistryName, "--resource-group", $ResourceGroup, "--query", "id", "--output", "tsv") `
        -AuthHint "Azure principal $resolvedClientId cannot read Azure Container Registry $RegistryName. Grant Reader on the resource group in addition to AcrPush on the registry." `
        -MissingHint "Azure Container Registry $RegistryName could not be resolved in resource group $ResourceGroup."

    $requirements += New-Requirement -Name "ACR image push" -Scope $registryId -AcceptedRoleNames @("AcrPush") -Hint "Grant AcrPush on the Azure Container Registry."
}

if ($Mode -in @("deploy", "runtime-sync")) {
    $keyVaultId = Resolve-ResourceId `
        -Label "key vault" `
        -Arguments @("keyvault", "show", "--name", $KeyVaultName, "--resource-group", $ResourceGroup, "--query", "id", "--output", "tsv") `
        -AuthHint "Azure principal $resolvedClientId cannot read Azure Key Vault $KeyVaultName. Grant Reader on the resource group and a Key Vault RBAC data-plane role before rerunning the workflow." `
        -MissingHint "Azure Key Vault $KeyVaultName could not be resolved in resource group $ResourceGroup."

    $identityId = Resolve-ResourceId `
        -Label "managed identity" `
        -Arguments @("identity", "show", "--name", $IdentityName, "--resource-group", $ResourceGroup, "--query", "id", "--output", "tsv") `
        -AuthHint "Azure principal $resolvedClientId cannot read managed identity $IdentityName. Grant Reader on the resource group before rerunning the workflow." `
        -MissingHint "Managed identity $IdentityName could not be resolved in resource group $ResourceGroup."

    $requirements += New-Requirement -Name "Key Vault secret sync" -Scope $keyVaultId -AcceptedRoleNames @("Key Vault Secrets Officer", "Key Vault Administrator") -Hint "Grant Key Vault Secrets Officer on the Azure Key Vault."
    $requirements += New-Requirement -Name "managed identity attachment" -Scope $identityId -AcceptedRoleNames @("Managed Identity Operator", "Contributor", "Owner") -Hint "Grant Managed Identity Operator on the backend user-assigned identity."
}

$missing = @()
foreach ($requirement in $requirements) {
    $hasAssignment = Test-RoleAssignment `
        -ResolvedClientId $resolvedClientId `
        -TargetScope $requirement.Scope `
        -AcceptedRoleNames $requirement.AcceptedRoleNames

    if (-not $hasAssignment) {
        $missing += [pscustomobject]@{
            Name = $requirement.Name
            Scope = $requirement.Scope
            AcceptedRoleNames = ($requirement.AcceptedRoleNames -join ", ")
            Hint = $requirement.Hint
        }
    }
}

if ($missing.Count -gt 0) {
    Write-Host "Azure workload identity access check failed." -ForegroundColor Red
    foreach ($entry in $missing) {
        Write-Host "- Missing $($entry.Name) on $($entry.Scope)" -ForegroundColor Yellow
        Write-Host "  Accepted roles: $($entry.AcceptedRoleNames)" -ForegroundColor DarkYellow
        Write-Host "  Fix: $($entry.Hint)" -ForegroundColor DarkYellow
    }

    throw "Azure access preflight failed. Rerun infra\\azure\\bootstrap-github-oidc.ps1 or assign the missing RBAC roles manually, then rerun the workflow."
}

Write-Host "Azure workload identity access validated for mode '$Mode'." -ForegroundColor Green
Write-Host "Principal: $resolvedClientId" -ForegroundColor DarkGray
