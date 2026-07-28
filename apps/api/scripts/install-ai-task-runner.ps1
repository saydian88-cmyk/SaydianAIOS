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
$installedStartScript = Join-Path $configRoot "start-ai-task-runner.ps1"
$resolvedPnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$resolvedCodex = (Get-Command $CodexExecutable -ErrorAction Stop).Source
$resolvedFfmpeg = (Get-Command ffmpeg.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
New-Item -ItemType Directory -Path $workPath -Force | Out-Null
Copy-Item -LiteralPath $startScript -Destination $installedStartScript -Force

$lines = @(
  "AI_TASK_API_URL=$($ApiUrl.TrimEnd('/'))"
  "AI_TASK_RUNNER_TOKEN=$RunnerToken"
  "AI_TASK_RUNNER_NODE_CODE=$NodeCode"
  "AI_TASK_RUNNER_VERSION=2.0.0"
  "AI_TASK_WORKDIR=$workPath"
  "AI_TASK_REPO_PATH=$repoPath"
  "PNPM_EXECUTABLE=$resolvedPnpm"
  "CODEX_EXECUTABLE=$resolvedCodex"
  "FFMPEG_EXECUTABLE=$resolvedFfmpeg"
)
Set-Content -LiteralPath $configPath -Value $lines -Encoding UTF8

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction `
  -Execute $powerShellPath `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$installedStartScript`" -ConfigPath `"$configPath`""
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
