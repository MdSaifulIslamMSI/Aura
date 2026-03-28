param(
    [Parameter(Mandatory = $true)]
    [string]$BackendUrl
)

$ErrorActionPreference = "Stop"

function Get-ServiceOrigin {
    param([string]$Url)

    $trimmed = ""
    if (-not [string]::IsNullOrWhiteSpace($Url)) {
        $trimmed = $Url.Trim()
    }
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        throw "BackendUrl is required."
    }

    if ($trimmed -notmatch "^[a-z]+://") {
        $trimmed = "https://$trimmed"
    }

    $uri = [Uri]$trimmed
    $path = $uri.AbsolutePath.TrimEnd("/")
    if ($path -match "/api$") {
        $path = $path.Substring(0, $path.Length - 4)
    }

    $builder = New-Object System.UriBuilder($uri.Scheme, $uri.Host, $uri.Port)
    $builder.Path = if ([string]::IsNullOrWhiteSpace($path)) { "/" } else { $path }

    return $builder.Uri.GetLeftPart([System.UriPartial]::Path).TrimEnd("/")
}

$serviceOrigin = Get-ServiceOrigin -Url $BackendUrl
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$targets = @(
    (Join-Path $repoRoot "vercel.json"),
    (Join-Path $repoRoot "app\vercel.json")
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$desiredDestinations = [ordered]@{
    "/api/(.*)" = "$serviceOrigin/api/`$1"
    "/health" = "$serviceOrigin/health"
    "/health/ready" = "$serviceOrigin/health/ready"
    "/uploads/(.*)" = "$serviceOrigin/uploads/`$1"
}

foreach ($target in $targets) {
    if (-not (Test-Path $target)) {
        throw "Routing file not found: $target"
    }

    $content = Get-Content -Raw -Path $target
    $json = $content | ConvertFrom-Json
    $changed = $false

    foreach ($entry in $desiredDestinations.GetEnumerator()) {
        $matchedRewrite = $json.rewrites | Where-Object { $_.source -eq $entry.Key } | Select-Object -First 1
        if ($null -eq $matchedRewrite) {
            throw "Could not find rewrite entry for source '$($entry.Key)'."
        }
        if ($matchedRewrite.destination -ne $entry.Value) {
            $matchedRewrite.destination = $entry.Value
            $changed = $true
        }
    }

    if ($changed) {
        $updated = $json | ConvertTo-Json -Depth 20
        [System.IO.File]::WriteAllText($target, $updated, $utf8NoBom)
        Write-Host "Updated frontend routing in $target" -ForegroundColor Green
    } else {
        Write-Host "Frontend routing already points at $serviceOrigin in $target" -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host "Synced Vercel rewrites to $serviceOrigin" -ForegroundColor Green
