param(
  [string]$ConfigPath = "$PSScriptRoot\config.json"
)

$ErrorActionPreference = "Stop"
$collectorConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$chromePath = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { throw "未找到 Google Chrome" }

New-Item -ItemType Directory -Force -Path ([string]$collectorConfig.ChromeProfileFolder) | Out-Null
Start-Process -FilePath $chromePath -ArgumentList @(
  "--user-data-dir=$($collectorConfig.ChromeProfileFolder)",
  "--profile-directory=Default",
  [string]$collectorConfig.JushuitanUrl
)
