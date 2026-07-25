$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$runtimeDir = Join-Path $env:LOCALAPPDATA "Saydian\DouyinCollector"
$bootstrapLog = Join-Path $runtimeDir "bootstrap.log"
$corepack = "D:\Program Files\nodejs\corepack.cmd"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Set-Location $repoRoot
try {
  if (-not (Test-Path -LiteralPath $corepack)) {
    $node = Get-Command node.exe -ErrorAction Stop
    $corepack = Join-Path (Split-Path $node.Source) "corepack.cmd"
  }
  if (-not (Test-Path -LiteralPath $corepack)) {
    throw "未找到corepack.cmd"
  }
  & $corepack pnpm --filter @saidian-ops/douyin-local-collector start *>> $bootstrapLog
} catch {
  "$(Get-Date -Format o) $($_.Exception.Message)" | Add-Content -LiteralPath $bootstrapLog
  throw
}
