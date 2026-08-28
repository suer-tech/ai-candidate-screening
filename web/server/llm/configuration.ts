import {
  PROMPT_ARTIFACTS,
  RESPONSE_SCHEMA_ARTIFACTS,
  SAFE_EXECUTION_DEFAULTS,
  TOOL_SCHEMA_ARTIFACTS,
  type PromptArtifact,
  type SchemaArtifact,
} from "./artifacts.ts";
import { cloneJson, deepFreeze, type JsonValue } from "./value-utils.ts";
import { assertStrictResponseSchema } from "./strict-schema.ts";

export const LLM_CAPABILITIES = [
  "vacancy_generation",
  "ocr",
  "speaker_mapping",
  "fact_extraction",
  "assessment",
  "validation_repair",
  "agent_tool_subcall",
  "matrix_compiler",
  "matrix_critic",
  "matrix_repair",
  "criterion_claim_extraction",
  "unmapped_signal_discovery",
  "unmapped_risk_assessment",
  "critical_risk_verification",
  "evidence_consolidation",
  "global_conflict_detection",
  "matrix_row_evaluation",
  "abc_matrix_assessment",
  "critical_row_verification",
  "invalid_row_repair",
  "candidate_report_composer",
] as const;

export type LogicalLlmCapability = (typeof LLM_CAPABILITIES)[number];

export interface RuntimeSecretSource {
  has(secretReference: string): boolean;
  read(secretReference: string): string | undefined;
}

export interface ProviderProfileDocument {
  provider: string;
  endpoint: string;
  secretReference: string;
  apiContractVersion: string;
  supportsStructuredOutputs?: boolean;
}

export interface RetryPolicyDocument {
  maxAttempts: number;
  initialBackoffMs: number;
  maximumBackoffMs: number;
}

export type FallbackPolicyDocument =
  | { mode: "disabled" }
  | {
      mode: "explicit";
      policyVersion: string;
      alternatives: Array<{ providerProfile: string; model: string }>;
    };

export interface CapabilityConfigDocument {
  providerProfile: string;
  model: string;
  promptArtifact: string;
  responseSchemaArtifact: string;
  toolSchemaArtifacts: string[];
  generationParameters: JsonValue;
  limits: JsonValue;
  timeoutMs: number;
  retryPolicy: RetryPolicyDocument;
  fallbackPolicy: FallbackPolicyDocument;
}

export interface RuntimeConfigDocument {
  releaseVersion: string;
  providers: Record<string, ProviderProfileDocument>;
  capabilities: Partial<Record<LogicalLlmCapability, CapabilityConfigDocument>>;
}

export interface NonSecretProviderSnapshot {
  id: string;
  provider: string;
  endpoint: string;
  apiContractVersion: string;
  supportsStructuredOutputs: boolean;
}

export interface EffectiveCapabilityConfig {
  releaseVersion: string;
  capability: LogicalLlmCapability;
  providerProfile: string;
  provider: string;
  endpoint: string;
  apiContractVersion: string;
  requestedModel: string;
  actualModel: string;
  prompt: PromptArtifact;
  responseSchema: SchemaArtifact;
  toolSchemas: SchemaArtifact[];
  defaultsArtifact: {
    id: string;
    version: string;
    hash: string;
  };
  generationParameters: JsonValue;
  limits: JsonValue;
  timeoutMs: number;
  retryPolicy: RetryPolicyDocument;
  fallback: { used: false } | { used: true; policyVersion: string; alternativeIndex: number };
}

export interface RuntimeConfiguration {
  readonly releaseVersion: string;
  readonly nonSecretSnapshot: Readonly<JsonValue>;
  resolve(
    capability: LogicalLlmCapability,
    selection?: { explicitFallbackIndex: number },
  ): Readonly<EffectiveCapabilityConfig>;
  readProviderCredential(providerProfile: string): string;
}

export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

const capabilitySet = new Set<string>(LLM_CAPABILITIES);
const sensitiveQueryKeys = new Set([
  "access_token",
  "api_key",
  "apikey",
  "authorization",
  "client_secret",
  "key",
  "password",
  "signature",
  "token",
]);

