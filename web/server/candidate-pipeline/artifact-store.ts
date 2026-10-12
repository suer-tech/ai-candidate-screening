import { isDeepStrictEqual } from "node:util";
import { BlobStoreError, PostgresBlobStore, type BlobDescriptor } from "../storage/blob-store.ts";

const PREFIX = "pgblob://";
type ArtifactWrite = { candidatePk: number; runId: string; kind: string; identity: string };

function fanoutPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BlobStoreError("BLOB_IDENTITY_CONFLICT");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["descriptor", "groupId", "created"].includes(key))
    || !record.descriptor || typeof record.descriptor !== "object" || Array.isArray(record.descriptor)
    || typeof record.groupId !== "string" || !record.groupId
    || (Object.hasOwn(record, "created") && typeof record.created !== "boolean")) throw new BlobStoreError("BLOB_IDENTITY_CONFLICT");
  return { descriptor: record.descriptor, groupId: record.groupId };
}

function artifactAddress(input: ArtifactWrite) {
  return { scope: `candidate:${input.candidatePk}:run:${input.runId}`, id: `candidate:${input.candidatePk}:${input.runId}:${input.kind}:${input.identity}` };
}
function reference(stored: BlobDescriptor) {
  return { artifactRef: `${PREFIX}${encodeURIComponent(stored.id)}?scope=${encodeURIComponent(stored.scope)}`, checksum: stored.checksum, byteSize: stored.byteSize };
}

export class PostgresCandidateArtifactStore {
  private readonly blobs: PostgresBlobStore;
  constructor(blobs: PostgresBlobStore) { this.blobs = blobs; }
  async putJson(input: ArtifactWrite & { value: unknown }) {
    if (input.kind !== "fanout-descriptor") return this.put({ ...input, bytes: new TextEncoder().encode(JSON.stringify(input.value)), contentType: "application/json" });
    // Creation status belongs to an attempt, not to the immutable fan-out plan.
    const bytes = new TextEncoder().encode(JSON.stringify(fanoutPayload(input.value)));
    const expected = JSON.parse(new TextDecoder().decode(bytes));
    const { id, scope } = artifactAddress(input);
    const reuse = async () => {
      const existing = await this.blobs.get(id, scope);
      if (!existing) return null;
      if (existing.descriptor.kind !== "domain-artifact" || existing.descriptor.mimeType !== "application/json" || existing.descriptor.protected) throw new BlobStoreError("BLOB_IDENTITY_CONFLICT");
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder().decode(existing.bytes)); }
      catch { throw new BlobStoreError("BLOB_IDENTITY_CONFLICT"); }
      if (!isDeepStrictEqual(fanoutPayload(payload), expected)) throw new BlobStoreError("BLOB_IDENTITY_CONFLICT");
      return reference(existing.descriptor);
    };
    const existing = await reuse();
    if (existing) return existing;
    try { return await this.put({ ...input, bytes, contentType: "application/json" }); }
    catch (error) {
      if (!(error instanceof BlobStoreError) || error.safeCode !== "BLOB_IDENTITY_CONFLICT") throw error;
      // A concurrent legacy writer may have committed after the initial read.
      const winner = await reuse();
      if (!winner) throw error;
      return winner;
    }
  }
  async putBytes(input: { candidatePk: number; runId: string; kind: string; identity: string; bytes: Uint8Array; contentType: string }) { return this.put(input); }
  async getJson<T>(artifactRef: string) { return JSON.parse(new TextDecoder().decode(await this.getBytes(artifactRef))) as T; }
  async getBytes(artifactRef: string) { const { id, scope } = this.parseRef(artifactRef); const value = await this.blobs.get(id, scope); if (!value) throw new Error("CANDIDATE_ARTIFACT_NOT_FOUND"); return value.bytes; }
  private async put(input: { candidatePk: number; runId: string; kind: string; identity: string; bytes: Uint8Array; contentType: string }) {
    const { scope, id } = artifactAddress(input);
    const storageKind = input.kind === "transcript-audio" ? "transcript-audio" : "domain-artifact";
    const stored = await this.blobs.put({ id, scope, kind: storageKind, mimeType: input.contentType, bytes: input.bytes });
    return reference(stored);
  }
  private parseRef(value: string) { if (!value.startsWith(PREFIX)) throw new Error("CANDIDATE_ARTIFACT_REF_INVALID"); const body = value.slice(PREFIX.length); const separator = body.indexOf("?scope="); if (separator < 1) throw new Error("CANDIDATE_ARTIFACT_REF_INVALID"); return { id: decodeURIComponent(body.slice(0, separator)), scope: decodeURIComponent(body.slice(separator + 7)) }; }
}
