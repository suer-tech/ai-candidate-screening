import assert from "node:assert/strict";
import test from "node:test";
import { PostgresCandidateArtifactStore } from "./artifact-store.ts";

test("candidate artifact store assigns the dedicated storage kind only to transcript audio", async () => {
  const writes: Array<{ kind: string; byteSize: number }> = [];
  const blobs = {
    put: async (input: { id: string; scope: string; kind: string; mimeType: string; bytes: Uint8Array }) => {
      writes.push({ kind: input.kind, byteSize: input.bytes.byteLength });
      return { id: input.id, scope: input.scope, kind: input.kind, checksum: "a".repeat(64), mimeType: input.mimeType,
        byteSize: input.bytes.byteLength, protected: false, createdAtUtc: "2026-09-21T00:00:00.000Z" };
    },
  };
  const store = new PostgresCandidateArtifactStore(blobs as never);

  await store.putBytes({ candidatePk: 1, runId: "run", kind: "transcript-audio", identity: "audio", bytes: new Uint8Array([1]), contentType: "audio/mp4" });
  await store.putJson({ candidatePk: 1, runId: "run", kind: "transcript-bundle", identity: "json", value: { ok: true } });

  assert.deepEqual(writes.map((write) => write.kind), ["transcript-audio", "domain-artifact"]);
});
