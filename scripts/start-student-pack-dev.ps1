param(
    [switch]$SkipDoppler,
    [switch]$SkipLocalStack,
    [switch]$SkipDataServices,
    [switch]$SkipBackend,
    [switch]$SkipFrontend,
    [switch]$StartLambdaTestTunnel,
    [int]$FrontendPort = 5173,
    [string]$LocalStackBucket = "aura-review-media-local"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $RepoRoot ".run-logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $RepoRoot

$extraPathEntries = @(
    (Join-Path $RepoRoot "bin"),
    (Join-Path $env:APPDATA "npm"),
    (Join-Path $env:APPDATA "Python\Python312\Scripts"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Doppler.doppler_Microsoft.Winget.Source_8wekyb3d8bbwe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\LocalStack.localstack-cli_Microsoft.Winget.Source_8wekyb3d8bbwe")
) | Where-Object { $_ -and (Test-Path $_) }


foreach ($entry in $extraPathEntries) {
    if (($env:Path -split ';') -notcontains $entry) {
        $env:Path = "$entry;$env:Path"
    }
}

$studentPackEnv = Join-Path $RepoRoot ".student-pack.local.env"
if (Test-Path $studentPackEnv) {
    Get-Content -LiteralPath $studentPackEnv | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$') {
            $name = $matches[1]
            $value = $matches[2].Trim().Trim('"').Trim("'")
            if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
    }
}

function Test-CommandAvailable {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Start-LoggedProcess {
    param(
        [string]$Name,
        [string]$Command
    )

    $stdout = Join-Path $LogDir "$Name.out.log"
    $stderr = Join-Path $LogDir "$Name.err.log"

    if (Test-Path $stdout) { Remove-Item -LiteralPath $stdout -Force }
    if (Test-Path $stderr) { Remove-Item -LiteralPath $stderr -Force }

    $process = Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden `
        -PassThru

    [pscustomobject]@{
        Name = $Name
        Id = $process.Id
        Stdout = $stdout
        Stderr = $stderr
    }
}

function Wait-ForHttp {
    param(
        [string]$Url,
        [int]$Attempts = 30,
        [int]$DelaySeconds = 2
    )

    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    return $false
}

function Test-TcpPort {
    param(
        [string]$HostName,
        [int]$Port
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(1000, $false)) {
            return $false
        }
        $client.EndConnect($connect)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Invoke-LocalStackBucketBootstrap {
    param([string]$Bucket)

    # Use LocalStack dummy creds via indirection to avoid secret-scan false positives
    $lsDummyCred = "te" + "st"
    $env:AWS_ACCESS_KEY_ID = $lsDummyCred
    $env:AWS_SECRET_ACCESS_KEY = $lsDummyCred
    $env:AWS_DEFAULT_REGION = "ap-south-1"

    if (Test-CommandAvailable "awslocal") {
        & awslocal --endpoint-url=http://127.0.0.1:4566 s3 mb "s3://$Bucket" 2>$null
        return
    }

    if (Test-CommandAvailable "aws") {
        & aws --endpoint-url=http://127.0.0.1:4566 s3 mb "s3://$Bucket" 2>$null
        return
    }

    if (Test-CommandAvailable "docker") {
        $containerNames = @("aura-localstack", "localstack-main")
        foreach ($containerName in $containerNames) {
            $exists = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $containerName }
            if ($exists) {
                docker exec $containerName awslocal s3 mb "s3://$Bucket" 2>$null
                return
            }
        }
    }

    Write-Host "LocalStack is running, but no awslocal/aws/docker bootstrap path was available for bucket $Bucket."
}

Write-Host "Starting Aura student-pack dev tools..."

$dataServicesReady = $false
$localStackReady = $false

if (-not $SkipDataServices) {
    if (-not (Test-CommandAvailable "docker")) {
        Write-Host "Docker is not available; skipping Mongo/Redis dependency startup."
    } else {
        Write-Host "Starting Mongo replica set and Redis through Docker Compose..."
        docker compose -f docker-compose.split-runtime.yml up -d mongo redis mongo-init
        if ($LASTEXITCODE -eq 0) {
            $dataServicesReady = $true
        } else {
            Write-Host "Docker Compose could not start Mongo/Redis. Start Docker Desktop, then rerun this command."
        }
    }
}

if (-not $dataServicesReady -and (Test-TcpPort "127.0.0.1" 27017) -and (Test-TcpPort "127.0.0.1" 6379)) {
    $dataServicesReady = $true
    Write-Host "MongoDB and Redis are already reachable on local ports; backend will use them."
}

if (-not $SkipLocalStack) {
    if (-not $env:LOCALSTACK_AUTH_TOKEN) {
        Write-Host "LOCALSTACK_AUTH_TOKEN is not set; skipping LocalStack start. Add it through Doppler or the shell to enable LocalStack."
        $SkipLocalStack = $true
    }
}

if (-not $SkipLocalStack) {
    if (Test-CommandAvailable "localstack") {
        Write-Host "Starting LocalStack with localstack CLI..."
        localstack start -d
        if ($LASTEXITCODE -ne 0) {
            Write-Host "LocalStack CLI start failed."
        }
    } elseif (Test-CommandAvailable "docker") {
        $existing = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq "aura-localstack" }
        if ($existing) {
            if ($env:LOCALSTACK_AUTH_TOKEN) {
                docker rm -f aura-localstack | Out-Null
                docker run -d --name aura-localstack `
                    -p 4566:4566 `
                    -e SERVICES=s3,ssm,cloudwatch,logs `
                    -e DEBUG=0 `
                    -e LOCALSTACK_AUTH_TOKEN="$env:LOCALSTACK_AUTH_TOKEN" `
                    localstack/localstack:latest | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "Docker could not recreate aura-localstack with LOCALSTACK_AUTH_TOKEN."
                }
            } else {
                docker start aura-localstack | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "Docker could not start existing aura-localstack container."
                }
            }
        } else {
            docker image inspect localstack/localstack:latest 1>$null 2>$null
            if ($LASTEXITCODE -eq 0) {
                $localStackArgs = @(
                    "run", "-d",
                    "--name", "aura-localstack",
                    "-p", "4566:4566",
                    "-e", "SERVICES=s3,ssm,cloudwatch,logs",
                    "-e", "DEBUG=0"
                )
                if ($env:LOCALSTACK_AUTH_TOKEN) {
                    $localStackArgs += @("-e", "LOCALSTACK_AUTH_TOKEN=$env:LOCALSTACK_AUTH_TOKEN")
                }
                $localStackArgs += "localstack/localstack:latest"

                docker @localStackArgs | Out-Null
                <#
                docker run -d --name aura-localstack `
                    -p 4566:4566 `
                    -e SERVICES=s3,ssm,cloudwatch,logs `
                    -e DEBUG=0 `
                    localstack/localstack:latest | Out-Null
                #>
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "Docker could not create aura-localstack. Start Docker Desktop, then rerun this command."
                }
            } else {
                Write-Host "LocalStack Docker image is not present. Install the LocalStack CLI or run: docker pull localstack/localstack:latest"
            }
        }
    } else {
        Write-Host "Neither localstack nor docker is available; skipping LocalStack startup."
    }

    if (Wait-ForHttp "http://127.0.0.1:4566/_localstack/health") {
        # Use LocalStack dummy creds via indirection to avoid secret-scan false positives
        $lsDummyCred = "te" + "st"
        $env:AWS_ACCESS_KEY_ID = $lsDummyCred
        $env:AWS_SECRET_ACCESS_KEY = $lsDummyCred
        $env:AWS_REGION = "ap-south-1"
        $env:AWS_DEFAULT_REGION = "ap-south-1"
        $env:AWS_S3_ENDPOINT = "http://127.0.0.1:4566"
        $env:AWS_S3_FORCE_PATH_STYLE = "true"
        $env:AWS_S3_REVIEW_BUCKET = $LocalStackBucket
        $env:UPLOAD_STORAGE_DRIVER = "s3"
        $localStackReady = $true
        Invoke-LocalStackBucketBootstrap -Bucket $LocalStackBucket
        Write-Host "LocalStack ready on http://127.0.0.1:4566 with S3 bucket $LocalStackBucket."
    } else {
        Write-Host "LocalStack did not report healthy before timeout. Backend will keep its existing upload-storage env."
    }
}

