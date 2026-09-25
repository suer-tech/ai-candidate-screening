Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$containerName = 'hh-matrix-test-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$started = $false
$atWeb = $false

try {
  $containerId = & docker run -d --rm --name $containerName `
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=hh_matrix_test `
    -p '127.0.0.1::5432' postgres:16.10-alpine
  if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw 'MATRIX_TEST_POSTGRES_START_FAILED' }
  $started = $true

  $binding = & docker port $containerName '5432/tcp'
  if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'MATRIX_TEST_POSTGRES_PORT_INVALID' }
  $port = $Matches[1]
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $containerName pg_isready -U postgres -d hh_matrix_test *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'MATRIX_TEST_POSTGRES_NOT_READY' }

  $env:MATRIX_TEST_POSTGRES_URL = "postgresql://postgres@127.0.0.1:$port/hh_matrix_test"
  Push-Location (Join-Path $repoRoot 'web')
  $atWeb = $true
  & npm run test:matrix-isolated-postgres
  if ($LASTEXITCODE -ne 0) { throw 'MATRIX_TEST_POSTGRES_FAILED' }
  & npm run test:e2e-harness
  if ($LASTEXITCODE -ne 0) { throw 'E2E_HARNESS_ISOLATED_POSTGRES_FAILED' }
} finally {
  if ($atWeb) { Pop-Location }
  Remove-Item Env:MATRIX_TEST_POSTGRES_URL -ErrorAction SilentlyContinue
  if ($started) { & docker stop $containerName *> $null }
}
