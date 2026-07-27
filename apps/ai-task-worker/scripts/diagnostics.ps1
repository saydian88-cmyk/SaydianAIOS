$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$configPath = Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner\runner.env"
$checks = @(
  @{ Name = "Node"; Command = "node" },
  @{ Name = "pnpm"; Command = "pnpm.cmd" },
  @{ Name = "Codex"; Command = "codex.cmd" },
  @{ Name = "FFmpeg"; Command = "ffmpeg.exe" }
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
