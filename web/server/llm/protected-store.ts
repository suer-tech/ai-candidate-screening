import type { LogicalLlmCapability } from "./configuration.ts";
import {
  hasExactProtectedTraceRetention,
  type ProtectedLlmTrace,
} from "./tracing.ts";

export interface ProtectedTracePersistence {
  put(trace: Readonly<ProtectedLlmTrace>): Promise<void>;
  findById(traceId: string): Promise<Readonly<ProtectedLlmTrace> | null>;
  deleteExpired(expiryInclusive: string): Promise<number>;
}

export interface ProtectedTraceAccess {
  role: "technical-administrator" | "hr";
  principalId: string;
}

export class ProtectedTraceAccessError extends Error {
  constructor() {
    super("protected trace access denied");
    this.name = "ProtectedTraceAccessError";
  }
}

export class AdminOnlyProtectedTraceStore {
  private readonly persistence: ProtectedTracePersistence;
  private readonly clock: () => Date;

  constructor(
    persistence: ProtectedTracePersistence,
    clock: () => Date = () => new Date(),
  ) {
    this.persistence = persistence;
    this.clock = clock;
  }

  async write(trace: Readonly<ProtectedLlmTrace>): Promise<void> {
    if (!hasExactProtectedTraceRetention(trace)) {
      throw new Error("protected trace must use the exact 30-day retention window");
    }
    await this.persistence.put(trace);
  }

  async read(traceId: string, access: ProtectedTraceAccess): Promise<Readonly<ProtectedLlmTrace> | null> {
    if (access.role !== "technical-administrator") {
      throw new ProtectedTraceAccessError();
    }
    const now = this.clock().toISOString();
    await this.persistence.deleteExpired(now);
    const trace = await this.persistence.findById(traceId);
    if (trace && trace.expiresAt <= now) {
      return null;
    }
    return trace;
  }

  async purgeExpired(): Promise<number> {
    return this.persistence.deleteExpired(this.clock().toISOString());
  }
}

export class InMemoryProtectedTracePersistence implements ProtectedTracePersistence {
  readonly records = new Map<string, Readonly<ProtectedLlmTrace>>();

  async put(trace: Readonly<ProtectedLlmTrace>): Promise<void> {
    this.records.set(trace.correlation.traceId, trace);
  }

  async findById(traceId: string): Promise<Readonly<ProtectedLlmTrace> | null> {
    return this.records.get(traceId) ?? null;
  }

  async deleteExpired(expiryInclusive: string): Promise<number> {
    let deleted = 0;
    for (const [id, trace] of this.records) {
      if (trace.expiresAt <= expiryInclusive) {
        this.records.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

export interface IncompleteTraceIncident {
  type: "protected_llm_trace_incomplete";
  incompleteTracing: true;
  traceId: string;
  callId: string;
  attemptId: string;
  workflowRunId: string;
  capability: LogicalLlmCapability;
  occurredAt: string;
  failureClass: "protected_trace_write_failed";
}

export interface MetadataOnlyIncidentSink {
  record(incident: Readonly<IncompleteTraceIncident>): Promise<void> | void;
}

export interface TraceWriteResult {
  persisted: boolean;
  incidentRecorded: boolean;
}

export async function writeProtectedTraceFailOpen(
  store: Pick<AdminOnlyProtectedTraceStore, "write">,
  incidents: MetadataOnlyIncidentSink,
  trace: Readonly<ProtectedLlmTrace>,
  clock: () => Date = () => new Date(),
): Promise<TraceWriteResult> {
  try {
    await store.write(trace);
    return { persisted: true, incidentRecorded: false };
  } catch {
    const incident: IncompleteTraceIncident = {
      type: "protected_llm_trace_incomplete",
      incompleteTracing: true,
      traceId: trace.correlation.traceId,
      callId: trace.correlation.callId,
      attemptId: trace.correlation.attemptId,
      workflowRunId: trace.correlation.workflowRunId,
      capability: trace.capability,
      occurredAt: clock().toISOString(),
      failureClass: "protected_trace_write_failed",
    };
    try {
      await incidents.record(Object.freeze(incident));
      return { persisted: false, incidentRecorded: true };
    } catch {
      // Observability must not turn a trace-store outage into a workflow outage.
      return { persisted: false, incidentRecorded: false };
    }
  }
}
