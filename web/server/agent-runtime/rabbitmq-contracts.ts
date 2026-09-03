import { createHash, randomUUID } from "node:crypto";

export const RABBIT_TASK_ENVELOPE_VERSION = "rabbit-task-envelope/v1" as const;

export const RABBIT_ROUTING_CLASSES = [
  "control", "documents", "media", "transcription", "llm", "reports", "drive", "notifications",
] as const;

export type RabbitRoutingClass = (typeof RABBIT_ROUTING_CLASSES)[number];

export type RabbitTaskEnvelope = {
  schemaVersion: typeof RABBIT_TASK_ENVELOPE_VERSION;
  taskId: string;
  runId: string;
  taskVersion: number;
  routingClass: RabbitRoutingClass;
  attemptHint: number;
  correlationId: string;
  traceId: string;
  createdAt: string;
};

export const RABBIT_TASK_ENVELOPE_FIELDS = Object.freeze([
  "schemaVersion", "taskId", "runId", "taskVersion", "routingClass", "attemptHint", "correlationId", "traceId", "createdAt",
] as const);

const explicitRoutes: Readonly<Record<string, RabbitRoutingClass>> = Object.freeze({
  "candidate.drive-snapshot/v1": "drive",
  "candidate.document-extraction/v1": "documents",
  "candidate.transcription/v1": "transcription",
  "candidate.matrix-compile/v1": "llm",
  "candidate.matrix-claims/v1": "llm",
  "candidate.matrix-evidence/v1": "llm",
  "candidate.matrix-claim-submit/v1": "llm",
  "candidate.matrix-conflict-submit/v1": "llm",
  "candidate.matrix-rows/v1": "llm",
  "candidate.matrix-verify/v1": "llm",
  "candidate.matrix-recommendation/v1": "llm",
  "candidate.matrix-profile-read/v1": "llm",
  "candidate.matrix-source-read/v1": "llm",
  "candidate.matrix-draft-submit/v1": "llm",
  "candidate.matrix-schema-validate/v1": "llm",
  "candidate.matrix-critic-result/v1": "llm",
  "candidate.matrix-repair-policy/v1": "llm",
  "candidate.matrix-interpretation-notes/v1": "llm",
  "candidate.matrix-persist/v1": "llm",
  "candidate.matrix-context-search/v1": "llm",
  "candidate.matrix-context-read/v1": "llm",
  "candidate.report/v1": "reports",
  "candidate.drive-publication/v1": "drive",
  "candidate.telegram/v1": "notifications",
  "candidate.fanout-documents/v1": "control",
  "candidate.document-shard/v1": "documents",
  "candidate.document-join/v1": "control",
  "candidate.fanout-transcripts/v1": "control",
  "candidate.transcript-shard/v1": "transcription",
  "candidate.transcript-normalize-shard/v1": "documents",
  "candidate.transcript-media-shard/v1": "media",
  "candidate.transcript-submit-shard/v1": "transcription",
  "candidate.transcript-collect-shard/v1": "transcription",
  "candidate.transcript-join/v1": "control",
  "candidate.fanout-evidence/v1": "control",
  "candidate.evidence-shard/v1": "llm",
  "candidate.evidence-join/v1": "control",
  "candidate.fanout-rows/v1": "control",
  "candidate.row-shard/v1": "llm",
  "candidate.rows-join/v1": "control",
  "candidate.fanout-abc/v1": "control",
  "candidate.abc-shard/v1": "llm",
  "candidate.abc-join/v1": "control",
  "candidate.assessment-join/v1": "llm",
  "candidate.fanout-critical/v1": "control",
  "candidate.critical-shard/v1": "llm",
  "candidate.critical-join/v1": "control",
  "candidate.validation/v1": "llm",
  "candidate.cleanup-block-triggers/v1": "control",
  "candidate.cleanup-runtime/v1": "control",
  "candidate.cleanup-provider/v1": "control",
  "candidate.cleanup-temp/v1": "control",
  "candidate.cleanup-reports/v1": "drive",
  "candidate.cleanup-domain/v1": "control",
  "candidate.cleanup-tombstone/v1": "control",
});

export const RABBIT_TASK_ROUTING_REGISTRY = explicitRoutes;

export function routingClassForTool(toolKey: string): RabbitRoutingClass {
  const explicit = explicitRoutes[toolKey];
  if (explicit) return explicit;
  throw new Error(`RABBIT_TASK_ROUTE_UNKNOWN:${toolKey}`);
}

export function assertToolRouting(toolKey: string, routingClass: string): asserts routingClass is RabbitRoutingClass {
  if (routingClassForTool(toolKey) !== routingClass) throw new Error("RABBIT_TASK_ROUTE_MISMATCH");
}

function boundedTechnicalId(value: unknown, field: string) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9:._-]+$/.test(value)) {
    throw new Error(`RABBIT_ENVELOPE_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

export function parseRabbitTaskEnvelope(value: unknown): RabbitTaskEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RABBIT_ENVELOPE_INVALID");
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record).sort();
  const expected = [...RABBIT_TASK_ENVELOPE_FIELDS].sort();
  if (JSON.stringify(fields) !== JSON.stringify(expected)) throw new Error("RABBIT_ENVELOPE_FIELDS_REJECTED");
  if (record.schemaVersion !== RABBIT_TASK_ENVELOPE_VERSION) throw new Error("RABBIT_ENVELOPE_VERSION_UNSUPPORTED");
  if (!RABBIT_ROUTING_CLASSES.includes(record.routingClass as RabbitRoutingClass)) throw new Error("RABBIT_ENVELOPE_ROUTING_INVALID");
  if (!Number.isInteger(record.taskVersion) || Number(record.taskVersion) < 1) throw new Error("RABBIT_ENVELOPE_TASK_VERSION_INVALID");
  if (!Number.isInteger(record.attemptHint) || Number(record.attemptHint) < 0) throw new Error("RABBIT_ENVELOPE_ATTEMPT_HINT_INVALID");
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) throw new Error("RABBIT_ENVELOPE_CREATED_AT_INVALID");
  return {
    schemaVersion: RABBIT_TASK_ENVELOPE_VERSION,
    taskId: boundedTechnicalId(record.taskId, "task_id"),
    runId: boundedTechnicalId(record.runId, "run_id"),
    taskVersion: Number(record.taskVersion),
    routingClass: record.routingClass as RabbitRoutingClass,
    attemptHint: Number(record.attemptHint),
    correlationId: boundedTechnicalId(record.correlationId, "correlation_id"),
    traceId: boundedTechnicalId(record.traceId, "trace_id"),
    createdAt: record.createdAt,
  };
}

export function createRabbitTaskEnvelope(input: {
  taskId: string; runId: string; taskVersion: number; routingClass: RabbitRoutingClass; attemptHint: number; createdAt?: string; correlationId?: string; traceId?: string;
}): RabbitTaskEnvelope {
  return parseRabbitTaskEnvelope({
    schemaVersion: RABBIT_TASK_ENVELOPE_VERSION,
    taskId: input.taskId,
    runId: input.runId,
    taskVersion: input.taskVersion,
    routingClass: input.routingClass,
    attemptHint: input.attemptHint,
    correlationId: input.correlationId ?? createHash("sha256").update(`${input.runId}:${input.taskId}`).digest("hex").slice(0, 32),
    traceId: input.traceId ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}
