import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export const LOCAL_RUNTIME_ENV = ".runtime/runtime.env";
export const LOCAL_CREDENTIAL_DIRECTORY = ".runtime/credentials";
export const RELEASE_EVIDENCE_FILE = "release-evidence.json";

export const CREDENTIAL_ALLOWLIST = Object.freeze([
  "database-url",
  "google-oauth-client-secret",
  "google-oauth-keyring.json",
  "routerai-api-key",
  "assemblyai-api-key",
  "telegram-bot-token",
  "telegram-recipients.json",
  "internal-service-tokens.json",
] as const);

export type CredentialName = (typeof CREDENTIAL_ALLOWLIST)[number];

const RUNTIME_KEYS = new Set([
  "APP_ORIGIN", "INTERNAL_APP_ORIGIN", "HOST", "PORT", "NODE_ENV", "AUTH_MODE", "LOCAL_AUTH_USER_ID", "LOCAL_AUTH_USER_EMAIL", "LOCAL_AUTH_USER_FULL_NAME",
  "DATABASE_MAX_CONNECTIONS", "DATABASE_IDLE_TIMEOUT_SECONDS", "DATABASE_CONNECT_TIMEOUT_SECONDS",
  "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_REDIRECT_URI", "GOOGLE_OAUTH_DEPLOYMENT_MODE",
  "ROUTERAI_ENDPOINT", "ROUTERAI_MODEL", "ROUTERAI_STRUCTURED_OUTPUTS", "ROUTERAI_CONTEXT_WINDOW_TOKENS", "MATRIX_BATCH_SAFETY_TOKENS", "LLM_RELEASE_VERSION",
  "AGENT_RUNTIME_ENVIRONMENT", "AGENT_RUNTIME_WORKER_ID", "AGENT_RUNTIME_POLLING_MS", "AGENT_RUNTIME_HEARTBEAT_MS", "AGENT_RUNTIME_LEASE_MS",
  "CANDIDATE_TOOL_EXECUTION_MODE", "CANDIDATE_PIPELINE_ROUTING", "CANDIDATE_PIPELINE_BUILD_ID",
  "MEDIA_PROCESSOR_URL", "MEDIA_PROCESSOR_HOST", "MEDIA_PROCESSOR_PORT", "MEDIA_PROCESSOR_MAX_INPUT_BYTES",
  "DOCUMENT_PROCESSOR_URL", "DOCUMENT_PROCESSOR_HOST", "DOCUMENT_PROCESSOR_PORT", "DOCUMENT_PROCESSOR_MAX_INPUT_BYTES",
  "E2E_ENVIRONMENT", "E2E_FIXTURE_SET_ID", "E2E_ALLOW_DESTRUCTIVE_CLEANUP", "FIXTURE_CONTROLLER_PORT", "FIXTURE_CONTROLLER_STATE_PATH",
]);

const INLINE_SECRET_KEY = /(?:SECRET|TOKEN|PASSWORD|API_KEY|KEYRING|RECIPIENT|DATABASE_URL|CONFIG_JSON)$/;
const LEGACY_KEYS = new Set([
  "GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHARED_DRIVE_ID", "GOOGLE_SHARED_DRIVE_ROOT_FOLDER_ID",
  "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID", "R2_BUCKET",
]);

export class RuntimeConfigurationError extends Error {
  readonly safeCode: string;
  constructor(safeCode: string) {
    super(safeCode);
    this.safeCode = safeCode;
    this.name = "RuntimeConfigurationError";
  }
}

export interface RuntimeConfiguration {
  values: Readonly<Record<string, string>>;
  credentials: Readonly<Record<CredentialName, string>>;
  root: string;
  releaseEvidence?: string;
  readiness: { runtimeEnv: true; credentialDirectory: true; credentialFiles: number; secretsExposed: 0 };
}

export function parseReleaseEvidence(source: string): string {
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) throw new RuntimeConfigurationError("RELEASE_EVIDENCE_TOO_LARGE");
  let value: Record<string, unknown>;
  try { value = JSON.parse(source) as Record<string, unknown>; }
  catch { throw new RuntimeConfigurationError("RELEASE_EVIDENCE_JSON_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.buildId !== "string" || typeof value.configurationFingerprint !== "string"
    || value.pairRecoveryGreen !== true || value.outboxRecoveryGreen !== true || value.hardBudgetsVerified !== true) {
    throw new RuntimeConfigurationError("RELEASE_EVIDENCE_INCOMPLETE");
  }
  if (Object.keys(value).some((key) => /(?:secret|token|password|recipient|personal|pii)/i.test(key))) {
    throw new RuntimeConfigurationError("RELEASE_EVIDENCE_UNSAFE_FIELD");
  }
  return JSON.stringify(value);
}

