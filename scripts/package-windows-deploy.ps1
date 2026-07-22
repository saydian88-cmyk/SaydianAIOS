$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path $repoRoot 'artifacts'
$packageRoot = Join-Path $artifactRoot 'windows-package-prod'
$archivePath = Join-Path $artifactRoot 'saidian-ops-windows.zip'

$resolvedRepo = [IO.Path]::GetFullPath($repoRoot)
$resolvedPackage = [IO.Path]::GetFullPath($packageRoot)
if (-not $resolvedPackage.StartsWith($resolvedRepo, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escaped repository' }
if (Test-Path -LiteralPath $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'www\admin') -Force | Out-Null

$env:VITE_API_BASE_URL = 'https://stest.saydian.cn/api/saidian-ops'
$env:VITE_BASE_PATH = '/saidian-ops/'
Set-Location $repoRoot
& pnpm.cmd build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
& pnpm.cmd --config.node-linker=hoisted --package-import-method=copy --filter '@saidian-ops/api' deploy --prod --legacy (Join-Path $packageRoot 'api')
if ($LASTEXITCODE -ne 0) { throw 'API deploy package failed' }

Copy-Item -Path (Join-Path $repoRoot 'apps\admin\dist\*') -Destination (Join-Path $packageRoot 'www\admin') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\windows\install.ps1') -Destination (Join-Path $packageRoot 'install.ps1') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\windows\start-api.ps1') -Destination (Join-Path $packageRoot 'start-api.ps1') -Force
Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal
Write-Output "PACKAGE_OK=$archivePath"
