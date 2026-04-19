param(
  [switch]$Upgrade,
  [switch]$VerifyAwsLogin
)

$ErrorActionPreference = "Stop"

$packages = @(
  "awslabs.aws-documentation-mcp-server",
  "awslabs.aws-api-mcp-server"
)

Write-Host "Installing AWS MCP Python packages for this plugin..."
$installArgs = @(
  "-m",
  "pip",
  "install",
  "--disable-pip-version-check",
  "--user"
)

if ($Upgrade) {
  $installArgs += "--upgrade"
}

$installArgs += $packages

& python @installArgs
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install AWS MCP packages."
}

Write-Host "Verifying Python imports..."
& python -c "import awslabs.aws_documentation_mcp_server.server; import awslabs.aws_api_mcp_server.server; print('AWS MCP Python modules are available.')"
if ($LASTEXITCODE -ne 0) {
  throw "Installed packages could not be imported."
}

Write-Host "Checking AWS CLI availability..."
& aws --version
if ($LASTEXITCODE -ne 0) {
  throw "AWS CLI is not available on PATH."
}

if ($VerifyAwsLogin) {
  Write-Host "Checking active AWS credentials with STS..."
  & aws sts get-caller-identity
  if ($LASTEXITCODE -ne 0) {
    throw "AWS credentials check failed. Run 'aws configure', 'aws configure sso', or 'aws login' and try again."
  }
}

Write-Host "AWS MCP bootstrap complete."
