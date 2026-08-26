import type { PostgresBlobStore } from "../storage/blob-store.ts";
import type { ProtectedTracePersistence } from "./protected-store.ts";
import type { ProtectedLlmTrace } from "./tracing.ts";

const SCOPE = "protected-llm-traces";
export class PostgresProtectedTracePersistence implements ProtectedTracePersistence {
  private readonly blobs: PostgresBlobStore;
  constructor(blobs: PostgresBlobStore) { this.blobs = blobs; }
  async put(trace: Readonly<ProtectedLlmTrace>) { await this.blobs.put({ id: `trace:${trace.correlation.traceId}`, scope: SCOPE, kind: "protected-llm-trace", mimeType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(trace)), retentionUntilUtc: trace.expiresAt, protected: true }); }
  async findById(traceId: string) { const value = await this.blobs.get(`trace:${traceId}`, SCOPE); return value ? JSON.parse(new TextDecoder().decode(value.bytes)) as ProtectedLlmTrace : null; }
  async deleteExpired(expiryInclusive: string) { return this.blobs.deleteExpired("protected-llm-trace", expiryInclusive); }
}
