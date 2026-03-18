$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tagPath = Join-Path $repoRoot ".azure-image-tag"
$tag = Get-Content $tagPath -Raw
$tag = $tag.Trim()

if ([string]::IsNullOrWhiteSpace($tag)) {
    throw "Image tag file is empty."
}

$image = "auramsi20260318acr.azurecr.io/aura-backend:$tag"
$logPath = "C:\Users\mdsai\Downloads\azure-docker-build.log"
$errPath = "C:\Users\mdsai\Downloads\azure-docker-build.err.log"
$pidPath = "C:\Users\mdsai\Downloads\azure-docker-build.pid"

if (Test-Path $logPath) {
    Remove-Item $logPath -Force
}

if (Test-Path $errPath) {
    Remove-Item $errPath -Force
}

if (Test-Path $pidPath) {
    Remove-Item $pidPath -Force
}

$args = @(
    "build",
    "-f", (Join-Path $repoRoot "server\Dockerfile"),
    "-t", $image,
    (Join-Path $repoRoot "server")
)

$process = Start-Process -FilePath "docker" -ArgumentList $args -RedirectStandardOutput $logPath -RedirectStandardError $errPath -PassThru
Set-Content $pidPath $process.Id

Write-Output "PID=$($process.Id)"
Write-Output "IMAGE=$image"
Write-Output "LOG=$logPath"
Write-Output "ERR=$errPath"
