$ErrorActionPreference = "Stop"
$taskName = "Saydian Douyin Trend Collector"
$startScript = Resolve-Path (Join-Path $PSScriptRoot "start-agent.ps1")
$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""

schtasks.exe /Create /F /TN $taskName /SC ONLOGON /RL LIMITED /TR $action | Out-Null
schtasks.exe /Run /TN $taskName | Out-Null

Write-Output "Installed and started: $taskName"
Write-Output "Chrome profile will open for the first Douyin QR login."
