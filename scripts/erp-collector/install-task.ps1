param(
  [string]$ConfigPath = "$PSScriptRoot\config.json"
)

$ErrorActionPreference = "Stop"
$collectorScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "collector.ps1"))
$resolvedConfig = [IO.Path]::GetFullPath($ConfigPath)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$collectorScript`" -ConfigPath `"$resolvedConfig`""
$trigger = New-ScheduledTaskTrigger -Daily -At "09:20"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName "Saidian-Jushuitan-Report-Import" -Action $action -Trigger $trigger -Settings $settings -Description "赛电聚水潭经营报表导入运营分析中台" -Force | Out-Null
Write-Host "已安装计划任务：Saidian-Jushuitan-Report-Import（每天09:20）"
