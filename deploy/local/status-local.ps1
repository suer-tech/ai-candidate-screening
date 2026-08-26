$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$webRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot "web")).Path
$runtimeRoot = Join-Path $webRoot ".runtime"
$pidFile = Join-Path $runtimeRoot "local-services.json"
$runtimeFile = Join-Path $runtimeRoot "runtime.env"

$values = @{}
foreach ($line in Get-Content -LiteralPath $runtimeFile) {
  if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
}
function Test-Tcp([string]$HostName, [int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($HostName, $Port, $null, $null)
    return $pending.AsyncWaitHandle.WaitOne(1000) -and $client.Connected
  } catch { return $false } finally { $client.Dispose() }
}

$services = @()
if (Test-Path -LiteralPath $pidFile) {
  $serviceEntries = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  foreach ($entry in $serviceEntries) {
    $services += [ordered]@{ name = [string]$entry.name; running = [bool](Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue) }
  }
}
$appOrigin = if ($values.APP_ORIGIN) { $values.APP_ORIGIN.TrimEnd('/') } else { "http://127.0.0.1:3000" }
$mediaHost = [string]$values["MEDIA_PROCESSOR_HOST"]
$mediaPort = [int]([string]$values["MEDIA_PROCESSOR_PORT"])
$documentHost = [string]$values["DOCUMENT_PROCESSOR_HOST"]
$documentPort = [int]([string]$values["DOCUMENT_PROCESSOR_PORT"])
$webReady = try { (Invoke-WebRequest -UseBasicParsing -Uri "$appOrigin/api/health/live" -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
$result = [ordered]@{
  ready = $services.Count -ge 4 -and -not ($services.running -contains $false) -and $webReady
  web = $webReady
  worker = [bool]($services | Where-Object { $_.name -eq "agent-worker" -and $_.running })
  mediaProcessor = Test-Tcp $mediaHost $mediaPort
  documentProcessor = Test-Tcp $documentHost $documentPort
  postgresql = Test-Tcp "127.0.0.1" 54329
  services = $services
  secretsExposed = 0
}
$result.ready = $result.ready -and $result.mediaProcessor -and $result.documentProcessor -and $result.postgresql
$result | ConvertTo-Json -Depth 4 -Compress
if (-not $result.ready) { exit 1 }
