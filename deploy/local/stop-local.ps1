$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$webRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot "web")).Path
$runtimeRoot = Join-Path $webRoot ".runtime"
$pidFile = Join-Path $runtimeRoot "local-services.json"
$stopped = New-Object 'System.Collections.Generic.HashSet[int]'
$snapshot = @(Get-CimInstance Win32_Process)

function Get-ProcessTreeIds([int]$RootProcessId) {
  $ids = @()
  foreach ($child in @($snapshot | Where-Object { $_.ParentProcessId -eq $RootProcessId })) {
    $ids += Get-ProcessTreeIds -RootProcessId ([int]$child.ProcessId)
  }
  $ids += $RootProcessId
  return $ids
}

if (Test-Path -LiteralPath $pidFile) {
  $serviceEntries = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  foreach ($entry in $serviceEntries) {
    foreach ($processId in @(Get-ProcessTreeIds -RootProcessId ([int]$entry.pid))) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($process) { Stop-Process -Id $process.Id -ErrorAction Stop; [void]$stopped.Add([int]$process.Id) }
    }
  }
  Remove-Item -LiteralPath $pidFile -Force
}

$ownedEntries = @("scripts/run-runtime-process.ts", ".output/server/index.mjs")
foreach ($entry in $snapshot) {
  $command = [string]$entry.CommandLine
  if ($command.IndexOf($webRoot, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
  if (-not ($ownedEntries | Where-Object { $command.IndexOf($_, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 })) { continue }
  foreach ($processId in @(Get-ProcessTreeIds -RootProcessId ([int]$entry.ProcessId))) {
    if ($stopped.Contains([int]$processId)) { continue }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) { Stop-Process -Id $process.Id -ErrorAction Stop; [void]$stopped.Add([int]$process.Id) }
  }
}

& npm.cmd run postgres:down --prefix $webRoot
if ($LASTEXITCODE -ne 0) { throw "POSTGRES_STOP_FAILED" }
Write-Output "Local contour stopped: $($stopped.Count) Node processes; PostgreSQL container stopped."