export function parseRuntimeEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new RuntimeConfigurationError("RUNTIME_ENV_LINE_INVALID");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key in values) throw new RuntimeConfigurationError("RUNTIME_ENV_DUPLICATE_KEY");
    if (LEGACY_KEYS.has(key)) throw new RuntimeConfigurationError("LEGACY_RUNTIME_SETTING_REJECTED");
    if (INLINE_SECRET_KEY.test(key)) throw new RuntimeConfigurationError("INLINE_SECRET_REJECTED");
    if (!RUNTIME_KEYS.has(key)) throw new RuntimeConfigurationError("RUNTIME_ENV_UNKNOWN_KEY");
    values[key] = value;
  }
  return values;
}

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function credentialNamesAreExact(names: readonly string[]): boolean {
  return JSON.stringify([...names].sort()) === JSON.stringify([...CREDENTIAL_ALLOWLIST].sort());
}

export function credentialPathIsSafe(parent: string, child: string): boolean {
  return inside(path.resolve(parent), path.resolve(child));
}

const DOCKER_OVERRIDE_KEYS = new Set<string>([...RUNTIME_KEYS, "DATABASE_URL"]);

function processEnvOverrides(): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const key of DOCKER_OVERRIDE_KEYS) {
    const value = process.env[key];
    if (value !== undefined && value.trim() !== "") overrides[key] = value.trim();
  }
  return overrides;
}

export function validateProcessorEndpoints(values: Readonly<Record<string, string>>): void {
  const definitions = [
    { prefix: "MEDIA_PROCESSOR", route: "/v1/extract-audio" },
    { prefix: "DOCUMENT_PROCESSOR", route: "/v1/extract-document" },
  ] as const;
  for (const definition of definitions) {
    const rawUrl = values[`${definition.prefix}_URL`];
    const host = values[`${definition.prefix}_HOST`];
    const rawPort = values[`${definition.prefix}_PORT`];
    if (!rawUrl || !host || !rawPort) throw new RuntimeConfigurationError(`${definition.prefix}_ENDPOINT_INCOMPLETE`);
    let endpoint: URL;
    try { endpoint = new URL(rawUrl); }
    catch { throw new RuntimeConfigurationError(`${definition.prefix}_URL_INVALID`); }
    const port = Number(rawPort);
    const endpointPort = Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RuntimeConfigurationError(`${definition.prefix}_PORT_INVALID`);
    const normalizedHost = endpoint.hostname === "localhost" ? "127.0.0.1" : endpoint.hostname;
    const configuredHost = host === "localhost" ? "127.0.0.1" : host;
    if (endpoint.protocol !== "http:" || normalizedHost !== configuredHost || endpointPort !== port || endpoint.pathname !== definition.route) {
      throw new RuntimeConfigurationError(`${definition.prefix}_ENDPOINT_MISMATCH`);
    }
  }
}

