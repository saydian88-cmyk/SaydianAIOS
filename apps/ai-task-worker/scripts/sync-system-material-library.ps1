param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner\runner.env")
)

$ErrorActionPreference = "Stop"
Get-Content -LiteralPath $ConfigPath -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $parts = $line -split "=", 2
  if ($parts.Count -eq 2) { [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], "Process") }
}
$env:AI_TASK_LOCAL_MEDIA_LIBRARY = "F:\赛电品牌素材库"
$repoPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
Set-Location -LiteralPath $repoPath
& $env:PNPM_EXECUTABLE --filter '@saidian-ops/ai-task-worker' sync:system-materials
exit $LASTEXITCODE
