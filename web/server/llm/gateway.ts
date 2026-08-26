import type { EffectiveCapabilityConfig, LogicalLlmCapability, RuntimeConfiguration } from "./configuration.ts";
import type { SchemaArtifact } from "./artifacts.ts";
import {
  writeProtectedTraceFailOpen,
  type AdminOnlyProtectedTraceStore,
  type MetadataOnlyIncidentSink,
  type TraceWriteResult,
} from "./protected-store.ts";
import {
  createProtectedLlmTrace,
  type MaterialSnapshot,
  type ToolExchangeEvent,
  type TraceCorrelation,
} from "./tracing.ts";
import type { JsonValue } from "./value-utils.ts";

export interface ProviderAttemptRequest {
  endpoint: string;
  credential: string;
  model: string;
  apiContractVersion: string;
  messages: JsonValue[];
  contentBlocks?: JsonValue[];
  toolDefinitions: JsonValue[];
  toolChoice?: JsonValue;
  responseFormat: JsonValue;
  generationParameters: JsonValue;
  limits: JsonValue;
  timeoutMs: number;
}

export interface ProviderAttemptResult {
  providerRequestId?: string;
  reportedModel?: string;
  providerStatus?: string | number;
  rawEnvelope: JsonValue;
  assistantMessages: JsonValue[];
  finishReason?: string;
  usage?: JsonValue;
  parsedOutput?: JsonValue;
  normalizedOutput?: JsonValue;
  validationMigrationChain?: JsonValue[];
  actualSchemaVersion?: string;
  toolEvents: ToolExchangeEvent[];
}

export interface LlmProviderAdapter {
  execute(request: Readonly<ProviderAttemptRequest>): Promise<ProviderAttemptResult>;
}

export class LlmProviderAttemptError extends Error {
  readonly traceError: JsonValue;
  readonly providerStatus?: string | number;
  readonly retryable?: boolean;
  readonly retryBackoffMs?: number;

  constructor(
    message: string,
    traceError: JsonValue,
    providerStatus?: string | number,
    retryable?: boolean,
    retryBackoffMs?: number,
  ) {
    super(message);
    this.name = "LlmProviderAttemptError";
    this.traceError = traceError;
    this.providerStatus = providerStatus;
    this.retryable = retryable;
    this.retryBackoffMs = retryBackoffMs;
  }
}

export interface ExecuteLlmAttemptInput {
  capability: LogicalLlmCapability;
  responseSchema?: SchemaArtifact;
  correlation: TraceCorrelation;
  request: {
    messages: JsonValue[];
    contentBlocks?: JsonValue[];
    toolDefinitions: JsonValue[];
    toolChoice?: JsonValue;
  };
  inputSnapshot: { materials: MaterialSnapshot[]; context: JsonValue };
  explicitFallbackIndex?: number;
}

function jsonSchemaPrimitiveType(value: JsonValue | undefined): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return typeof value;
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? "integer" : "number";
  return undefined;
}

function normalizeStrictSchemaTypes(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizeStrictSchemaTypes);
  if (!value || typeof value !== "object") return value;
  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "uniqueItems")
      .map(([key, child]) => [key, normalizeStrictSchemaTypes(child)]),
  ) as Record<string, JsonValue>;
  if (normalized.type === undefined) {
    let inferred = Object.hasOwn(normalized, "const") ? jsonSchemaPrimitiveType(normalized.const) : undefined;
    if (!inferred && Array.isArray(normalized.enum) && normalized.enum.length > 0) {
      const types = [...new Set(normalized.enum.map(jsonSchemaPrimitiveType))];
      if (types.length === 1) inferred = types[0];
    }
    if (inferred) normalized.type = inferred;
  }
  return normalized;
}

export function structuredResponseFormat(artifact: Pick<SchemaArtifact, "id" | "version" | "schema">): JsonValue {
  const rawName = `${artifact.id}_${artifact.version}`.replace(/[^A-Za-z0-9_-]+/g, "_");
  const name = (rawName || "structured_response").slice(0, 64);
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema: normalizeStrictSchemaTypes(structuredClone(artifact.schema) as JsonValue),
    },
  };
}

export interface ExecuteLlmAttemptDependencies {
  configuration: RuntimeConfiguration;
  adapter: LlmProviderAdapter;
  protectedStore: Pick<AdminOnlyProtectedTraceStore, "write">;
  incidents: MetadataOnlyIncidentSink;
  clock?: () => Date;
  monotonicClock?: () => number;
}

