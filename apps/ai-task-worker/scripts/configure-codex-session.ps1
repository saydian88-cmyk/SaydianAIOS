param(
  [string]$RunnerToken = "",
  [string]$TokenFile = "",
  [string]$ApiUrl = "https://stest.saydian.cn",
  [string]$NodeCode = "windows-codex-01",
  [string]$VideoSkillName = "video-editing-from-media-library",
  [string]$VideoSkillPath = ""
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$configRoot = Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner"
$workPath = Join-Path $configRoot "work"
$configPath = Join-Path $configRoot "runner.env"
$toolRoot = Join-Path $configRoot "tools"
$codex = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin") -Recurse -Filter codex.exe -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$ffmpeg = Get-ChildItem -LiteralPath (Join-Path $toolRoot "node_modules") -Recurse -Filter ffmpeg.exe -File |
  Select-Object -First 1
$ffprobe = Get-ChildItem -LiteralPath (Join-Path $toolRoot "node_modules") -Recurse -Filter ffprobe.exe -File |
  Select-Object -First 1
$pnpm = Get-Command pnpm.cmd -ErrorAction Stop
$codexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "Process")
$resolvedVideoSkillPath = if ($VideoSkillPath) {
  (Resolve-Path -LiteralPath $VideoSkillPath).Path
} else {
  Join-Path $codexHome "skills\$VideoSkillName\SKILL.md"
}

if (-not $RunnerToken.Trim() -and $TokenFile) {
  $resolvedTokenFile = (Resolve-Path -LiteralPath $TokenFile).Path
  $allowedTokenRoot = (Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner") + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedTokenFile.StartsWith($allowedTokenRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Runner token temporary path is outside the allowed directory"
  }
  try {
    $RunnerToken = (Get-Content -LiteralPath $resolvedTokenFile -Raw -Encoding UTF8).Trim()
  } finally {
    Remove-Item -LiteralPath $resolvedTokenFile -Force -ErrorAction SilentlyContinue
  }
}
if (-not $RunnerToken.Trim()) { throw "RunnerToken is empty" }
if (-not $codex) { throw "Codex executable was not found" }
if (-not $ffmpeg) { throw "FFmpeg executable was not found" }
if (-not $ffprobe) { throw "FFprobe executable was not found" }
if (-not $codexHome) { throw "CODEX_HOME is not configured" }

$requiredSkills = @(
  (Join-Path $codexHome "skills\saidian-ai-task-dispatcher\SKILL.md"),
  $resolvedVideoSkillPath,
  (Join-Path $codexHome "skills\video-script-generation\SKILL.md"),
  (Join-Path $codexHome "skills\feng-mian-biao-ti\SKILL.md")
)
foreach ($skillPath in $requiredSkills) {
  if (-not (Test-Path -LiteralPath $skillPath -PathType Leaf)) {
    throw "Required Skill is missing: $skillPath"
  }
}

New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
New-Item -ItemType Directory -Path $workPath -Force | Out-Null
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
  "PNPM_EXECUTABLE=$($pnpm.Source)"
  "CODEX_EXECUTABLE=$($codex.FullName)"
  "FFMPEG_EXECUTABLE=$($ffmpeg.FullName)"
  "FFPROBE_EXECUTABLE=$($ffprobe.FullName)"
  "AI_TASK_VIDEO_SKILL_NAME=$VideoSkillName"
  "AI_TASK_VIDEO_SKILL_PATH=$resolvedVideoSkillPath"
)
Set-Content -LiteralPath $configPath -Value $lines -Encoding UTF8
Write-Output "Codex session runner configured: $configPath"
