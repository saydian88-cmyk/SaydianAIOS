param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner\runner.env")
)

$ErrorActionPreference = "Stop"
$resolvedScript = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\api\scripts\start-ai-task-runner.ps1")

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "AI task runner config does not exist: $ConfigPath"
}

Write-Host "SaiDian AI task dispatcher started. Poll interval: 60 seconds."
Write-Host "The dispatcher stops when this Codex session process stops."
& powershell -NoProfile -ExecutionPolicy Bypass -File $resolvedScript.Path -ConfigPath $ConfigPath
exit $LASTEXITCODE
