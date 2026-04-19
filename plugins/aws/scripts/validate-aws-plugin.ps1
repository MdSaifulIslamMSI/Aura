[CmdletBinding()]
param(
    [switch]$Json
)

$pluginRoot = Split-Path -Parent $PSScriptRoot

$requiredRelativePaths = @(
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "README.md",
    "CHANGELOG.md",
    "agents/openai.yaml",
    "assets/aws-logo.svg",
    "assets/aws-small.svg",
    "assets/aws-skill-map.svg",
    "examples/README.md",
    "examples/prompt-library.md",
    "scripts/bootstrap-aws-mcp.ps1",
    "scripts/doctor-aws-plugin.ps1",
    "scripts/validate-aws-plugin.ps1",
    "commands/setup-mcp.md",
    "commands/doctor.md",
    "commands/deploy-check.md",
    "commands/ssm-sync.md",
    "commands/solution-map.md",
    "commands/architecture-review.md",
    "commands/security-review.md",
    "commands/validate-plugin.md"
)

$missingPaths = foreach ($relativePath in $requiredRelativePaths) {
    $fullPath = Join-Path $pluginRoot $relativePath
    if (-not (Test-Path -LiteralPath $fullPath)) {
        $relativePath
    }
}

$skillRoot = Join-Path $pluginRoot "skills"
$commandRoot = Join-Path $pluginRoot "commands"
$exampleRoot = Join-Path $pluginRoot "examples"

$skillDirectories = @(Get-ChildItem -LiteralPath $skillRoot -Directory -ErrorAction SilentlyContinue)
$validSkillDirectories = @(
    $skillDirectories | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md")
    }
)

$commandFiles = @(Get-ChildItem -LiteralPath $commandRoot -File -Filter "*.md" -ErrorAction SilentlyContinue)
$exampleFiles = @(Get-ChildItem -LiteralPath $exampleRoot -File -Filter "*.md" -ErrorAction SilentlyContinue)

$recommendedCoverage = [pscustomobject]@{
    minimumSkillCount = 24
    minimumCommandCount = 6
    minimumExampleCount = 6
}

$coverageMet = (
    $validSkillDirectories.Count -ge $recommendedCoverage.minimumSkillCount -and
    $commandFiles.Count -ge $recommendedCoverage.minimumCommandCount -and
    $exampleFiles.Count -ge $recommendedCoverage.minimumExampleCount
)

$summary = [pscustomobject]@{
    pluginRoot = $pluginRoot
    ready = ($missingPaths.Count -eq 0)
    releaseReady = ($missingPaths.Count -eq 0 -and $coverageMet)
    skillCount = $validSkillDirectories.Count
    commandCount = $commandFiles.Count
    exampleCount = $exampleFiles.Count
    missingPaths = @($missingPaths)
    recommendedCoverage = $recommendedCoverage
    sampleSkills = @(
        $validSkillDirectories |
            Select-Object -ExpandProperty Name |
            Sort-Object |
            Select-Object -First 12
    )
}

if ($Json) {
    $summary | ConvertTo-Json -Depth 5
    return
}

Write-Host "AWS plugin validation"
Write-Host ("Plugin root    : {0}" -f $summary.pluginRoot)
Write-Host ("Ready          : {0}" -f $summary.ready)
Write-Host ("Release ready  : {0}" -f $summary.releaseReady)
Write-Host ("Skill count    : {0}" -f $summary.skillCount)
Write-Host ("Command count  : {0}" -f $summary.commandCount)
Write-Host ("Example count  : {0}" -f $summary.exampleCount)

if ($summary.missingPaths.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing paths:"
    $summary.missingPaths | ForEach-Object {
        Write-Host ("- {0}" -f $_)
    }
}

if (-not $coverageMet) {
    Write-Host ""
    Write-Host "Recommended minimum coverage not met:"
    Write-Host ("- skills  : {0}" -f $recommendedCoverage.minimumSkillCount)
    Write-Host ("- commands: {0}" -f $recommendedCoverage.minimumCommandCount)
    Write-Host ("- examples: {0}" -f $recommendedCoverage.minimumExampleCount)
}