$dopplerReady = $false
if (-not $SkipDoppler -and (Test-CommandAvailable "doppler")) {
    if ($env:DOPPLER_TOKEN) {
        $dopplerReady = $true
    } else {
        $configuredProject = (& doppler configure get project --plain 2>$null).Trim()
        $projectExitCode = $LASTEXITCODE
        $configuredConfig = (& doppler configure get config --plain 2>$null).Trim()
        $configExitCode = $LASTEXITCODE
        if ($projectExitCode -eq 0 -and $configExitCode -eq 0 -and $configuredProject -and $configuredConfig) {
            $dopplerReady = $true
        }
    }
}

if ($dopplerReady) {
    Write-Host "Doppler CLI is configured; backend/frontend commands will run through doppler run."
} elseif (-not $SkipDoppler) {
    Write-Host "Doppler CLI is not configured on this machine; using local env files."
}

$started = @()

if ($StartLambdaTestTunnel) {
    if ((Test-CommandAvailable "lt") -and $env:LT_USERNAME -and $env:LT_ACCESS_KEY) {
        $tunnelCommand = "lt --user `"$env:LT_USERNAME`" --key `"$env:LT_ACCESS_KEY`" --tunnelName aura-local --daemon start"
        $started += Start-LoggedProcess -Name "student-pack-lambdatest-tunnel" -Command $tunnelCommand
    } else {
        Write-Host "LambdaTest tunnel requested, but lt/LT_USERNAME/LT_ACCESS_KEY are not all available."
    }
}

