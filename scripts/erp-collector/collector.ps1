param(
  [string]$ConfigPath = "$PSScriptRoot\config.json"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "缺少采集器配置：$ConfigPath"
}

$collectorConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$tokenName = [string]$collectorConfig.ApiTokenEnvironmentVariable
$apiToken = [Environment]::GetEnvironmentVariable($tokenName, "Machine")
if (-not $apiToken) {
  $apiToken = [Environment]::GetEnvironmentVariable($tokenName, "User")
}
if (-not $apiToken) {
  throw "环境变量 $tokenName 未配置"
}

$exportFolder = [IO.Path]::GetFullPath([string]$collectorConfig.ExportFolder)
$archiveFolder = [IO.Path]::GetFullPath([string]$collectorConfig.ArchiveFolder)
$stateFile = [IO.Path]::GetFullPath([string]$collectorConfig.StateFile)
New-Item -ItemType Directory -Force -Path $exportFolder, $archiveFolder | Out-Null

$state = @{ ImportedHashes = @(); ImportedFiles = @() }
if (Test-Path -LiteralPath $stateFile) {
  $loaded = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($loaded) {
    $state.ImportedHashes = @($loaded.ImportedHashes)
    $state.ImportedFiles = @($loaded.ImportedFiles)
  }
}

function Convert-XlsxToCsv {
  param([string]$InputPath)
  $excel = $null
  $workbook = $null
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $workbook = $excel.Workbooks.Open($InputPath, 0, $true)
    $csvPath = Join-Path $env:TEMP ("saidian-jst-" + [Guid]::NewGuid().ToString("N") + ".csv")
    $workbook.Worksheets.Item(1).SaveAs($csvPath, 62)
    return $csvPath
  }
  finally {
    if ($workbook) { $workbook.Close($false) }
    if ($excel) { $excel.Quit() }
    if ($workbook) { [Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null }
    if ($excel) { [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }
  }
}

$files = Get-ChildItem -LiteralPath $exportFolder -File |
  Where-Object { $_.Extension -in ".csv", ".json", ".xlsx" } |
  Sort-Object LastWriteTime

foreach ($file in $files) {
  $resolvedFile = $file.FullName
  $hash = (Get-FileHash -LiteralPath $resolvedFile -Algorithm SHA256).Hash
  if ($state.ImportedHashes -contains $hash) { continue }

  $temporaryCsv = $null
  try {
    $uploadPath = $resolvedFile
    $format = $file.Extension.TrimStart(".").ToUpperInvariant()
    if ($file.Extension -eq ".xlsx") {
      $temporaryCsv = Convert-XlsxToCsv -InputPath $resolvedFile
      $uploadPath = $temporaryCsv
      $format = "CSV"
    }

    $periodEnd = $file.LastWriteTime.Date.AddDays(1).AddSeconds(-1)
    $periodStart = $periodEnd.Date.AddDays(-([int]$collectorConfig.PeriodDays - 1))
    $body = @{
      source = "JUSHUITAN_EXPORT"
      sourceName = $file.Name
      format = $format
      periodStart = $periodStart.ToString("yyyy-MM-dd")
      periodEnd = $periodEnd.ToString("yyyy-MM-dd")
    }
    if ($format -eq "JSON") {
      $body.records = Get-Content -LiteralPath $uploadPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
      $body.csv = Get-Content -LiteralPath $uploadPath -Raw -Encoding UTF8
    }

    $headers = @{
      Authorization = "Bearer $apiToken"
      "x-ops-actor" = [Uri]::EscapeDataString([string]$collectorConfig.Actor)
    }
    $result = Invoke-RestMethod -Method Post `
      -Uri "$($collectorConfig.ApiBaseUrl.TrimEnd('/'))/api/v1/operation-analysis/imports" `
      -Headers $headers -ContentType "application/json; charset=utf-8" `
      -Body ($body | ConvertTo-Json -Depth 20 -Compress)

    $state.ImportedHashes += $hash
    $state.ImportedFiles += @{
      Hash = $hash
      File = $file.Name
      ImportedAt = (Get-Date).ToString("o")
      RunNo = $result.run.runNo
      Duplicate = [bool]$result.duplicate
    }
    $destination = Join-Path $archiveFolder $file.Name
    if (-not (Test-Path -LiteralPath $destination)) {
      Move-Item -LiteralPath $resolvedFile -Destination $destination
    }
  }
  catch {
    Write-Error "导入失败 $($file.Name)：$($_.Exception.Message)"
  }
  finally {
    if ($temporaryCsv -and (Test-Path -LiteralPath $temporaryCsv)) {
      Remove-Item -LiteralPath $temporaryCsv -Force
    }
    $state | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $stateFile -Encoding UTF8
  }
}