export type ExecuteLlmAttemptResult = {
  response: ProviderAttemptResult;
  trace: TraceWriteResult;
};

export async function executeLlmAttempt(
  dependencies: ExecuteLlmAttemptDependencies,
  input: ExecuteLlmAttemptInput,
): Promise<ExecuteLlmAttemptResult> {
  const clock = dependencies.clock ?? (() => new Date());
  const monotonic = dependencies.monotonicClock ?? (() => performance.now());
  const resolvedConfig = dependencies.configuration.resolve(
    input.capability,
    input.explicitFallbackIndex === undefined ? undefined : { explicitFallbackIndex: input.explicitFallbackIndex },
  );
  const config: Readonly<EffectiveCapabilityConfig> = input.responseSchema
    ? Object.freeze({ ...resolvedConfig, responseSchema: input.responseSchema })
    : resolvedConfig;
  const responseFormat = structuredResponseFormat(config.responseSchema);
  const tracedRequest = {
    messages: structuredClone(input.request.messages),
    contentBlocks: input.request.contentBlocks ? structuredClone(input.request.contentBlocks) : undefined,
    toolDefinitions: structuredClone(input.request.toolDefinitions),
    toolChoice: input.request.toolChoice === undefined ? undefined : structuredClone(input.request.toolChoice),
    responseFormat: structuredClone(responseFormat),
  };
  const startedAt = clock().toISOString();
  const startedTick = monotonic();

  try {
    const response = await dependencies.adapter.execute(Object.freeze({
      endpoint: config.endpoint,
      credential: dependencies.configuration.readProviderCredential(config.providerProfile),
      model: config.actualModel,
      apiContractVersion: config.apiContractVersion,
      messages: structuredClone(input.request.messages),
      contentBlocks: input.request.contentBlocks ? structuredClone(input.request.contentBlocks) : undefined,
      toolDefinitions: structuredClone(input.request.toolDefinitions),
      toolChoice: input.request.toolChoice === undefined ? undefined : structuredClone(input.request.toolChoice),
      responseFormat: structuredClone(responseFormat),
      generationParameters: structuredClone(config.generationParameters),
      limits: structuredClone(config.limits),
      timeoutMs: config.timeoutMs,
    }));
    const endedAt = clock().toISOString();
    const trace = createProtectedLlmTrace({
      correlation: { ...input.correlation, providerRequestId: response.providerRequestId },
      capability: input.capability,
      config,
      request: tracedRequest,
      inputSnapshot: input.inputSnapshot,
      toolEvents: response.toolEvents,
      response: {
        rawEnvelope: response.rawEnvelope,
        assistantMessages: response.assistantMessages,
        finishReason: response.finishReason,
        usage: response.usage,
        parsedOutput: response.parsedOutput,
        normalizedOutput: response.normalizedOutput,
        validationMigrationChain: response.validationMigrationChain,
        reportedModel: response.reportedModel,
        actualSchemaVersion: response.actualSchemaVersion,
      },
      execution: {
        startedAt,
        endedAt,
        monotonicDurationMs: Math.max(0, monotonic() - startedTick),
        outcome: "succeeded",
        providerStatus: response.providerStatus,
      },
    });
    const traceWrite = await writeProtectedTraceFailOpen(dependencies.protectedStore, dependencies.incidents, trace, clock);
    return { response, trace: traceWrite };
  } catch (error) {
    const endedAt = clock().toISOString();
    const providerError = error instanceof LlmProviderAttemptError ? error : null;
    const trace = createProtectedLlmTrace({
      correlation: input.correlation,
      capability: input.capability,
      config,
      request: tracedRequest,
      inputSnapshot: input.inputSnapshot,
      toolEvents: [],
      execution: {
        startedAt,
        endedAt,
        monotonicDurationMs: Math.max(0, monotonic() - startedTick),
        outcome: "failed",
        providerStatus: providerError?.providerStatus,
        error: providerError?.traceError ?? { class: "provider_call_failed" },
        retryable: providerError?.retryable,
        retryBackoffMs: providerError?.retryBackoffMs,
      },
    });
    await writeProtectedTraceFailOpen(dependencies.protectedStore, dependencies.incidents, trace, clock);
    throw error;
  }
}
