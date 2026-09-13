
# Stops what scripts/start-student-pack-dev.ps1 started: the backend (:5000)
# and frontend (:5173) listeners, the Mongo/Redis compose services, and
# LocalStack. -ForceKill additionally removes the compose containers and stops
# the optional LambdaTest tunnel.
param(
    [switch]$ForceKill
)

$ErrorActionPreference = "SilentlyContinue"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Test-CommandAvailable {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$stopped = 0
foreach ($port in 5000, 5173) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $ownerPid = $listener.OwningProcess
        $processName = (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue).ProcessName
        if ($processName -in @("System", "Idle")) { continue }
        Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped pid $ownerPid ($processName) listening on $port."
        $stopped++
    }
}
if ($stopped -eq 0) {
    Write-Host "No dev backend/frontend listeners found on 5000 or 5173."
}

if (Test-CommandAvailable "docker") {
    docker compose -f docker-compose.split-runtime.yml stop | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Mongo/Redis compose services stopped."
    } else {
        Write-Host "Compose services were not running (or Docker is unavailable)."
    }
}

if ($ForceKill) {
    docker compose -f docker-compose.split-runtime.yml down | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Compose containers removed (-ForceKill)."
    }

    $tunnels = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -like "*lt --user*" }
    foreach ($tunnel in $tunnels) {
        Stop-Process -Id $tunnel.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped LambdaTest tunnel pid $($tunnel.ProcessId)."
    }
}

if (Test-CommandAvailable "localstack") {
    localstack stop | Out-Null
    Write-Host "LocalStack stopped."
}

Write-Host "Aura dev environment is off."
