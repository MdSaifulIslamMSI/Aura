param(
    [string]$SourceEnvFile = ".\server\.env.aws-secrets",
    [string]$PathPrefix = "",
    [string]$AwsRegion = "",
    [string]$AwsProfile = "",
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

function Test-PlaceholderValue {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $true
    }

    $trimmed = $Value.Trim()
    return $trimmed -match '^(?i)(kv|ssm):' -or $trimmed -match '^<[^>]+>$'
}

function Invoke-AwsCli {
    param(
        [string[]]$Arguments
    )

    $output = & aws @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $message = if ($output) { ($output | Out-String).Trim() } else { "aws exited with code $LASTEXITCODE" }
        throw "AWS CLI command failed: $message"
    }

    return $output
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
$publishableEntries = New-Object System.Collections.Generic.List[object]

foreach ($entry in $entries.GetEnumerator()) {
    if (Test-PlaceholderValue -Value $entry.Value) {
        Write-Warning "Skipping placeholder value for $($entry.Key)"
        continue
    }

    $parameterName = "$resolvedPathPrefix/$($entry.Key)"
    $planEntry = [pscustomobject]@{
        key = $entry.Key
        parameterName = $parameterName
        length = $entry.Value.Length
    }
    $plan.Add($planEntry) | Out-Null
    $publishableEntries.Add([pscustomobject]@{
        key = $entry.Key
        parameterName = $parameterName
        value = $entry.Value
    }) | Out-Null
}

if ($DryRun) {
    $plan | ConvertTo-Json -Depth 4
    exit 0
}

foreach ($entry in $publishableEntries) {
    Write-Host "Publishing $($entry.parameterName)"
    $awsArgs = @(
        "ssm",
        "put-parameter",
        "--region", $resolvedAwsRegion,
        "--name", $entry.parameterName,
        "--type", "SecureString",
        "--tier", "Standard",
        "--overwrite",
        "--value", $entry.value
    )

    if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
        $awsArgs += @("--profile", $AwsProfile)
    }

    Invoke-AwsCli -Arguments $awsArgs | Out-Null
}

Write-Host "Published $($publishableEntries.Count) parameters to $resolvedPathPrefix in $resolvedAwsRegion."
