$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$configPath = Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner\runner.env"
$safeConfig = @{}
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  Get-Content -LiteralPath $configPath -Encoding UTF8 | ForEach-Object {
    $parts = $_ -split "=", 2
    if ($parts.Count -eq 2 -and $parts[0] -ne "AI_TASK_RUNNER_TOKEN") { $safeConfig[$parts[0]] = $parts[1] }
  }
}
$checks = @(
  @{ Name = "Node"; Command = "node"; Config = "" },
  @{ Name = "pnpm"; Command = "pnpm.cmd"; Config = "PNPM_EXECUTABLE" },
  @{ Name = "Codex"; Command = "codex.cmd"; Config = "CODEX_EXECUTABLE" },
  @{ Name = "FFmpeg"; Command = "ffmpeg.exe"; Config = "FFMPEG_EXECUTABLE" },
  @{ Name = "FFprobe"; Command = "ffprobe.exe"; Config = "FFPROBE_EXECUTABLE" }
  @{ Name = "Python"; Command = "python.exe"; Config = "AI_TASK_PYTHON_EXECUTABLE" }
)

foreach ($check in $checks) {
  $command = Get-Command $check.Command -ErrorAction SilentlyContinue
  $configuredPath = if ($check.Config) { [string]$safeConfig[$check.Config] } else { "" }
  $resolvedPath = if ($configuredPath -and (Test-Path -LiteralPath $configuredPath -PathType Leaf)) {
    $configuredPath
  } elseif ($command) {
    $command.Source
  } else {
    ""
  }
  [pscustomobject]@{
    Check = $check.Name
    Status = if ($resolvedPath) { "OK" } else { "MISSING" }
    Path = $resolvedPath
  }
}

[pscustomobject]@{
  Check = "RunnerConfig"
  Status = if (Test-Path -LiteralPath $configPath) { "OK" } else { "MISSING" }
  Path = $configPath
}

[pscustomobject]@{
  Check = "WorkerProject"
  Status = if (Test-Path -LiteralPath (Join-Path $repoRoot "apps\ai-task-worker\src\index.ts")) { "OK" } else { "MISSING" }
  Path = Join-Path $repoRoot "apps\ai-task-worker"
}

$codexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "Process")
if (-not $codexHome) { $codexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "User") }
$codexBase = if ($codexHome) { $codexHome } else { "CODEX_HOME_UNCONFIGURED" }
$configuredVideoSkillPath = [string]$safeConfig["AI_TASK_VIDEO_SKILL_PATH"]
if (-not $configuredVideoSkillPath) {
  $configuredVideoSkillPath = Join-Path $codexBase "skills\video-editing-from-media-library\SKILL.md"
}
$skills = @(
  @{ Name = "Skill:dispatcher"; Path = Join-Path $codexBase "skills\saidian-ai-task-dispatcher\SKILL.md" },
  @{ Name = "Skill:video"; Path = $configuredVideoSkillPath },
  @{ Name = "Skill:script"; Path = Join-Path $codexBase "skills\video-script-generation\SKILL.md" },
  @{ Name = "Skill:cover"; Path = Join-Path $codexBase "skills\feng-mian-biao-ti\SKILL.md" }
)
foreach ($skill in $skills) {
  [pscustomobject]@{
    Check = $skill.Name
    Status = if ($codexHome -and (Test-Path -LiteralPath $skill.Path -PathType Leaf)) { "OK" } else { "MISSING" }
    Path = $skill.Path
  }
}

$videoConfigPath = $configuredVideoSkillPath
$videoReady = $false
if (Test-Path -LiteralPath $videoConfigPath -PathType Leaf) { $videoReady = $true }
[pscustomobject]@{
  Check = "VideoSkillRuntime"
  Status = if ($videoReady) { "OK" } else { "UNCONFIGURED" }
  Path = $videoConfigPath
}

$sessionRunner = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*ai-task-worker*src*index.ts*"
} | Select-Object -First 1
[pscustomobject]@{
  Check = "SessionRunner"
  Status = if ($sessionRunner) { "RUNNING" } else { "STOPPED" }
  Path = if ($sessionRunner) { [string]$sessionRunner.ProcessId } else { "" }
}

if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  [pscustomobject]@{
    Check = "PollInterval"
    Status = if ($safeConfig["AI_TASK_POLL_MS"] -eq "60000") { "OK" } else { "INVALID" }
    Path = [string]$safeConfig["AI_TASK_POLL_MS"]
  }
  [pscustomobject]@{
    Check = "HeartbeatInterval"
    Status = if ($safeConfig["AI_TASK_HEARTBEAT_MS"] -eq "30000") { "OK" } else { "INVALID" }
    Path = [string]$safeConfig["AI_TASK_HEARTBEAT_MS"]
  }
}
