param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = "Stop"
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$configRoot = Split-Path -Parent $resolvedConfig

Get-Content -LiteralPath $resolvedConfig | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $parts = $line -split "=", 2
  if ($parts.Count -eq 2) {
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], "Process")
  }
}

$repoPath = $env:AI_TASK_REPO_PATH
if (-not $repoPath) { throw "AI_TASK_REPO_PATH 未配置" }
$resolvedRepo = (Resolve-Path -LiteralPath $repoPath).Path
$runnerLog = Join-Path $configRoot "runner.log"
$runnerErrorLog = Join-Path $configRoot "runner-error.log"

Set-Location -LiteralPath $resolvedRepo
& pnpm.cmd dev:ai-task-runner 1>> $runnerLog 2>> $runnerErrorLog

