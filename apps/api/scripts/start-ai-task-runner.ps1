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
$pnpmExecutable = $env:PNPM_EXECUTABLE
if (-not $pnpmExecutable -or -not (Test-Path -LiteralPath $pnpmExecutable)) {
  throw "PNPM_EXECUTABLE is not configured"
}
$runtimePathParts = @(
  (Split-Path -Parent $pnpmExecutable)
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
& $pnpmExecutable dev:ai-task-runner 1>> $runnerLog 2>> $runnerErrorLog
exit $LASTEXITCODE
