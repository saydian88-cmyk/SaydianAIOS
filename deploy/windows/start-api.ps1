$ErrorActionPreference = 'Stop'
$root = 'C:\saidian-ops'
$node = 'C:\saydian\runtime\node\node.exe'
$envPath = Join-Path $root '.env'
$logPath = Join-Path $root 'logs\api.log'

[IO.File]::ReadAllLines($envPath, [Text.UTF8Encoding]::new($false)) | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}

Set-Location (Join-Path $root 'api')
& $node (Join-Path $root 'api\dist\main.js') *>> $logPath