function requiredText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RuntimeConfigurationError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RuntimeConfigurationError(`${path} must be a non-negative integer`);
  }
  return value as number;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) {
    throw new RuntimeConfigurationError(`${path} must be greater than zero`);
  }
  return parsed;
}

function validatedJsonValue(value: unknown, path: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RuntimeConfigurationError(`${path} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => validatedJsonValue(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = validatedJsonValue(item, `${path}.${key}`);
    }
    return result;
  }
  throw new RuntimeConfigurationError(`${path} must be valid JSON`);
}

function safeEndpoint(value: unknown, path: string): string {
  const raw = requiredText(value, path);
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new RuntimeConfigurationError(`${path} must be an absolute URL`);
  }
  if (endpoint.protocol !== "https:") {
    throw new RuntimeConfigurationError(`${path} must use HTTPS`);
  }
  if (endpoint.username || endpoint.password) {
    throw new RuntimeConfigurationError(`${path} must not contain credentials`);
  }
  for (const key of endpoint.searchParams.keys()) {
    if (sensitiveQueryKeys.has(key.toLowerCase())) {
      throw new RuntimeConfigurationError(`${path} must not contain secret query parameters`);
    }
  }
  return endpoint.toString();
}

function artifact<T>(catalog: Record<string, T>, id: unknown, path: string): T {
  const key = requiredText(id, path);
  const result = catalog[key];
  if (!result) {
    throw new RuntimeConfigurationError(`${path} references an unknown versioned artifact`);
  }
  return result;
}

function validateRetryPolicy(value: RetryPolicyDocument, path: string): RetryPolicyDocument {
  if (!value || typeof value !== "object") {
    throw new RuntimeConfigurationError(`${path} is required`);
  }
  const policy = {
    maxAttempts: positiveInteger(value.maxAttempts, `${path}.maxAttempts`),
    initialBackoffMs: nonNegativeInteger(value.initialBackoffMs, `${path}.initialBackoffMs`),
    maximumBackoffMs: nonNegativeInteger(value.maximumBackoffMs, `${path}.maximumBackoffMs`),
  };
  if (policy.maximumBackoffMs < policy.initialBackoffMs) {
    throw new RuntimeConfigurationError(
      `${path}.maximumBackoffMs must be greater than or equal to initialBackoffMs`,
    );
  }
  return policy;
}

function validateFallbackPolicy(
  value: FallbackPolicyDocument,
  providers: Record<string, NonSecretProviderSnapshot>,
  path: string,
): FallbackPolicyDocument {
  if (!value || typeof value !== "object" || !Reflect.has(value, "mode")) {
    throw new RuntimeConfigurationError(
      `${path} is required; fallback must be explicitly disabled or configured`,
    );
  }
  if (value.mode === "disabled") {
    return { mode: "disabled" };
  }
  if (value.mode !== "explicit") {
    throw new RuntimeConfigurationError(`${path}.mode is invalid`);
  }
  const policyVersion = requiredText(value.policyVersion, `${path}.policyVersion`);
  if (!Array.isArray(value.alternatives) || value.alternatives.length === 0) {
    throw new RuntimeConfigurationError(`${path}.alternatives must not be empty`);
  }
  const alternatives = value.alternatives.map((alternative, index) => {
    const providerProfile = requiredText(
      alternative.providerProfile,
      `${path}.alternatives[${index}].providerProfile`,
    );
    if (!providers[providerProfile]) {
      throw new RuntimeConfigurationError(
        `${path}.alternatives[${index}].providerProfile is unknown`,
      );
    }
    return {
      providerProfile,
      model: requiredText(alternative.model, `${path}.alternatives[${index}].model`),
    };
  });
  return { mode: "explicit", policyVersion, alternatives };
}

export function validateRuntimeConfiguration(
  document: RuntimeConfigDocument,
  secrets: RuntimeSecretSource,
  options: { requiredCapabilities: readonly LogicalLlmCapability[] },
): RuntimeConfiguration {
  if (!document || typeof document !== "object") {
    throw new RuntimeConfigurationError("runtime configuration document is required");
  }
  const releaseVersion = requiredText(document.releaseVersion, "releaseVersion");
  if (!document.providers || typeof document.providers !== "object") {
    throw new RuntimeConfigurationError("providers are required");
  }

  const providers: Record<string, NonSecretProviderSnapshot> = {};
  const secretReferences = new Map<string, string>();
  for (const [id, source] of Object.entries(document.providers)) {
    const providerId = requiredText(id, "providers key");
    const secretReference = requiredText(source.secretReference, `providers.${id}.secretReference`);
    if (!secrets.has(secretReference)) {
      throw new RuntimeConfigurationError(`provider ${providerId} is missing its runtime credential`);
    }
    providers[providerId] = {
      id: providerId,
      provider: requiredText(source.provider, `providers.${id}.provider`),
      endpoint: safeEndpoint(source.endpoint, `providers.${id}.endpoint`),
      apiContractVersion: requiredText(
        source.apiContractVersion,
        `providers.${id}.apiContractVersion`,
      ),
      supportsStructuredOutputs: source.supportsStructuredOutputs === true,
    };
    if (source.supportsStructuredOutputs !== true) {
      throw new RuntimeConfigurationError(
        `providers.${id}.supportsStructuredOutputs must be true for Structured Outputs`,
      );
    }
    secretReferences.set(providerId, secretReference);
  }

  if (!document.capabilities || typeof document.capabilities !== "object") {
    throw new RuntimeConfigurationError("capabilities are required");
  }
  for (const capability of Object.keys(document.capabilities)) {
    if (!capabilitySet.has(capability)) {
      throw new RuntimeConfigurationError(`unknown LLM capability: ${capability}`);
    }
  }
  const requiredCapabilities = [...new Set(options.requiredCapabilities)];
  if (requiredCapabilities.length === 0) {
    throw new RuntimeConfigurationError("at least one required capability must be declared");
  }

  const capabilityDocuments = new Map<LogicalLlmCapability, CapabilityConfigDocument>();
  for (const capability of requiredCapabilities) {
    const source = document.capabilities[capability];
    if (!source) {
      throw new RuntimeConfigurationError(`capabilities.${capability} is required`);
    }
    const providerProfile = requiredText(
      source.providerProfile,
      `capabilities.${capability}.providerProfile`,
    );
    if (!providers[providerProfile]) {
      throw new RuntimeConfigurationError(
        `capabilities.${capability}.providerProfile is unknown`,
      );
    }
    artifact(PROMPT_ARTIFACTS, source.promptArtifact, `capabilities.${capability}.promptArtifact`);
    const responseSchema = artifact(
      RESPONSE_SCHEMA_ARTIFACTS,
      source.responseSchemaArtifact,
      `capabilities.${capability}.responseSchemaArtifact`,
    );
    try {
      assertStrictResponseSchema(responseSchema);
    } catch (error) {
      throw new RuntimeConfigurationError(
        error instanceof Error
          ? error.message
          : `response schema ${source.responseSchemaArtifact} is not strict-compatible`,
      );
    }
    if (!Array.isArray(source.toolSchemaArtifacts)) {
      throw new RuntimeConfigurationError(
        `capabilities.${capability}.toolSchemaArtifacts must be an array`,
      );
    }
    for (const [index, toolId] of source.toolSchemaArtifacts.entries()) {
      artifact(
        TOOL_SCHEMA_ARTIFACTS,
        toolId,
        `capabilities.${capability}.toolSchemaArtifacts[${index}]`,
      );
    }
    const validated: CapabilityConfigDocument = {
      providerProfile,
      model: requiredText(source.model, `capabilities.${capability}.model`),
      promptArtifact: source.promptArtifact,
      responseSchemaArtifact: source.responseSchemaArtifact,
      toolSchemaArtifacts: [...source.toolSchemaArtifacts],
      generationParameters: validatedJsonValue(
        source.generationParameters,
        `capabilities.${capability}.generationParameters`,
      ),
      limits: validatedJsonValue(source.limits, `capabilities.${capability}.limits`),
      timeoutMs: positiveInteger(source.timeoutMs, `capabilities.${capability}.timeoutMs`),
      retryPolicy: validateRetryPolicy(
        source.retryPolicy,
        `capabilities.${capability}.retryPolicy`,
      ),
      fallbackPolicy: validateFallbackPolicy(
        source.fallbackPolicy,
        providers,
        `capabilities.${capability}.fallbackPolicy`,
      ),
    };
    if (["matrix_compiler", "matrix_critic", "matrix_repair"].includes(capability) && validated.timeoutMs > 600_000) {
      throw new RuntimeConfigurationError(`capabilities.${capability}.timeoutMs exceeds the ten-minute ceiling`);
    }
    if (capability.startsWith("matrix_") || ["criterion_claim_extraction", "unmapped_signal_discovery", "unmapped_risk_assessment", "critical_risk_verification", "evidence_consolidation", "global_conflict_detection", "abc_matrix_assessment", "critical_row_verification", "invalid_row_repair"].includes(capability)) {
      const limits = validated.limits as Record<string, JsonValue>;
      if (!limits || typeof limits !== "object" || Array.isArray(limits) || !Number.isInteger(limits.maxOutputTokens) || Number(limits.maxOutputTokens) <= 0) {
        throw new RuntimeConfigurationError(`capabilities.${capability}.limits.maxOutputTokens must be a positive integer`);
      }
    }
    capabilityDocuments.set(capability, validated);
  }

  const nonSecretSnapshot = deepFreeze(
    cloneJson(
      {
        releaseVersion,
        providers,
        capabilities: Object.fromEntries(capabilityDocuments),
      } as unknown as JsonValue,
    ),
  );

  return {
    releaseVersion,
    nonSecretSnapshot,
    resolve(capability, selection) {
      const source = capabilityDocuments.get(capability);
      if (!source) {
        throw new RuntimeConfigurationError(`capability ${capability} is not ready`);
      }
      let providerProfile = source.providerProfile;
      let actualModel = source.model;
      let fallback: EffectiveCapabilityConfig["fallback"] = { used: false };
      if (selection) {
        if (source.fallbackPolicy.mode !== "explicit") {
          throw new RuntimeConfigurationError(`capability ${capability} has no explicit fallback`);
        }
        const alternative = source.fallbackPolicy.alternatives[selection.explicitFallbackIndex];
        if (!alternative) {
          throw new RuntimeConfigurationError(`fallback alternative is out of range`);
        }
        providerProfile = alternative.providerProfile;
        actualModel = alternative.model;
        fallback = {
          used: true,
          policyVersion: source.fallbackPolicy.policyVersion,
          alternativeIndex: selection.explicitFallbackIndex,
        };
      }
      const provider = providers[providerProfile];
      return deepFreeze({
        releaseVersion,
        capability,
        providerProfile,
        provider: provider.provider,
        endpoint: provider.endpoint,
        apiContractVersion: provider.apiContractVersion,
        requestedModel: source.model,
        actualModel,
        prompt: artifact(PROMPT_ARTIFACTS, source.promptArtifact, "promptArtifact"),
        responseSchema: artifact(
          RESPONSE_SCHEMA_ARTIFACTS,
          source.responseSchemaArtifact,
          "responseSchemaArtifact",
        ),
        toolSchemas: source.toolSchemaArtifacts.map((id) =>
          artifact(TOOL_SCHEMA_ARTIFACTS, id, "toolSchemaArtifact"),
        ),
        defaultsArtifact: {
          id: SAFE_EXECUTION_DEFAULTS.id,
          version: SAFE_EXECUTION_DEFAULTS.version,
          hash: SAFE_EXECUTION_DEFAULTS.hash,
        },
        generationParameters: cloneJson(source.generationParameters),
        limits: cloneJson(source.limits),
        timeoutMs: source.timeoutMs,
        retryPolicy: { ...source.retryPolicy },
        fallback,
      });
    },
    readProviderCredential(providerProfile) {
      const secretReference = secretReferences.get(providerProfile);
      if (!secretReference) {
        throw new RuntimeConfigurationError("provider profile is not configured");
      }
      const credential = secrets.read(secretReference);
      if (!credential) {
        throw new RuntimeConfigurationError("provider runtime credential is unavailable");
      }
      return credential;
    },
  };
}
