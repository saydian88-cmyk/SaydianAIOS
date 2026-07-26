param(
  [Parameter(Mandatory = $true)]
  [string]$RunnerToken,
  [string]$ApiUrl = "https://stest.saydian.cn",
  [string]$NodeCode = "windows-codex-01",
  [string]$TaskName = "Saydian AI Task Runner",
  [string]$CodexExecutable = "codex.cmd"
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$startScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "start-ai-task-runner.ps1")).Path
$configRoot = Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner"
$configPath = Join-Path $configRoot "runner.env"
$workPath = Join-Path $configRoot "work"

New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
New-Item -ItemType Directory -Path $workPath -Force | Out-Null

$lines = @(
  "AI_TASK_API_URL=$($ApiUrl.TrimEnd('/'))"
  "AI_TASK_RUNNER_TOKEN=$RunnerToken"
  "AI_TASK_RUNNER_NODE_CODE=$NodeCode"
  "AI_TASK_RUNNER_VERSION=1.0.0"
  "AI_TASK_WORKDIR=$workPath"
  "AI_TASK_REPO_PATH=$repoPath"
  "CODEX_EXECUTABLE=$CodexExecutable"
)
Set-Content -LiteralPath $configPath -Value $lines -Encoding UTF8

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -ConfigPath `"$configPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 365)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "赛电总管理后台 AI 任务中心 Codex 执行器" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Output "AI任务执行器已安装并启动：$TaskName"
Write-Output "配置文件：$configPath"
