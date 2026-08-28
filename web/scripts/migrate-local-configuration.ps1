$ErrorActionPreference = "Stop"

$webRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = Join-Path $webRoot ".runtime"
$legacyEnvPath = Join-Path $runtimeRoot "local-services.env"
$legacySecretRoot = Join-Path $runtimeRoot "secrets"
$credentialRoot = Join-Path $runtimeRoot "credentials"
$runtimeEnvPath = Join-Path $runtimeRoot "runtime.env"

New-Item -ItemType Directory -Force -Path $credentialRoot | Out-Null

function Write-NewFile([string]$Path, [string]$Value) {
  if (Test-Path -LiteralPath $Path) { return }
  $temporary = "$Path.new"
  [System.IO.File]::WriteAllText($temporary, $Value.TrimEnd() + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $Path
}

function Copy-NewCredential([string]$OldName, [string]$NewName) {
  $source = Join-Path $legacySecretRoot $OldName
  $destination = Join-Path $credentialRoot $NewName
  if (-not (Test-Path -LiteralPath $destination)) {
    if (-not (Test-Path -LiteralPath $source)) { throw "MISSING_LEGACY_CREDENTIAL:$OldName" }
    Copy-Item -LiteralPath $source -Destination $destination
  }
}

$legacy = @{}
if (Test-Path -LiteralPath $legacyEnvPath) {
  foreach ($raw in [System.IO.File]::ReadAllLines($legacyEnvPath)) {
    if ($raw -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $legacy[$Matches[1]] = $Matches[2] }
  }
}

Copy-NewCredential "google-oauth-client-secret.key" "google-oauth-client-secret"
Copy-NewCredential "google-oauth-keyring.json" "google-oauth-keyring.json"
Copy-NewCredential "routerai.key" "routerai-api-key"
Copy-NewCredential "assemblyai.key" "assemblyai-api-key"
Copy-NewCredential "telegram.key" "telegram-bot-token"
Copy-NewCredential "telegram-recipients.json" "telegram-recipients.json"

$tokenKeys = @(
  "AGENT_RUNTIME_INTERNAL_TOKEN", "CANDIDATE_TOOL_INTERNAL_TOKEN", "MEDIA_PROCESSOR_TOKEN",
  "DOCUMENT_PROCESSOR_TOKEN", "E2E_PREFLIGHT_TOKEN", "E2E_CONTROL_TOKEN", "E2E_FIXTURE_CONTROL_TOKEN"
)
$tokens = [ordered]@{}
foreach ($key in $tokenKeys) { if ($legacy.ContainsKey($key) -and $legacy[$key]) { $tokens[$key] = $legacy[$key] } }
Write-NewFile (Join-Path $credentialRoot "internal-service-tokens.json") ($tokens | ConvertTo-Json -Compress)

$databaseCredential = Join-Path $credentialRoot "database-url"
if (-not (Test-Path -LiteralPath $databaseCredential)) {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  Write-NewFile $databaseCredential "postgresql://hh_agent:$password@127.0.0.1:54329/hh_agent"
}

if (-not (Test-Path -LiteralPath $runtimeEnvPath)) {
  $value = {
    param([string]$Name, [string]$Fallback)
    if ($legacy.ContainsKey($Name)) { return $legacy[$Name] }
    return $Fallback
  }
  $lines = @(
    "# Single local non-secret configuration. Secrets live only in credentials/.",
    "NODE_ENV=development", "HOST=127.0.0.1", "PORT=3000", "APP_ORIGIN=http://127.0.0.1:3000", "INTERNAL_APP_ORIGIN=http://127.0.0.1:3000",
    "DATABASE_MAX_CONNECTIONS=10", "DATABASE_IDLE_TIMEOUT_SECONDS=20", "DATABASE_CONNECT_TIMEOUT_SECONDS=10",
    "LOCAL_AUTH_USER_ID=$(& $value 'LOCAL_AUTH_USER_ID' 'local-hr')", "LOCAL_AUTH_USER_EMAIL=$(& $value 'LOCAL_AUTH_USER_EMAIL' 'local-hr@example.invalid')", "LOCAL_AUTH_USER_FULL_NAME=$(& $value 'LOCAL_AUTH_USER_FULL_NAME' 'Local HR')",
    "GOOGLE_OAUTH_CLIENT_ID=$(& $value 'GOOGLE_OAUTH_CLIENT_ID' '')", "GOOGLE_OAUTH_REDIRECT_URI=$(& $value 'GOOGLE_OAUTH_REDIRECT_URI' 'http://127.0.0.1:3000/api/integrations/google-drive/oauth/callback')", "GOOGLE_OAUTH_DEPLOYMENT_MODE=$(& $value 'GOOGLE_OAUTH_DEPLOYMENT_MODE' 'production-personal')",
    "AGENT_RUNTIME_ENVIRONMENT=$(& $value 'AGENT_RUNTIME_ENVIRONMENT' 'local')", "AGENT_RUNTIME_WORKER_ID=$(& $value 'AGENT_RUNTIME_WORKER_ID' 'local-worker-1')", "AGENT_RUNTIME_POLLING_MS=$(& $value 'AGENT_RUNTIME_POLLING_MS' '500')", "AGENT_RUNTIME_HEARTBEAT_MS=$(& $value 'AGENT_RUNTIME_HEARTBEAT_MS' '5000')", "AGENT_RUNTIME_LEASE_MS=$(& $value 'AGENT_RUNTIME_LEASE_MS' '30000')",
    "CANDIDATE_TOOL_EXECUTION_MODE=$(& $value 'CANDIDATE_TOOL_EXECUTION_MODE' 'production')", "CANDIDATE_PIPELINE_ROUTING=$(& $value 'CANDIDATE_PIPELINE_ROUTING' 'effectful')", "CANDIDATE_PIPELINE_BUILD_ID=$(& $value 'CANDIDATE_PIPELINE_BUILD_ID' 'local-unprovisioned')",
    "MEDIA_PROCESSOR_URL=$(& $value 'MEDIA_PROCESSOR_URL' 'http://127.0.0.1:4311/v1/extract-audio')", "MEDIA_PROCESSOR_HOST=127.0.0.1", "MEDIA_PROCESSOR_PORT=4311", "MEDIA_PROCESSOR_MAX_INPUT_BYTES=$(& $value 'MEDIA_PROCESSOR_MAX_INPUT_BYTES' '1073741824')",
    "DOCUMENT_PROCESSOR_URL=$(& $value 'DOCUMENT_PROCESSOR_URL' 'http://127.0.0.1:4312/v1/extract-document')", "DOCUMENT_PROCESSOR_HOST=127.0.0.1", "DOCUMENT_PROCESSOR_PORT=4312", "DOCUMENT_PROCESSOR_MAX_INPUT_BYTES=$(& $value 'DOCUMENT_PROCESSOR_MAX_INPUT_BYTES' '67108864')",
    "E2E_ENVIRONMENT=local", "E2E_FIXTURE_SET_ID=$(& $value 'E2E_FIXTURE_SET_ID' 'local-canonical-v1')", "E2E_ALLOW_DESTRUCTIVE_CLEANUP=false", "FIXTURE_CONTROLLER_PORT=$(& $value 'FIXTURE_CONTROLLER_PORT' '4310')", "FIXTURE_CONTROLLER_STATE_PATH=.runtime/fixture-controller.sqlite"
  )
  Write-NewFile $runtimeEnvPath ($lines -join [Environment]::NewLine)
}

function Ensure-RuntimeSetting([string]$Name, [string]$Value) {
  $existing = [System.IO.File]::ReadAllLines($runtimeEnvPath)
  if ($existing | Where-Object { $_ -match "^$([Regex]::Escape($Name))=" }) { return }
  [System.IO.File]::AppendAllText($runtimeEnvPath, "$Name=$Value$([Environment]::NewLine)", [System.Text.UTF8Encoding]::new($false))
}

$llmRelease = "local-routerai-v1"
$llmEndpoint = "https://routerai.ru/api/v1/chat/completions"
$llmModel = "openai/gpt-5.6-sol"
$legacyLlmConfig = Join-Path $legacySecretRoot "llm-runtime.json"
if (Test-Path -LiteralPath $legacyLlmConfig) {
  $parsedLlm = Get-Content -LiteralPath $legacyLlmConfig -Raw | ConvertFrom-Json
  if ($parsedLlm.releaseVersion) { $llmRelease = [string]$parsedLlm.releaseVersion }
  $vacancyCapability = $parsedLlm.capabilities.vacancy_generation
  if ($vacancyCapability.model) { $llmModel = [string]$vacancyCapability.model }
  $providerName = [string]$vacancyCapability.providerProfile
  if ($providerName -and $parsedLlm.providers.$providerName.endpoint) { $llmEndpoint = [string]$parsedLlm.providers.$providerName.endpoint }
}
Ensure-RuntimeSetting "LLM_RELEASE_VERSION" $llmRelease
Ensure-RuntimeSetting "ROUTERAI_ENDPOINT" $llmEndpoint
Ensure-RuntimeSetting "ROUTERAI_MODEL" $llmModel
Ensure-RuntimeSetting "INTERNAL_APP_ORIGIN" "http://127.0.0.1:3000"

Write-Output "Unified local configuration is ready (values were not printed)."
