param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner\runner.env")
)

$ErrorActionPreference = "Stop"
$env:CI = "true"
Get-Content -LiteralPath $ConfigPath -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $parts = $line -split "=", 2
  if ($parts.Count -eq 2) { [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], "Process") }
}
$repoPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
Set-Location -LiteralPath $repoPath
$pnpmExecutable = $env:PNPM_EXECUTABLE
if ([string]::IsNullOrWhiteSpace($pnpmExecutable) -or -not (Test-Path -LiteralPath $pnpmExecutable)) {
  $pnpmCommand = Get-Command pnpm -ErrorAction Stop
  $pnpmExecutable = $pnpmCommand.Source
}
& $pnpmExecutable --filter '@saidian-ops/ai-task-worker' sync:system-materials
exit $LASTEXITCODE
