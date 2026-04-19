param(
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$pluginRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $pluginRoot)

function Get-CommandInfo {
  param([string]$Name)

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    return [pscustomobject]@{
      found = $false
      source = $null
    }
  }

  return [pscustomobject]@{
    found = $true
    source = $cmd.Source
  }
}

function Test-PythonModule {
  param([string]$DistributionName)

  $version = $null
  $ok = $false

  $code = "import importlib.metadata as m; print(m.version('$DistributionName'))"
  $output = & python -W "ignore" -c $code 2>$null
  if ($LASTEXITCODE -eq 0) {
    $ok = $true
    $version = ($output | Out-String).Trim()
  }

  return [pscustomobject]@{
    installed = $ok
    version = $version
  }
}

function Get-CommandOutput {
  param(
    [string]$Name,
    [string[]]$Arguments
  )

  try {
    $result = & $Name @Arguments 2>&1
    $text = ($result | Out-String).Trim()
    if (($LASTEXITCODE -ne 0) -and [string]::IsNullOrWhiteSpace($text)) {
      $text = "Command failed with exit code $LASTEXITCODE"
    }
    return [pscustomobject]@{
      success = ($LASTEXITCODE -eq 0)
      output = $text
    }
  } catch {
    return [pscustomobject]@{
      success = $false
      output = $_.Exception.Message
    }
  }
}

function Test-RepoFile {
  param([string]$RelativePath)

  $path = Join-Path $repoRoot $RelativePath
  return [pscustomobject]@{
    path = $path
    exists = (Test-Path -LiteralPath $path)
  }
}

$pythonInfo = Get-CommandInfo -Name "python"
$awsInfo = Get-CommandInfo -Name "aws"
$nodeInfo = Get-CommandInfo -Name "node"

$pythonVersion = if ($pythonInfo.found) {
  Get-CommandOutput -Name "python" -Arguments @("--version")
} else {
  [pscustomobject]@{ success = $false; output = "python not found" }
}

$awsVersion = if ($awsInfo.found) {
  Get-CommandOutput -Name "aws" -Arguments @("--version")
} else {
  [pscustomobject]@{ success = $false; output = "aws not found" }
}

$nodeVersion = if ($nodeInfo.found) {
  Get-CommandOutput -Name "node" -Arguments @("--version")
} else {
  [pscustomobject]@{ success = $false; output = "node not found" }
}

$docModule = if ($pythonInfo.found) {
  Test-PythonModule -DistributionName "awslabs.aws-documentation-mcp-server"
} else {
  [pscustomobject]@{ installed = $false; version = $null }
}

$apiModule = if ($pythonInfo.found) {
  Test-PythonModule -DistributionName "awslabs.aws-api-mcp-server"
} else {
  [pscustomobject]@{ installed = $false; version = $null }
}

$repoFiles = @(
  "docs\aws-backend-deployment.md",
  "infra\aws\bootstrap-free-tier.ps1",
  "infra\aws\bootstrap-github-oidc.ps1",
  "infra\aws\sync-parameter-store-env.ps1",
  "infra\aws\deploy-release.sh",
  "server\.env.aws-secrets.example",
  "plugins\aws\.mcp.json"
) | ForEach-Object { Test-RepoFile -RelativePath $_ }

$mcpConfigStatus = [pscustomobject]@{
  valid = $false
  servers = @()
}
$configuredAwsProfile = $null

try {
  $mcpConfig = Get-Content -Raw (Join-Path $pluginRoot ".mcp.json") | ConvertFrom-Json
  $serverNames = @()
  if ($mcpConfig.mcpServers) {
    $serverNames = $mcpConfig.mcpServers.PSObject.Properties.Name
  }
  if ($mcpConfig.mcpServers.'aws-api-mcp-server'.env.AWS_API_MCP_PROFILE_NAME) {
    $configuredAwsProfile = $mcpConfig.mcpServers.'aws-api-mcp-server'.env.AWS_API_MCP_PROFILE_NAME
  }
  $mcpConfigStatus = [pscustomobject]@{
    valid = $true
    servers = $serverNames
  }
} catch {
  $mcpConfigStatus = [pscustomobject]@{
    valid = $false
    servers = @()
    error = $_.Exception.Message
  }
}

