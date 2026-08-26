import { PostgresBlobStore } from "../storage/blob-store.ts";

const PREFIX = "pgblob://";
export class PostgresCandidateArtifactStore {
  private readonly blobs: PostgresBlobStore;
  constructor(blobs: PostgresBlobStore) { this.blobs = blobs; }
  async putJson(input: { candidatePk: number; runId: string; kind: string; identity: string; value: unknown }) { return this.put({ ...input, bytes: new TextEncoder().encode(JSON.stringify(input.value)), contentType: "application/json" }); }
  async putBytes(input: { candidatePk: number; runId: string; kind: string; identity: string; bytes: Uint8Array; contentType: string }) { return this.put(input); }
  async getJson<T>(artifactRef: string) { return JSON.parse(new TextDecoder().decode(await this.getBytes(artifactRef))) as T; }
  async getBytes(artifactRef: string) { const { id, scope } = this.parseRef(artifactRef); const value = await this.blobs.get(id, scope); if (!value) throw new Error("CANDIDATE_ARTIFACT_NOT_FOUND"); return value.bytes; }
  private async put(input: { candidatePk: number; runId: string; kind: string; identity: string; bytes: Uint8Array; contentType: string }) {
    const scope = `candidate:${input.candidatePk}:run:${input.runId}`; const id = `candidate:${input.candidatePk}:${input.runId}:${input.kind}:${input.identity}`;
    const stored = await this.blobs.put({ id, scope, kind: "domain-artifact", mimeType: input.contentType, bytes: input.bytes });
    return { artifactRef: `${PREFIX}${encodeURIComponent(stored.id)}?scope=${encodeURIComponent(scope)}`, checksum: stored.checksum, byteSize: stored.byteSize };
  }
  private parseRef(value: string) { if (!value.startsWith(PREFIX)) throw new Error("CANDIDATE_ARTIFACT_REF_INVALID"); const body = value.slice(PREFIX.length); const separator = body.indexOf("?scope="); if (separator < 1) throw new Error("CANDIDATE_ARTIFACT_REF_INVALID"); return { id: decodeURIComponent(body.slice(0, separator)), scope: decodeURIComponent(body.slice(separator + 7)) }; }
}
