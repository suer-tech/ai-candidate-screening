param([ValidateSet("up", "down", "status", "logs")][string]$Action = "up")
$ErrorActionPreference = "Stop"
$webRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$credential = Join-Path $webRoot ".runtime\credentials\database-url"
if (-not (Test-Path -LiteralPath $credential)) { throw "DATABASE_URL_CREDENTIAL_MISSING: run scripts/migrate-local-configuration.ps1" }
$databaseUri = [Uri]([System.IO.File]::ReadAllText($credential).Trim())
$userInfo = $databaseUri.UserInfo.Split(':', 2)
if ($userInfo.Count -ne 2) { throw "DATABASE_URL_CREDENTIAL_INVALID" }
$env:HH_POSTGRES_PASSWORD = [Uri]::UnescapeDataString($userInfo[1])
try {
  Push-Location $webRoot
  switch ($Action) {
    "up" { docker compose -f compose.postgres.yml up -d --wait }
    "down" { docker compose -f compose.postgres.yml down }
    "status" { docker compose -f compose.postgres.yml ps }
    "logs" { docker compose -f compose.postgres.yml logs --tail 100 postgres }
  }
  if ($LASTEXITCODE -ne 0) { throw "LOCAL_POSTGRES_$($Action.ToUpperInvariant())_FAILED" }
} finally {
  Pop-Location
  Remove-Item Env:HH_POSTGRES_PASSWORD -ErrorAction SilentlyContinue
}
