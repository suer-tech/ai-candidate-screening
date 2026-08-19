import type { LogicalLlmCapability, RuntimeConfiguration } from "./configuration.ts";
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
  const config = dependencies.configuration.resolve(
    input.capability,
    input.explicitFallbackIndex === undefined ? undefined : { explicitFallbackIndex: input.explicitFallbackIndex },
  );
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
      generationParameters: structuredClone(config.generationParameters),
      limits: structuredClone(config.limits),
      timeoutMs: config.timeoutMs,
    }));
    const endedAt = clock().toISOString();
    const trace = createProtectedLlmTrace({
      correlation: { ...input.correlation, providerRequestId: response.providerRequestId },
      capability: input.capability,
      config,
      request: input.request,
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
      request: input.request,
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
