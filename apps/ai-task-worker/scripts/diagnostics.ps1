$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$configPath = Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner\runner.env"
$taskName = "Saydian AI Task Runner"
$checks = @(
  @{ Name = "Node"; Command = "node" },
  @{ Name = "pnpm"; Command = "pnpm.cmd" },
  @{ Name = "Codex"; Command = "codex.cmd" },
  @{ Name = "FFmpeg"; Command = "ffmpeg.exe" }
  @{ Name = "FFprobe"; Command = "ffprobe.exe" }
)

foreach ($check in $checks) {
  $command = Get-Command $check.Command -ErrorAction SilentlyContinue
  [pscustomobject]@{
    Check = $check.Name
    Status = if ($command) { "OK" } else { "MISSING" }
    Path = if ($command) { $command.Source } else { "" }
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
$skills = @(
  @{ Name = "Skill:imagegen"; Path = Join-Path $codexBase "skills\.system\imagegen\SKILL.md" },
  @{ Name = "Skill:article"; Path = Join-Path $codexBase "skills\build-health-brand-trust-content\SKILL.md" },
  @{ Name = "Skill:video"; Path = Join-Path $codexBase "plugins\cache\personal\video-editing-from-media-library-share\0.1.0\skills\video-editing-from-media-library-share\SKILL.md" }
)
foreach ($skill in $skills) {
  [pscustomobject]@{
    Check = $skill.Name
    Status = if ($codexHome -and (Test-Path -LiteralPath $skill.Path -PathType Leaf)) { "OK" } else { "MISSING" }
    Path = $skill.Path
  }
}

$videoConfigPath = Join-Path $env:LOCALAPPDATA "Codex\video-editing-from-media-library-share\active-config.json"
$videoReady = $false
if (Test-Path -LiteralPath $videoConfigPath -PathType Leaf) {
  try {
    $active = Get-Content -Raw -LiteralPath $videoConfigPath -Encoding UTF8 | ConvertFrom-Json
    $runtime = Get-Content -Raw -LiteralPath $active.config_path -Encoding UTF8 | ConvertFrom-Json
    $videoReady = $runtime.initialization_status -eq "ready"
  } catch {
    $videoReady = $false
  }
}
[pscustomobject]@{
  Check = "VideoSkillRuntime"
  Status = if ($videoReady) { "OK" } else { "UNCONFIGURED" }
  Path = $videoConfigPath
}

$scheduled = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
[pscustomobject]@{
  Check = "ScheduledTask"
  Status = if ($scheduled) { [string]$scheduled.State } else { "MISSING" }
  Path = $taskName
}

if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  $safeConfig = @{}
  Get-Content -LiteralPath $configPath -Encoding UTF8 | ForEach-Object {
    $parts = $_ -split "=", 2
    if ($parts.Count -eq 2 -and $parts[0] -ne "AI_TASK_RUNNER_TOKEN") { $safeConfig[$parts[0]] = $parts[1] }
  }
  [pscustomobject]@{
    Check = "PollInterval"
    Status = if ($safeConfig["AI_TASK_POLL_MS"] -eq "10000") { "OK" } else { "INVALID" }
    Path = [string]$safeConfig["AI_TASK_POLL_MS"]
  }
  [pscustomobject]@{
    Check = "HeartbeatInterval"
    Status = if ($safeConfig["AI_TASK_HEARTBEAT_MS"] -eq "30000") { "OK" } else { "INVALID" }
    Path = [string]$safeConfig["AI_TASK_HEARTBEAT_MS"]
  }
}
