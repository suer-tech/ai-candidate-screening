param(
  [Parameter(Position=0)][ValidateSet("bootstrap", "check", "start", "status", "stop")][string]$Action = "start",
  [switch]$NoBuild,
  [switch]$IncludeFixtureController
)
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$webRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot "web")).Path
switch ($Action) {
  "bootstrap" {
    & npm.cmd run config:migrate --prefix $webRoot
    if ($LASTEXITCODE -ne 0) { throw "CONFIG_MIGRATION_FAILED" }
    & npm.cmd run postgres:up --prefix $webRoot
    if ($LASTEXITCODE -ne 0) { throw "POSTGRES_START_FAILED" }
    & npm.cmd run db:migrate --prefix $webRoot
    if ($LASTEXITCODE -ne 0) { throw "POSTGRES_MIGRATION_FAILED" }
    & npm.cmd run preflight:runtime --prefix $webRoot
    if ($LASTEXITCODE -ne 0) { throw "RUNTIME_PREFLIGHT_FAILED" }
  }
  "check" {
    & npm.cmd run preflight:runtime --prefix $webRoot
    if ($LASTEXITCODE -ne 0) { throw "RUNTIME_PREFLIGHT_FAILED" }
  }
  "start" { & (Join-Path $PSScriptRoot "start-local.ps1") -NoBuild:$NoBuild -IncludeFixtureController:$IncludeFixtureController }
  "status" { & (Join-Path $PSScriptRoot "status-local.ps1") }
  "stop" { & (Join-Path $PSScriptRoot "stop-local.ps1") }
}