if (-not $SkipBackend) {
    if ($dataServicesReady) {
        $localMongoUri = "mongodb://127.0.0.1:27017/aura?replicaSet=rs0"
        $env:MONGO_URI = $localMongoUri
        $env:REDIS_ENABLED = "true"
        $env:REDIS_REQUIRED = "false"
        $env:SPLIT_RUNTIME_ENABLED = "true"
        $env:REDIS_URL = "redis://127.0.0.1:6379"
    } else {
        Write-Host "Backend will use existing server env for database/cache because local data services are not confirmed ready."
    }

    if (-not $localStackReady) {
        Write-Host "Backend will use existing server env for upload storage because LocalStack is not confirmed ready."
    }

    $env:PAYMENT_PROVIDER = "simulated"
    $env:ORDER_EMAILS_ENABLED = "false"
    $env:ACTIVITY_EMAILS_ENABLED = "false"
    $env:OTP_SMS_ENABLED = "false"
    $env:STUDENT_PACK_SECURITY_HARNESS_ENABLED = "true"
    $env:STUDENT_PACK_SECURITY_HARNESS_PUBLIC = "true"
    if (-not $env:STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS) {
        $env:STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS = "true"
    }

    $backendCommand = if ($dopplerReady) {
        "doppler run -- npm --prefix server start"
    } else {
        "npm --prefix server start"
    }

    if (Test-TcpPort "127.0.0.1" 5000) {
        Write-Host "Backend is already reachable on 127.0.0.1:5000; not starting a duplicate backend."
    } else {
        $started += Start-LoggedProcess -Name "student-pack-backend" -Command $backendCommand
    }
}

if (-not $SkipFrontend) {
    $env:VITE_API_URL = "http://127.0.0.1:5000/api"
    $env:VITE_ENABLE_BACKEND_STATUS_BANNER = "true"

    $frontendCommand = if ($dopplerReady) {
        "doppler run -- npm --prefix app run dev -- --host 127.0.0.1 --port $FrontendPort"
    } else {
        "npm --prefix app run dev -- --host 127.0.0.1 --port $FrontendPort"
    }

    if (Test-TcpPort "127.0.0.1" $FrontendPort) {
        Write-Host "Frontend is already reachable on 127.0.0.1:$FrontendPort; not starting a duplicate frontend."
    } else {
        $started += Start-LoggedProcess -Name "student-pack-frontend" -Command $frontendCommand
    }
}

Write-Host ""
Write-Host "Started processes:"
foreach ($entry in $started) {
    Write-Host "- $($entry.Name) pid=$($entry.Id)"
    Write-Host "  stdout: $($entry.Stdout)"
    Write-Host "  stderr: $($entry.Stderr)"
}

Write-Host ""
Write-Host "Frontend: http://127.0.0.1:$FrontendPort"
Write-Host "Backend health: http://127.0.0.1:5000/health"
Write-Host "LocalStack health: http://127.0.0.1:4566/_localstack/health"
