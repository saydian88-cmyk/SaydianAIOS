param(
  [string]$TaskName = "Saydian AI Task Runner",
  [switch]$SkipDependencies,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$configPath = Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner\runner.env"
$installer = Join-Path $repoRoot "apps\api\scripts\install-ai-task-runner.ps1"

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "Runner is not installed: $configPath"
}

$values = @{}
Get-Content -LiteralPath $configPath -Encoding UTF8 | ForEach-Object {
  $parts = $_ -split "=", 2
  if ($parts.Count -eq 2) { $values[$parts[0].Trim()] = $parts[1] }
}
foreach ($required in @("AI_TASK_RUNNER_TOKEN", "AI_TASK_API_URL", "AI_TASK_RUNNER_NODE_CODE")) {
  if (-not $values[$required]) { throw "Existing config is missing $required" }
}

$activeWorkRoot = [string]$values["AI_TASK_WORKDIR"]
$activeCodex = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $activeWorkRoot -and $_.CommandLine.Contains($activeWorkRoot) -and $_.CommandLine.Contains("codex")
}
if ($activeCodex -and -not $Force) {
  throw "Runner is executing an AI task. Retry the upgrade after the current task finishes, or use -Force."
}

if (-not $SkipDependencies) {
  $pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
  & $pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "Dependency update failed" }
  & $pnpm --filter @saidian-ops/ai-task-worker build
  if ($LASTEXITCODE -ne 0) { throw "Runner build failed" }
}

& $installer `
  -RunnerToken $values["AI_TASK_RUNNER_TOKEN"] `
  -ApiUrl $values["AI_TASK_API_URL"] `
  -NodeCode $values["AI_TASK_RUNNER_NODE_CODE"] `
  -TaskName $TaskName

Write-Output "AI task runner upgraded; existing Runner Token retained; version=3.0.0"
