param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = "Stop"
$bootstrapErrorLog = Join-Path (Split-Path -Parent $ConfigPath) "runner-bootstrap-error.log"
trap {
  Add-Content -LiteralPath $bootstrapErrorLog -Value "$(Get-Date -Format o) $($_ | Out-String)"
  exit 1
}
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$configRoot = Split-Path -Parent $resolvedConfig

Get-Content -LiteralPath $resolvedConfig -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $parts = $line -split "=", 2
  if ($parts.Count -eq 2) {
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], "Process")
  }
}

$repoPath = $env:AI_TASK_REPO_PATH
if (-not $repoPath) { throw "AI_TASK_REPO_PATH is not configured" }
$resolvedRepo = (Resolve-Path -LiteralPath $repoPath).Path
$tsxExecutable = Join-Path $resolvedRepo "apps\ai-task-worker\node_modules\.bin\tsx.cmd"
if (-not (Test-Path -LiteralPath $tsxExecutable -PathType Leaf)) {
  throw "The installed AI task runner runtime is missing: $tsxExecutable"
}
$runtimePathParts = @(
  (Split-Path -Parent $env:NODE_EXECUTABLE)
  (Split-Path -Parent $env:CODEX_EXECUTABLE)
  (Split-Path -Parent $env:AI_TASK_PYTHON_EXECUTABLE)
  (Split-Path -Parent $env:FFMPEG_EXECUTABLE)
  (Split-Path -Parent $env:FFPROBE_EXECUTABLE)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
$env:PATH = (($runtimePathParts + @($env:PATH)) -join ";")
$env:PYTHON_EXECUTABLE = $env:AI_TASK_PYTHON_EXECUTABLE
$runnerLog = Join-Path $configRoot "runner.log"
$runnerErrorLog = Join-Path $configRoot "runner-error.log"

Set-Location -LiteralPath $resolvedRepo
$ErrorActionPreference = "Continue"
while ($true) {
  & $tsxExecutable (Join-Path $resolvedRepo "apps\ai-task-worker\src\index.ts") 1>> $runnerLog 2>> $runnerErrorLog
  $workerExitCode = $LASTEXITCODE
  Add-Content -LiteralPath $runnerErrorLog -Value "$(Get-Date -Format o) worker exited with code $workerExitCode; restarting in 15 seconds"
  Start-Sleep -Seconds 15
}
