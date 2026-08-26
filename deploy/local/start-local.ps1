param(
  [switch]$NoBuild,
  [switch]$SkipWeb,
  [switch]$SkipWorker,
  [switch]$IncludeFixtureController
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$webRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot "web")).Path
$runtimeRoot = Join-Path $webRoot ".runtime"
$logRoot = Join-Path $runtimeRoot "logs"
$pidFile = Join-Path $runtimeRoot "local-services.json"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

if (Test-Path -LiteralPath $pidFile) {
  $knownServices = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  $running = @($knownServices | ForEach-Object { if (Get-Process -Id ([int]$_.pid) -ErrorAction SilentlyContinue) { $_ } })
  if ($running.Count -gt 0) { throw "LOCAL_SERVICES_ALREADY_RUNNING" }
  Remove-Item -LiteralPath $pidFile -Force
}

function Invoke-Npm([string[]]$Arguments) {
  & npm.cmd @Arguments --prefix $webRoot
  if ($LASTEXITCODE -ne 0) { throw "NPM_COMMAND_FAILED:$($Arguments -join '-')" }
}

Invoke-Npm @("run", "config:migrate")
Invoke-Npm @("run", "postgres:up")
Invoke-Npm @("run", "db:migrate")
Invoke-Npm @("run", "preflight:runtime")
if (-not $NoBuild -and -not $SkipWeb) { Invoke-Npm @("run", "build") }

$runtimeValues = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $runtimeRoot "runtime.env")) {
  if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $runtimeValues[$Matches[1]] = $Matches[2] }
}
$appOrigin = if ($runtimeValues.APP_ORIGIN) { $runtimeValues.APP_ORIGIN.TrimEnd('/') } else { "http://127.0.0.1:3000" }

$processes = @()
function Start-ManagedService([string]$Name, [string]$Script) {
  $process = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", $Script) -WorkingDirectory $webRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot "$Name.stdout.log") -RedirectStandardError (Join-Path $logRoot "$Name.stderr.log") -PassThru
  $script:processes += @{ name = $Name; pid = $process.Id }
}

function Wait-Http([string]$Name, [string]$Url, [int]$Attempts = 60) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
    } catch { Start-Sleep -Milliseconds 500; continue }
    Start-Sleep -Milliseconds 500
  }
  throw "SERVICE_START_TIMEOUT:$Name"
}

function Wait-Tcp([string]$Name, [string]$HostName, [int]$Port, [int]$Attempts = 60) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $pending = $client.BeginConnect($HostName, $Port, $null, $null)
      if ($pending.AsyncWaitHandle.WaitOne(1000) -and $client.Connected) { $client.EndConnect($pending); return }
    } catch { } finally { $client.Dispose() }
    Start-Sleep -Milliseconds 500
  }
  throw "SERVICE_START_TIMEOUT:$Name"
}

try {
  Start-ManagedService "media-processor" "service:media-processor"
  Start-ManagedService "document-processor" "service:document-processor"
  if (-not $SkipWeb) { Start-ManagedService "web" "start" }
  if (-not $SkipWorker) { Start-ManagedService "agent-worker" "service:agent-worker" }
  if ($IncludeFixtureController) { Start-ManagedService "fixture-controller" "service:fixture-controller" }
  [System.IO.File]::WriteAllText($pidFile, ($processes | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
  Wait-Tcp "media-processor" $runtimeValues.MEDIA_PROCESSOR_HOST ([int]$runtimeValues.MEDIA_PROCESSOR_PORT)
  Wait-Tcp "document-processor" $runtimeValues.DOCUMENT_PROCESSOR_HOST ([int]$runtimeValues.DOCUMENT_PROCESSOR_PORT)
  if (-not $SkipWeb) { Wait-Http "web" "$appOrigin/api/health/live" }
} catch {
  if (Test-Path -LiteralPath $pidFile) { & (Join-Path $PSScriptRoot "stop-local.ps1") }
  throw
}

Write-Output "Local PostgreSQL/Node contour is running."
if (-not $SkipWeb) { Write-Output "Web: $appOrigin" }
Write-Output "Logs: $logRoot"
Write-Output "PID file: $pidFile"
