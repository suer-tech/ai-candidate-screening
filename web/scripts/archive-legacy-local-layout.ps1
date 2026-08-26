$ErrorActionPreference = "Stop"
$webRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $webRoot ".runtime"))
$backupRoot = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "legacy-backups"))
$timestamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$destination = [System.IO.Path]::GetFullPath((Join-Path $backupRoot "$timestamp\local-runtime-layout"))
if (-not $destination.StartsWith($backupRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "LEGACY_LAYOUT_BACKUP_SCOPE_INVALID" }

$names = @(
  "local-services.env", "secrets",
  "controller.stderr.log", "controller.stdout.log", "document-processor.stderr.log", "document-processor.stdout.log",
  "media-processor.stderr.log", "media-processor.stdout.log", "web.stderr.log", "web.stdout.log", "worker.stderr.log", "worker.stdout.log",
  "fixture-controller.sqlite", "fixture-controller.sqlite-shm", "fixture-controller.sqlite-wal", "live-controller.sqlite"
)
$sources = @($names | ForEach-Object {
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot $_))
  if (-not $candidate.StartsWith($runtimeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "LEGACY_LAYOUT_SOURCE_SCOPE_INVALID" }
  if (Test-Path -LiteralPath $candidate) { $candidate }
})
if ($sources.Count -eq 0) { Write-Output '{"archived":true,"items":0,"recoverable":true,"valuesPrinted":0}'; exit 0 }
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($source in $sources) { Move-Item -LiteralPath $source -Destination $destination }
$files = @(Get-ChildItem -LiteralPath $destination -Recurse -File)
foreach ($file in $files) { $file.IsReadOnly = $true }
$evidence = [ordered]@{ archived = $true; items = $sources.Count; files = $files.Count; recoverable = $true; valuesPrinted = 0; personalDataInspected = $false }
[System.IO.File]::WriteAllText((Join-Path (Split-Path $destination -Parent) "local-layout-evidence.json"), ($evidence | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
Write-Output ($evidence | ConvertTo-Json -Compress)
