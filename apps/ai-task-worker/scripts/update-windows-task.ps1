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

# Codex Desktop rotates its versioned executable directory during app updates.
# Fall back to the current registered command instead of leaving the runner
# permanently offline with a stale absolute path.
$codexExecutable = [string]$values["CODEX_EXECUTABLE"]
if (-not $codexExecutable -or -not (Test-Path -LiteralPath $codexExecutable -PathType Leaf) -or $codexExecutable -match "\\WindowsApps\\") {
  $desktopCodex = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin") -Recurse -Filter "codex.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -ExpandProperty FullName -First 1
  $codexExecutable = if ($desktopCodex) { $desktopCodex } else { "codex.exe" }
}

& $installer `
  -RunnerToken $values["AI_TASK_RUNNER_TOKEN"] `
  -ApiUrl $values["AI_TASK_API_URL"] `
  -NodeCode $values["AI_TASK_RUNNER_NODE_CODE"] `
  -TaskName $TaskName `
  -NodeExecutable $(if ($values["NODE_EXECUTABLE"]) { $values["NODE_EXECUTABLE"] } else { "node.exe" }) `
  -CodexExecutable $codexExecutable `
  -PythonExecutable $values["AI_TASK_PYTHON_EXECUTABLE"] `
  -FfmpegExecutable $values["FFMPEG_EXECUTABLE"] `
  -FfprobeExecutable $values["FFPROBE_EXECUTABLE"]

Write-Output "AI task runner upgraded; existing Runner Token retained; version=3.0.0"
