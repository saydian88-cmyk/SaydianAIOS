param(
  [string]$ApiUrl = "https://stest.saydian.cn",
  [string]$NodeCode = "WINDOWS-CODEX-01",
  [string]$RunnerToken = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$installer = Join-Path $repoRoot "apps\api\scripts\install-ai-task-runner.ps1"

if (-not (Test-Path -LiteralPath $installer)) {
  throw "兼容安装器不存在：$installer"
}

& $installer -ApiUrl $ApiUrl -NodeCode $NodeCode -RunnerToken $RunnerToken
