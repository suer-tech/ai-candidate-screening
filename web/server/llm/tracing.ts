import type { EffectiveCapabilityConfig, LogicalLlmCapability } from "./configuration.ts";
import { cloneJson, deepFreeze, type JsonValue } from "./value-utils.ts";

export const PROTECTED_TRACE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface TraceCorrelation {
  traceId: string;
  callId: string;
  attemptId: string;
  attemptNumber: number;
  parentTraceId?: string;
  parentCallId?: string;
  workflowRunId: string;
  workflowStage: string;
  candidateId?: string;
  vacancyId?: string;
  inputVersion?: string;
  profileVersion?: string;
  resultVersion?: string;
  providerRequestId?: string;
}

export interface MaterialSnapshot {
  materialId: string;
  mediaType: string;
  fileName?: string;
  content: JsonValue;
  sourceMetadata?: JsonValue;
}

export interface ToolExchangeEvent {
  sequence: number;
  callId: string;
  name: string;
  arguments: JsonValue;
  result?: JsonValue;
  error?: JsonValue;
}

export interface AttemptTraceInput {
  correlation: TraceCorrelation;
  capability: LogicalLlmCapability;
  config: Readonly<EffectiveCapabilityConfig>;
  request: {
    messages: JsonValue[];
    contentBlocks?: JsonValue[];
    toolDefinitions: JsonValue[];
    toolChoice?: JsonValue;
    responseFormat?: JsonValue;
  };
  inputSnapshot: {
    materials: MaterialSnapshot[];
    context: JsonValue;
  };
  toolEvents: ToolExchangeEvent[];
  response?: {
    rawEnvelope: JsonValue;
    assistantMessages: JsonValue[];
    finishReason?: string;
    usage?: JsonValue;
    parsedOutput?: JsonValue;
    normalizedOutput?: JsonValue;
    validationMigrationChain?: JsonValue[];
    reportedModel?: string;
    actualSchemaVersion?: string;
  };
  execution: {
    startedAt: string;
    endedAt: string;
    monotonicDurationMs: number;
    outcome: "succeeded" | "failed";
    providerStatus?: string | number;
    error?: JsonValue;
    retryable?: boolean;
    retryBackoffMs?: number;
  };
  createdAt?: string;
}

export interface ProtectedLlmTrace {
  schemaVersion: 1;
  correlation: TraceCorrelation;
  capability: LogicalLlmCapability;
  exchange: {
    request: AttemptTraceInput["request"];
    toolEvents: ToolExchangeEvent[];
    response: AttemptTraceInput["response"] | null;
  };
  inputSnapshot: AttemptTraceInput["inputSnapshot"];
  effectiveConfig: EffectiveCapabilityConfig;
  execution: AttemptTraceInput["execution"];
  createdAt: string;
  expiresAt: string;
}

function requiredText(value: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function validInstant(value: string, path: string): number {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) {
    throw new Error(`${path} must be an ISO timestamp`);
  }
  return instant;
}

export function createProtectedLlmTrace(input: AttemptTraceInput): Readonly<ProtectedLlmTrace> {
  const createdAt = input.createdAt ?? input.execution.endedAt;
  const createdMs = validInstant(createdAt, "createdAt");
  const startedMs = validInstant(input.execution.startedAt, "execution.startedAt");
  const endedMs = validInstant(input.execution.endedAt, "execution.endedAt");
  if (endedMs < startedMs) {
    throw new Error("execution.endedAt must not precede execution.startedAt");
  }
  if (!Number.isFinite(input.execution.monotonicDurationMs) || input.execution.monotonicDurationMs < 0) {
    throw new Error("execution.monotonicDurationMs must be non-negative");
  }
  if (!Number.isInteger(input.correlation.attemptNumber) || input.correlation.attemptNumber < 1) {
    throw new Error("correlation.attemptNumber must be a positive integer");
  }
  for (const field of ["traceId", "callId", "attemptId", "workflowRunId", "workflowStage"] as const) {
    requiredText(input.correlation[field], `correlation.${field}`);
  }
  if (input.config.capability !== input.capability) {
    throw new Error("effective config capability must match trace capability");
  }
  const sequences = input.toolEvents.map((event) => event.sequence);
  if (sequences.some((sequence, index) => !Number.isInteger(sequence) || sequence !== index)) {
    throw new Error("tool events must have a zero-based contiguous sequence");
  }

  // Build from an explicit allowlist so transport headers and runtime credentials cannot enter the trace.
  const trace: ProtectedLlmTrace = {
    schemaVersion: 1,
    correlation: cloneJson(input.correlation as unknown as JsonValue) as unknown as TraceCorrelation,
    capability: input.capability,
    exchange: {
      request: cloneJson(input.request as unknown as JsonValue) as unknown as AttemptTraceInput["request"],
      toolEvents: cloneJson(input.toolEvents as unknown as JsonValue) as unknown as ToolExchangeEvent[],
      response: input.response
        ? (cloneJson(input.response as unknown as JsonValue) as unknown as NonNullable<AttemptTraceInput["response"]>)
        : null,
    },
    inputSnapshot: cloneJson(
      input.inputSnapshot as unknown as JsonValue,
    ) as unknown as AttemptTraceInput["inputSnapshot"],
    effectiveConfig: cloneJson(
      input.config as unknown as JsonValue,
    ) as unknown as EffectiveCapabilityConfig,
    execution: cloneJson(
      input.execution as unknown as JsonValue,
    ) as unknown as AttemptTraceInput["execution"],
    createdAt: new Date(createdMs).toISOString(),
    expiresAt: new Date(createdMs + PROTECTED_TRACE_RETENTION_MS).toISOString(),
  };
  return deepFreeze(trace);
}

export function hasExactProtectedTraceRetention(trace: ProtectedLlmTrace): boolean {
  return Date.parse(trace.expiresAt) - Date.parse(trace.createdAt) === PROTECTED_TRACE_RETENTION_MS;
}
