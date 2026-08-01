param(
  [Parameter(Mandatory = $true)][string]$ReportPath,
  [Parameter(Mandatory = $true)][string]$MapPath,
  [string]$StatusPath = "$env:LOCALAPPDATA\SaydianAiTaskRunner\shutdown-after-sync.json"
)

$ErrorActionPreference = "Stop"
while ($true) {
  $syncRunning = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'sync-system-material-library\.ts' }
  if (-not $syncRunning -and (Test-Path -LiteralPath $ReportPath) -and (Test-Path -LiteralPath $MapPath)) { break }
  Start-Sleep -Seconds 30
}

$report = Get-Content -LiteralPath $ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
$mapping = Get-Content -LiteralPath $MapPath -Raw -Encoding UTF8 | ConvertFrom-Json
$mappingCount = @($mapping.PSObject.Properties).Count
$success = [int]$report.failed -eq 0 -and $mappingCount -gt 0
$status = [ordered]@{
  checkedAt = (Get-Date).ToString("o")
  success = $success
  mappedAssets = $mappingCount
  failedAssets = [int]$report.failed
  reportPath = $ReportPath
}
$status | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
if (-not $success) { exit 1 }

$idleChecks = 0
while ($idleChecks -lt 2) {
  $activeCodex = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'codex.exe' -and $_.CommandLine -match 'SaydianAiTaskRunner\\work' }
  if ($activeCodex) { $idleChecks = 0 } else { $idleChecks += 1 }
  Start-Sleep -Seconds 30
}

shutdown.exe /s /t 60 /c "SaiDian material sync and indexing completed."
