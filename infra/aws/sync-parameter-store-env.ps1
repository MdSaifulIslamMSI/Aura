param(
    [string]$SourceEnvFile = ".\server\.env.aws-secrets",
    [string]$PathPrefix = "",
    [string]$AwsRegion = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Resolve-NormalizedPathPrefix {
    param([string]$RawValue)

    if ([string]::IsNullOrWhiteSpace($RawValue)) {
        $normalized = ""
    } else {
        $normalized = $RawValue.Trim()
    }
    $normalized = $normalized.Trim("/")
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return ""
    }
    return "/$normalized"
}

function Parse-EnvFile {
    param([string]$FilePath)

    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "Source env file not found: $FilePath"
    }

    $entries = [ordered]@{}
    $rawLines = Get-Content -LiteralPath $FilePath
    foreach ($line in $rawLines) {
        if ($null -eq $line) {
            continue
        }

        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
            continue
        }

        $separatorIndex = $line.IndexOf("=")
        if ($separatorIndex -lt 1) {
            continue
        }

        $key = $line.Substring(0, $separatorIndex).Trim()
        $value = $line.Substring($separatorIndex + 1)
        if ([string]::IsNullOrWhiteSpace($key) -or [string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        $entries[$key] = $value
    }

    return $entries
}

Require-Command -Name "aws"

$resolvedSourceEnvFile = (Resolve-Path -LiteralPath $SourceEnvFile).Path
$resolvedAwsRegion = if ([string]::IsNullOrWhiteSpace($AwsRegion)) {
    if (-not [string]::IsNullOrWhiteSpace($env:AWS_REGION)) {
        $env:AWS_REGION
    } else {
        $env:AWS_DEFAULT_REGION
    }
} else {
    $AwsRegion
}

if ([string]::IsNullOrWhiteSpace($resolvedAwsRegion)) {
    throw "AWS region is required. Pass -AwsRegion or set AWS_REGION."
}

$resolvedPathPrefix = Resolve-NormalizedPathPrefix -RawValue $(if ([string]::IsNullOrWhiteSpace($PathPrefix)) { $env:AWS_PARAMETER_STORE_PATH_PREFIX } else { $PathPrefix })
if ([string]::IsNullOrWhiteSpace($resolvedPathPrefix)) {
    throw "AWS Parameter Store path prefix is required. Pass -PathPrefix or set AWS_PARAMETER_STORE_PATH_PREFIX."
}

$entries = Parse-EnvFile -FilePath $resolvedSourceEnvFile
$plan = New-Object System.Collections.Generic.List[object]

foreach ($entry in $entries.GetEnumerator()) {
    $parameterName = "$resolvedPathPrefix/$($entry.Key)"
    $plan.Add([pscustomobject]@{
        key = $entry.Key
        parameterName = $parameterName
        length = $entry.Value.Length
    }) | Out-Null
}

if ($DryRun) {
    $plan | ConvertTo-Json -Depth 4
    exit 0
}

foreach ($entry in $entries.GetEnumerator()) {
    $parameterName = "$resolvedPathPrefix/$($entry.Key)"
    Write-Host "Publishing $parameterName"
    aws ssm put-parameter `
        --region $resolvedAwsRegion `
        --name $parameterName `
        --type SecureString `
        --tier Standard `
        --overwrite `
        --value $entry.Value | Out-Null
}

Write-Host "Published $($plan.Count) parameters to $resolvedPathPrefix in $resolvedAwsRegion."
