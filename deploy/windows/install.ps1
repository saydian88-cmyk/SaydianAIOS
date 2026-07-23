param(
  [string]$OssAccessKeyId = '',
  [string]$OssAccessKeySecret = '',
  [string]$WecomWebhookUrl = '',
  [string]$MallAdminUsername = '',
  [string]$MallAdminPassword = ''
)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = 'C:\saidian-ops'
$node = 'C:\saydian\runtime\node\node.exe'
$psql = 'C:\farm-mall\postgres\pgsql\bin\psql.exe'
$caddy = 'C:\saydian\runtime\caddy4.exe'
$caddyFile = 'C:\saydian\Caddyfile'
$taskName = 'SaidianOpsApi'
$envPath = Join-Path $root '.env'

foreach ($required in @($node, $psql, $caddy, $caddyFile)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Missing dependency: $required" }
}

foreach ($directory in @($root, "$root\api", "$root\www", "$root\www\admin", "$root\logs", "$root\data\derived", "$root\data\bootstrap", "$root\empty-source")) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

Copy-Item -Path (Join-Path $packageRoot 'api\*') -Destination (Join-Path $root 'api') -Recurse -Force
Copy-Item -Path (Join-Path $packageRoot 'www\admin\*') -Destination (Join-Path $root 'www\admin') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $packageRoot 'start-api.ps1') -Destination (Join-Path $root 'start-api.ps1') -Force