export async function loadRuntimeConfiguration(webRoot = process.cwd()): Promise<RuntimeConfiguration> {
  const explicitRoot = process.env.HH_RUNTIME_CONFIG_ROOT?.trim();
  const configurationRoot = explicitRoot ? path.resolve(explicitRoot) : path.resolve(webRoot, ".runtime");
  const runtimeFile = explicitRoot ? path.resolve(configurationRoot, "runtime.env") : path.resolve(webRoot, LOCAL_RUNTIME_ENV);
  const credentialDirectory = explicitRoot ? path.resolve(configurationRoot, "credentials") : path.resolve(webRoot, LOCAL_CREDENTIAL_DIRECTORY);
  const releaseEvidenceFile = path.resolve(configurationRoot, RELEASE_EVIDENCE_FILE);
  const [runtimeRoot, credentialRoot] = await Promise.all([realpath(configurationRoot), realpath(credentialDirectory)]);
  if (!inside(runtimeRoot, credentialRoot)) throw new RuntimeConfigurationError("CREDENTIAL_DIRECTORY_ESCAPE_REJECTED");
  const runtimeStat = await lstat(runtimeFile);
  if (runtimeStat.isSymbolicLink() || !runtimeStat.isFile()) throw new RuntimeConfigurationError("RUNTIME_ENV_UNSAFE_FILE");
  const values = parseRuntimeEnv(await readFile(runtimeFile, "utf8"));
  const names = (await readdir(credentialDirectory)).sort();
  if (!credentialNamesAreExact(names)) throw new RuntimeConfigurationError("CREDENTIAL_ALLOWLIST_MISMATCH");
  const credentials = {} as Record<CredentialName, string>;
  for (const name of CREDENTIAL_ALLOWLIST) {
    const target = path.resolve(credentialDirectory, name);
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new RuntimeConfigurationError("CREDENTIAL_FILE_UNSAFE");
    const resolved = await realpath(target);
    if (!inside(credentialRoot, resolved)) throw new RuntimeConfigurationError("CREDENTIAL_PATH_ESCAPE_REJECTED");
    const value = (await readFile(resolved, "utf8")).trim();
    if (!value) throw new RuntimeConfigurationError("CREDENTIAL_FILE_EMPTY");
    credentials[name] = value;
  }
  let releaseEvidence: string | undefined;
  try {
    const evidenceStat = await lstat(releaseEvidenceFile);
    if (evidenceStat.isSymbolicLink() || !evidenceStat.isFile()) throw new RuntimeConfigurationError("RELEASE_EVIDENCE_UNSAFE_FILE");
    releaseEvidence = parseReleaseEvidence(await readFile(releaseEvidenceFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return Object.freeze({
    values: Object.freeze(values), credentials: Object.freeze(credentials), root: runtimeRoot, releaseEvidence,
    readiness: Object.freeze({ runtimeEnv: true as const, credentialDirectory: true as const, credentialFiles: CREDENTIAL_ALLOWLIST.length, secretsExposed: 0 as const }),
  });
}

export function environmentProjection(configuration: RuntimeConfiguration): Record<string, string> {
  const overrides = processEnvOverrides();
  const values = { ...configuration.values, ...overrides };
  validateProcessorEndpoints(values);
  const tokens = JSON.parse(configuration.credentials["internal-service-tokens.json"]) as Record<string, string>;
  const appOrigin = values.APP_ORIGIN;
  if (!appOrigin) throw new RuntimeConfigurationError("APP_ORIGIN_MISSING");
  const internalAppOrigin = values.INTERNAL_APP_ORIGIN || appOrigin;
  const endpoint = values.ROUTERAI_ENDPOINT || "https://routerai.ru/api/v1/chat/completions";
  const model = values.ROUTERAI_MODEL;
  if (!model) throw new RuntimeConfigurationError("ROUTERAI_MODEL_MISSING");
  if (values.ROUTERAI_STRUCTURED_OUTPUTS !== "true") throw new RuntimeConfigurationError("ROUTERAI_STRUCTURED_OUTPUTS_SUPPORT_REQUIRED");
  const contextWindowTokens = Number(values.ROUTERAI_CONTEXT_WINDOW_TOKENS || 128_000);
  const matrixBatchSafetyTokens = Number(values.MATRIX_BATCH_SAFETY_TOKENS || 4_096);
  if (!Number.isInteger(contextWindowTokens) || contextWindowTokens < 1) throw new RuntimeConfigurationError("ROUTERAI_CONTEXT_WINDOW_TOKENS_INVALID");
  if (!Number.isInteger(matrixBatchSafetyTokens) || matrixBatchSafetyTokens < 1 || matrixBatchSafetyTokens >= contextWindowTokens) {
    throw new RuntimeConfigurationError("MATRIX_BATCH_SAFETY_TOKENS_INVALID");
  }
  const releaseVersion = values.LLM_RELEASE_VERSION || values.CANDIDATE_PIPELINE_BUILD_ID;
  const capability = (promptArtifact: string, responseSchemaArtifact: string, maxAttempts = 3) => ({
    providerProfile: "routerai", model, promptArtifact, responseSchemaArtifact, toolSchemaArtifacts: ["no-tools/v1"],
    generationParameters: { temperature: 0 }, limits: { maxInputBytes: 1_000_000, maxOutputTokens: 8192 }, timeoutMs: 120_000,
    retryPolicy: { maxAttempts, initialBackoffMs: maxAttempts === 1 ? 0 : 1000, maximumBackoffMs: maxAttempts === 1 ? 0 : 5000 },
    fallbackPolicy: { mode: "disabled" },
  });
  const llmConfiguration = {
    releaseVersion,
    providers: { routerai: { provider: "routerai-openai-compatible", endpoint, secretReference: "ROUTERAI_API_KEY", apiContractVersion: "openai-chat-completions/v1", supportsStructuredOutputs: values.ROUTERAI_STRUCTURED_OUTPUTS === "true" } },
    capabilities: {
      vacancy_generation: capability("vacancy-profile/v1", "vacancy-profile-response/v1", 1),
      ocr: capability("document-ocr/v1", "ocr-page/v1"),
      speaker_mapping: capability("speaker-mapping/v1", "speaker-map/v1"),
      matrix_compiler: { ...capability("compile-vacancy-matrix/v1", "vacancy-matrix-draft/v1", 1), timeoutMs: 600_000 },
      matrix_critic: { ...capability("critique-vacancy-matrix/v2", "vacancy-matrix-critic/v2", 1), timeoutMs: 600_000 },
      criterion_claim_extraction: { ...capability("extract-claims-for-criteria/v1", "candidate-claims/v1", 1), timeoutMs: 600_000 },
      unmapped_signal_discovery: { ...capability("discover-unmapped-signals/v1", "candidate-unmapped-signals/v1", 1), timeoutMs: 600_000 },
      evidence_consolidation: { ...capability("consolidate-evidence/v1", "candidate-evidence-consolidation/v1", 1), timeoutMs: 600_000 },
      global_conflict_detection: { ...capability("detect-global-conflicts/v1", "candidate-global-conflicts/v1", 1), timeoutMs: 600_000 },
      matrix_row_evaluation: { ...capability("fill-matrix-rows/v2", "candidate-matrix-rows/v2", 1), timeoutMs: 600_000 },
      abc_matrix_assessment: { ...capability("assess-abc-direction/v2", "candidate-abc-matrix/v1", 1), timeoutMs: 600_000 },
      critical_row_verification: { ...capability("verify-critical-row/v1", "candidate-row-verification/v1", 1), timeoutMs: 600_000 },
      candidate_report_composer: { ...capability("compose-candidate-report/v2", "candidate-report-composition/v2", 1), timeoutMs: 300_000 },
    },
  };
  const agentConfiguration = {
    version: values.CANDIDATE_PIPELINE_BUILD_ID || "unprovisioned",
    budgets: { wallTimeMs: 3_600_000, taskAttempts: 27, repairAttempts: 2, replans: 2, llmCalls: 18, tokens: 160_000, costMicrounits: 5_000_000, externalRequests: 200 },
    leaseMs: Number(values.AGENT_RUNTIME_LEASE_MS || 30_000),
    pollingMs: Number(values.AGENT_RUNTIME_POLLING_MS || 1_000),
    heartbeatMs: Number(values.AGENT_RUNTIME_HEARTBEAT_MS || 10_000),
    flags: { synthetic: false, shadow: false, acceptNewGoals: true,
      toolRouting: { "candidate-analysis-matrix/v1": "agent", "candidate-cleanup/v1": "agent" } },
  };
  return {
    ...values,
    ROUTERAI_CONTEXT_WINDOW_TOKENS: String(contextWindowTokens),
    MATRIX_BATCH_SAFETY_TOKENS: String(matrixBatchSafetyTokens),
    DATABASE_URL: overrides.DATABASE_URL ?? configuration.credentials["database-url"],
    GOOGLE_OAUTH_CLIENT_SECRET: configuration.credentials["google-oauth-client-secret"],
    GOOGLE_OAUTH_TOKEN_KEYRING_JSON: configuration.credentials["google-oauth-keyring.json"],
    ROUTERAI_API_KEY: configuration.credentials["routerai-api-key"],
    ASSEMBLYAI_API_KEY: configuration.credentials["assemblyai-api-key"],
    TELEGRAM_BOT_TOKEN: configuration.credentials["telegram-bot-token"],
    TELEGRAM_RECIPIENT_REFS_JSON: configuration.credentials["telegram-recipients.json"],
    AGENT_RUNTIME_ENDPOINT: new URL("/api/internal/agent-runtime", internalAppOrigin).toString(),
    CANDIDATE_TOOL_ENDPOINT: new URL("/api/internal/candidate-pipeline/tool", internalAppOrigin).toString(),
    ...(configuration.releaseEvidence ? { CANDIDATE_PIPELINE_RELEASE_EVIDENCE_JSON: configuration.releaseEvidence } : {}),
    AGENT_RUNTIME_CONFIG_JSON: JSON.stringify(agentConfiguration),
    LLM_RUNTIME_CONFIG_JSON: JSON.stringify(llmConfiguration),
    ...tokens,
  };
}
