param(
  [string]$Path = "$HOME\.aws\aws-api-mcp\mcp-security-policy.json",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$policy = [ordered]@{
  version = "1.0"
  policy = [ordered]@{
    denyList = @(
      "aws iam delete-user",
      "aws iam delete-role",
      "aws iam delete-group",
      "aws iam delete-policy",
      "aws iam delete-access-key",
      "aws cloudtrail delete-trail",
      "aws cloudtrail stop-logging",
      "aws kms schedule-key-deletion",
      "aws organizations leave-organization"
    )
    elicitList = @(
      "aws s3 rm",
      "aws s3api delete-object",
      "aws s3api delete-bucket",
      "aws ssm put-parameter",
      "aws ssm delete-parameter",
      "aws ec2 stop-instances",
      "aws ec2 terminate-instances",
      "aws autoscaling delete-auto-scaling-group",
      "aws lambda update-function-code",
      "aws ecs update-service",
      "aws cloudformation deploy",
      "aws cloudformation delete-stack"
    )
  }
}

$resolvedPath = [System.IO.Path]::GetFullPath($Path)
$parent = Split-Path -Parent $resolvedPath
if (-not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

if ((Test-Path -LiteralPath $resolvedPath) -and -not $Force) {
  throw "Policy already exists at $resolvedPath. Pass -Force to overwrite."
}

$policy | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedPath -Encoding UTF8
Write-Host "Wrote AWS API MCP security policy to $resolvedPath"
