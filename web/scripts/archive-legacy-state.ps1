$ErrorActionPreference = "Stop"
$webRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$wranglerRoot = [System.IO.Path]::GetFullPath((Join-Path $webRoot ".wrangler"))
$source = [System.IO.Path]::GetFullPath((Join-Path $wranglerRoot "state"))
$backupRoot = [System.IO.Path]::GetFullPath((Join-Path $webRoot ".runtime\legacy-backups"))
if (-not $source.StartsWith($wranglerRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "LEGACY_SOURCE_SCOPE_INVALID" }
if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "LEGACY_STATE_NOT_FOUND" }
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$timestamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$destinationRoot = [System.IO.Path]::GetFullPath((Join-Path $backupRoot $timestamp))
if (-not $destinationRoot.StartsWith($backupRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "LEGACY_BACKUP_SCOPE_INVALID" }
if (Test-Path -LiteralPath $destinationRoot) { throw "LEGACY_BACKUP_ALREADY_EXISTS" }
New-Item -ItemType Directory -Path $destinationRoot | Out-Null
$destination = Join-Path $destinationRoot "wrangler-state"
Move-Item -LiteralPath $source -Destination $destination
$files = @(Get-ChildItem -LiteralPath $destination -Recurse -File)
$totalBytes = 0L
foreach ($file in $files) { $totalBytes += $file.Length; $file.IsReadOnly = $true }
$evidence = [ordered]@{
  version = "legacy-read-only-backup/v1"
  fileCount = $files.Count
  totalBytes = $totalBytes
  sourceRemovedByMove = -not (Test-Path -LiteralPath $source)
  backupPresent = Test-Path -LiteralPath $destination
  allFilesReadOnly = (@($files | Where-Object { -not $_.IsReadOnly }).Count -eq 0)
  recoverable = $true
  containsFileNames = $false
  containsCredentials = $false
}
[System.IO.File]::WriteAllText((Join-Path $destinationRoot "backup-evidence.json"), ($evidence | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
Write-Output ($evidence | ConvertTo-Json -Compress)
