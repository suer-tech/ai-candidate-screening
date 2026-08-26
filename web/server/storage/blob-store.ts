import { createHash, randomUUID } from "node:crypto";
import type { PostgresClient } from "./postgres.ts";
import { withTransaction } from "./postgres.ts";

export const GLOBAL_BLOB_LIMIT = 32 * 1024 * 1024;
const KIND_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  "protected-llm-trace": 4 * 1024 * 1024,
  "domain-artifact": 8 * 1024 * 1024,
  "report-pdf": 16 * 1024 * 1024,
});

export class BlobStoreError extends Error {
  readonly safeCode: string;
  constructor(safeCode: string) { super(safeCode); this.safeCode = safeCode; this.name = "BlobStoreError"; }
}

export interface BlobWrite {
  id?: string; scope: string; kind: string; mimeType: string; bytes: Uint8Array;
  retentionUntilUtc?: string; protected?: boolean;
}

export interface BlobDescriptor {
  id: string; scope: string; kind: string; checksum: string; mimeType: string; byteSize: number;
  retentionUntilUtc?: string; protected: boolean; createdAtUtc: string;
}

function limitFor(kind: string) { return Math.min(KIND_LIMITS[kind] ?? GLOBAL_BLOB_LIMIT, GLOBAL_BLOB_LIMIT); }
function digest(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

export async function collectBoundedBytes(source: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > limit) throw new BlobStoreError("BLOB_SIZE_LIMIT_EXCEEDED");
    chunks.push(chunk);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export class PostgresBlobStore {
  private readonly sql: PostgresClient;
  constructor(sql: PostgresClient) { this.sql = sql; }

  async put(input: BlobWrite): Promise<BlobDescriptor> {
    if (!input.bytes.byteLength || input.bytes.byteLength > limitFor(input.kind)) throw new BlobStoreError("BLOB_SIZE_LIMIT_EXCEEDED");
    const id = input.id ?? randomUUID();
    const checksum = digest(input.bytes);
    const createdAtUtc = new Date().toISOString();
    return withTransaction(this.sql, async (transaction) => {
      await transaction`INSERT INTO artifact_blobs
        (id, scope, kind, checksum, mime_type, byte_size, content, retention_until_utc, protected, created_at_utc)
        VALUES (${id}, ${input.scope}, ${input.kind}, ${checksum}, ${input.mimeType}, ${input.bytes.byteLength}, ${Buffer.from(input.bytes)}, ${input.retentionUntilUtc ?? null}, ${input.protected ?? false}, ${createdAtUtc})
        ON CONFLICT (scope, checksum) DO NOTHING`;
      const [row] = await transaction<BlobDescriptor[]>`SELECT id, scope, kind, checksum, mime_type AS "mimeType", byte_size::integer AS "byteSize",
        retention_until_utc AS "retentionUntilUtc", protected, created_at_utc AS "createdAtUtc"
        FROM artifact_blobs WHERE scope=${input.scope} AND checksum=${checksum}`;
      if (!row || row.kind !== input.kind || row.mimeType !== input.mimeType || row.byteSize !== input.bytes.byteLength) throw new BlobStoreError("BLOB_IDENTITY_CONFLICT");
      return row;
    });
  }

  async get(id: string, scope: string): Promise<{ descriptor: BlobDescriptor; bytes: Uint8Array } | null> {
    const [row] = await this.sql<(BlobDescriptor & { content: Buffer })[]>`SELECT id, scope, kind, checksum, mime_type AS "mimeType", byte_size::integer AS "byteSize", content,
      retention_until_utc AS "retentionUntilUtc", protected, created_at_utc AS "createdAtUtc" FROM artifact_blobs WHERE id=${id} AND scope=${scope}`;
    if (!row) return null;
    const bytes = new Uint8Array(row.content);
    if (bytes.byteLength !== row.byteSize || digest(bytes) !== row.checksum) throw new BlobStoreError("BLOB_CHECKSUM_MISMATCH");
    const descriptor: BlobDescriptor = {
      id: row.id, scope: row.scope, kind: row.kind, checksum: row.checksum, mimeType: row.mimeType,
      byteSize: row.byteSize, retentionUntilUtc: row.retentionUntilUtc, protected: row.protected, createdAtUtc: row.createdAtUtc,
    };
    return { descriptor, bytes };
  }

  async deleteScope(scope: string, includeProtected = false): Promise<number> {
    const deleted = includeProtected
      ? await this.sql`DELETE FROM artifact_blobs WHERE scope=${scope} RETURNING id`
      : await this.sql`DELETE FROM artifact_blobs WHERE scope=${scope} AND protected=false RETURNING id`;
    return deleted.length;
  }

  async deleteExpired(kind: string, expiryInclusive: string): Promise<number> {
    const rows = await this.sql`DELETE FROM artifact_blobs WHERE kind=${kind} AND retention_until_utc IS NOT NULL AND retention_until_utc<=${expiryInclusive} RETURNING id`;
    return rows.length;
  }
}