function New-RandomHex([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return (($buffer | ForEach-Object { $_.ToString('x2') }) -join '')
}

if (-not (Test-Path -LiteralPath $envPath)) {
  $dbPassword = New-RandomHex 24
  $adminToken = New-RandomHex 32
  $roleExists = (@(& $psql -h 127.0.0.1 -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='saidian_ops';") -join '').Trim()
  if ($roleExists -eq '1') {
    & $psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -c "ALTER ROLE saidian_ops WITH LOGIN PASSWORD '$dbPassword';"
  } else {
    & $psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -c "CREATE ROLE saidian_ops LOGIN PASSWORD '$dbPassword';"
  }
  if ($LASTEXITCODE -ne 0) { throw 'Database role initialization failed' }
  $databaseExists = (@(& $psql -h 127.0.0.1 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='saidian_ops';") -join '').Trim()
  if ($databaseExists -ne '1') {
    & $psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -c 'CREATE DATABASE saidian_ops OWNER saidian_ops;'
    if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed' }
  }
  $envText = @"
NODE_ENV=production
PORT=3210
OPS_HOST=127.0.0.1
OPS_ADMIN_TOKEN=$adminToken
OPS_AUTH_SECRET=$adminToken
OPS_DEFAULT_ACTOR=运营负责人
OPS_TIME_ZONE=Asia/Shanghai
OPS_PUBLIC_BASE_URL=https://stest.saydian.cn/api/saidian-ops
OPS_WEB_BASE_URL=https://stest.saydian.cn/saidian-ops/
DATABASE_URL=postgresql://saidian_ops:$dbPassword@127.0.0.1:5432/saidian_ops?schema=public
ASSET_ROOTS=C:\saidian-ops\empty-source
WECOM_DRIVE_SYNC_ROOT=
DERIVED_OUTPUT_DIR=C:\saidian-ops\data\derived
BOOTSTRAP_DATA_DIR=C:\saidian-ops\data\bootstrap
HELP_CENTER_CONTENT_URL=https://kf.saydian.cn/api/content
MALL_BASE_URL=https://stest.saydian.cn/api/saidian-mall/v1
MALL_ADMIN_USERNAME=$MallAdminUsername
MALL_ADMIN_PASSWORD=$MallAdminPassword
WECOM_WEBHOOK_URL=$WecomWebhookUrl
OSS_REGION=oss-cn-shenzhen
OSS_BUCKET=saidian-brand-assets-prod-sz
OSS_ENDPOINT=oss-cn-shenzhen.aliyuncs.com
OSS_ACCESS_KEY_ID=$OssAccessKeyId
OSS_ACCESS_KEY_SECRET=$OssAccessKeySecret
OSS_PREFIX=brand-assets
DOUYIN_CLIENT_KEY=
DOUYIN_CLIENT_SECRET=
DOUYIN_OPEN_ID=
DOUYIN_ACCESS_TOKEN=
VIDEO_RENDER_COMMAND=
BAILIAN_API_KEY=
BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
BAILIAN_VISION_MODEL=qwen-vl-max
BAILIAN_TEXT_MODEL=qwen-plus
BAILIAN_TRANSCRIPTION_URL=
BAILIAN_TRANSCRIPTION_MODEL=
"@
  [IO.File]::WriteAllText($envPath, $envText, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $root 'INITIAL-ACCESS.txt'), "URL=https://stest.saydian.cn/saidian-ops/`r`nTOKEN=$adminToken`r`n", [Text.UTF8Encoding]::new($false))
}

$envLines = [Collections.Generic.List[string]](Get-Content -LiteralPath $envPath)
function Set-EnvValue([string]$name, [string]$value) {
  $prefix = "$name="
  for ($index = 0; $index -lt $envLines.Count; $index += 1) {
    if ($envLines[$index].StartsWith($prefix, [StringComparison]::Ordinal)) {
      $envLines[$index] = "$prefix$value"
      return
    }
  }
  $envLines.Add("$prefix$value")
}
Set-EnvValue 'OSS_REGION' 'oss-cn-shenzhen'
Set-EnvValue 'OSS_BUCKET' 'saidian-brand-assets-prod-sz'
Set-EnvValue 'OSS_ENDPOINT' 'oss-cn-shenzhen.aliyuncs.com'
$existingAdminToken = (($envLines | Where-Object { $_.StartsWith('OPS_ADMIN_TOKEN=', [StringComparison]::Ordinal) } | Select-Object -First 1) -replace '^OPS_ADMIN_TOKEN=', '')
foreach ($optionalEnv in @(
  @{ Name = 'OPS_AUTH_SECRET'; Value = $existingAdminToken },
  @{ Name = 'OPS_WEB_BASE_URL'; Value = 'https://stest.saydian.cn/saidian-ops/' },
  @{ Name = 'BAILIAN_API_KEY'; Value = '' },
  @{ Name = 'BAILIAN_BASE_URL'; Value = 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  @{ Name = 'BAILIAN_VISION_MODEL'; Value = 'qwen-vl-max' },
  @{ Name = 'BAILIAN_TEXT_MODEL'; Value = 'qwen-plus' },
  @{ Name = 'BAILIAN_TRANSCRIPTION_URL'; Value = '' },
  @{ Name = 'BAILIAN_TRANSCRIPTION_MODEL'; Value = '' }
)) {
  if (-not ($envLines | Where-Object { $_.StartsWith("$($optionalEnv.Name)=", [StringComparison]::Ordinal) })) {
    $envLines.Add("$($optionalEnv.Name)=$($optionalEnv.Value)")
  }
}
[IO.File]::WriteAllLines($envPath, $envLines, [Text.UTF8Encoding]::new($false))

Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}

Set-Location (Join-Path $root 'api')
& $node (Join-Path $root 'api\node_modules\prisma\build\index.js') db push --schema (Join-Path $root 'api\prisma\schema.prisma')
if ($LASTEXITCODE -ne 0) { throw 'Database schema push failed' }
& $node (Join-Path $root 'api\node_modules\tsx\dist\cli.mjs') (Join-Path $root 'api\prisma\seed.ts')
if ($LASTEXITCODE -ne 0) { throw 'Database seed failed' }
& $node (Join-Path $root 'api\node_modules\tsx\dist\cli.mjs') (Join-Path $root 'api\prisma\backfill-asset-v2.ts')
if ($LASTEXITCODE -ne 0) { throw 'Asset V2 backfill failed' }

cmd.exe /c "schtasks /End /TN $taskName >NUL 2>&1" | Out-Null
$taskAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$root\start-api.ps1`""
cmd.exe /c "schtasks /Create /F /SC ONSTART /RL HIGHEST /RU SYSTEM /TN $taskName /TR `"$taskAction`"" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'API task creation failed' }
cmd.exe /c "schtasks /Run /TN $taskName" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'API task start failed' }

$ready = $false
for ($index = 0; $index -lt 90; $index += 1) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3210/health' -TimeoutSec 2
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $ready) { Get-Content -LiteralPath (Join-Path $root 'logs\api.log') -Tail 160 -ErrorAction SilentlyContinue; throw 'Saidian Ops API did not become ready' }

$marker = '# SAIDIAN_OPS_BEGIN'
if (-not (Select-String -LiteralPath $caddyFile -SimpleMatch $marker -Quiet)) {
  $original = [IO.File]::ReadAllText($caddyFile)
  $siteStart = 'stest.saydian.cn {'
  $routeBlock = @"
stest.saydian.cn {
    # SAIDIAN_OPS_BEGIN
    handle_path /api/saidian-ops/* {
        reverse_proxy 127.0.0.1:3210
    }
    handle_path /saidian-ops/* {
        root * C:/saidian-ops/www/admin
        try_files {path} /index.html
        file_server
    }
    # SAIDIAN_OPS_END
"@
  if (-not $original.Contains($siteStart)) { throw 'stest.saydian.cn site block not found' }
  $updated = $original.Replace($siteStart, $routeBlock)
  [IO.File]::WriteAllText("$caddyFile.saidian-ops.bak", $original, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($caddyFile, $updated, [Text.UTF8Encoding]::new($false))
  & $caddy validate --config $caddyFile --adapter caddyfile
  if ($LASTEXITCODE -ne 0) { Copy-Item -LiteralPath "$caddyFile.saidian-ops.bak" -Destination $caddyFile -Force; throw 'Caddy validation failed' }
}

& $caddy reload --config $caddyFile --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Caddy reload failed' }
Write-Output 'SAIDIAN_OPS_INSTALL_OK'
Write-Output 'ACCESS_FILE=C:\saidian-ops\INITIAL-ACCESS.txt'