$stsArgs = @("sts", "get-caller-identity", "--output", "json")
if (-not [string]::IsNullOrWhiteSpace($configuredAwsProfile)) {
  $stsArgs += @("--profile", $configuredAwsProfile)
}

$sts = if ($awsInfo.found) {
  Get-CommandOutput -Name "aws" -Arguments $stsArgs
} else {
  [pscustomobject]@{ success = $false; output = "aws not found" }
}

$callerIdentity = $null
if ($sts.success) {
  try {
    $callerIdentity = $sts.output | ConvertFrom-Json
  } catch {
    $callerIdentity = $null
  }
}
$credentialError = if ($sts.success) {
  $null
} elseif ([string]::IsNullOrWhiteSpace($sts.output)) {
  "AWS credentials are not configured. Run aws login, aws configure sso, or aws configure."
} else {
  $sts.output
}

$pluginReady = $pythonInfo.found -and $awsInfo.found -and $docModule.installed -and $apiModule.installed -and $mcpConfigStatus.valid
$liveAwsReady = $pluginReady -and $sts.success

$report = [pscustomobject]@{
  pluginRoot = $pluginRoot
  python = [pscustomobject]@{
    found = $pythonInfo.found
    source = $pythonInfo.source
    version = $pythonVersion.output
  }
  awsCli = [pscustomobject]@{
    found = $awsInfo.found
    source = $awsInfo.source
    version = $awsVersion.output
  }
  node = [pscustomobject]@{
    found = $nodeInfo.found
    source = $nodeInfo.source
    version = $nodeVersion.output
  }
  pythonPackages = [pscustomobject]@{
    awsDocumentationMcp = $docModule
    awsApiMcp = $apiModule
  }
  credentials = [pscustomobject]@{
    configured = $sts.success
    callerIdentity = $callerIdentity
    error = $credentialError
  }
  repoFiles = $repoFiles
  mcpConfig = $mcpConfigStatus
  configuredAwsProfile = $configuredAwsProfile
  readiness = [pscustomobject]@{
    pluginReady = $pluginReady
    liveAwsReady = $liveAwsReady
  }
}

if ($Json) {
  $report | ConvertTo-Json -Depth 8
  exit 0
}

Write-Host "AWS Plugin Doctor"
Write-Host "Plugin root: $($report.pluginRoot)"
Write-Host ""
Write-Host "Toolchain"
Write-Host "  Python found: $($report.python.found) [$($report.python.version)]"
Write-Host "  AWS CLI found: $($report.awsCli.found) [$($report.awsCli.version)]"
Write-Host "  Node found: $($report.node.found) [$($report.node.version)]"
Write-Host ""
Write-Host "Python MCP packages"
Write-Host "  AWS Documentation MCP: $($report.pythonPackages.awsDocumentationMcp.installed) $($report.pythonPackages.awsDocumentationMcp.version)"
Write-Host "  AWS API MCP: $($report.pythonPackages.awsApiMcp.installed) $($report.pythonPackages.awsApiMcp.version)"
Write-Host ""
Write-Host "Credentials"
if ($report.credentials.configured -and $report.credentials.callerIdentity) {
  Write-Host "  Configured: True"
  Write-Host "  Account: $($report.credentials.callerIdentity.Account)"
  Write-Host "  Arn: $($report.credentials.callerIdentity.Arn)"
} else {
  Write-Host "  Configured: False"
  Write-Host "  Error: $($report.credentials.error)"
}
Write-Host ""
Write-Host "Repo files"
foreach ($item in $report.repoFiles) {
  Write-Host "  $($item.exists) - $($item.path)"
}
Write-Host ""
Write-Host "MCP config"
Write-Host "  Valid: $($report.mcpConfig.valid)"
Write-Host "  Servers: $([string]::Join(', ', $report.mcpConfig.servers))"
Write-Host "  AWS API profile: $($report.configuredAwsProfile)"
Write-Host ""
Write-Host "Readiness"
Write-Host "  Plugin ready: $($report.readiness.pluginReady)"
Write-Host "  Live AWS ready: $($report.readiness.liveAwsReady)"
