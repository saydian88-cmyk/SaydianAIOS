$ErrorActionPreference = "Stop"
$envFile = Join-Path $env:LOCALAPPDATA "SaydianAiTaskRunner\runner.env"
Get-Content -Encoding UTF8 $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim().Trim('"'), 'Process')
  }
}
$endpoint = $env:AI_TASK_API_URL.TrimEnd('/') + '/api/v1/ai-tasks/runner/material-mirror-index?nodeCode=' + $env:AI_TASK_RUNNER_NODE_CODE
while ($true) {
  try {
    $page = Invoke-RestMethod -Uri $endpoint -Headers @{ Authorization = ('Runner ' + $env:AI_TASK_RUNNER_TOKEN) } -TimeoutSec 30
    if ($page.changes.Count -gt 0 -and $page.changes[0].PSObject.Properties.Name -contains 'sourcePath') { break }
  } catch { }
  Start-Sleep -Seconds 60
}
& (Join-Path $PSScriptRoot 'sync-system-material-library.ps1')
