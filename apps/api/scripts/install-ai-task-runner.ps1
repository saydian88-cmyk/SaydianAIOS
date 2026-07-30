param(
  [string]$RunnerToken = "",
  [string]$ApiUrl = "https://stest.saydian.cn",
  [string]$NodeCode = "windows-codex-01",
  [string]$TaskName = "Saydian AI Task Runner",
  [string]$CodexExecutable = "codex.cmd",
  [switch]$ValidateOnly
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
$resolvedFfprobe = (Get-Command ffprobe.exe -ErrorAction Stop).Source
$codexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "Process")
if (-not $codexHome) { $codexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "User") }
if (-not $codexHome) { throw "CODEX_HOME is not configured" }
$requiredSkills = @(
  (Join-Path $codexHome "skills\.system\imagegen\SKILL.md"),
  (Join-Path $codexHome "skills\build-health-brand-trust-content\SKILL.md"),
  (Join-Path $codexHome "skills\saidian-ai-task-dispatcher\SKILL.md")
  (Join-Path $codexHome "skills\video-editing-from-media-library\SKILL.md")
)
foreach ($skillPath in $requiredSkills) {
  if (-not (Test-Path -LiteralPath $skillPath -PathType Leaf)) {
    throw "Required Skill is missing: $skillPath"
  }
}

if ($ValidateOnly) {
  Write-Output "Validation passed: NodeCode=$NodeCode, poll=10s, heartbeat=30s"
  Write-Output "CODEX_HOME=$codexHome"
  exit 0
}
if (-not $RunnerToken) { throw "RunnerToken is not configured" }

New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
New-Item -ItemType Directory -Path $workPath -Force | Out-Null
Copy-Item -LiteralPath $startScript -Destination $installedStartScript -Force

$lines = @(
  "AI_TASK_API_URL=$($ApiUrl.TrimEnd('/'))"
  "AI_TASK_RUNNER_TOKEN=$RunnerToken"
  "AI_TASK_RUNNER_NODE_CODE=$NodeCode"
  "AI_TASK_RUNNER_VERSION=3.0.0"
  "AI_TASK_WORKDIR=$workPath"
  "AI_TASK_POLL_MS=60000"
  "AI_TASK_HEARTBEAT_MS=30000"
  "AI_TASK_REPO_PATH=$repoPath"
  "CODEX_HOME=$codexHome"
  "PNPM_EXECUTABLE=$resolvedPnpm"
  "CODEX_EXECUTABLE=$resolvedCodex"
  "FFMPEG_EXECUTABLE=$resolvedFfmpeg"
  "FFPROBE_EXECUTABLE=$resolvedFfprobe"
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

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName
  for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    $state = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
    if ($state -ne "Running") { break }
  }
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Saydian AI Task Center Codex Runner" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Output "AI task runner installed and started: $TaskName"
Write-Output "Config: $configPath"
