import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { PostgresCandidateArtifactStore } from "../server/candidate-pipeline/artifact-store.ts";
import { createFanoutDescriptor, fanoutGroupId } from "../server/agent-runtime/fanout.ts";
import { PostgresBlobStore } from "../server/storage/blob-store.ts";
import { migratePostgres } from "../server/storage/migrations.ts";
import { createPostgresClient, type PostgresClient } from "../server/storage/postgres.ts";

// Independently authored acceptance for the owner's rows-plan replay incident.
// WF-022 / WF-023 / OPS-003 idempotency and safe replay: a retry's transient `created` outcome
// must not change the artifact identity. This is real PostgreSQL acceptance,
// synthetic-only and fail closed: no runtime config or skipped database checks.
const SYNTHETIC_DATABASE_PREFIX = "hh_fanout_artifact_acceptance";
const candidatePk = 910_001;
type ArtifactInput = Parameters<PostgresCandidateArtifactStore["putJson"]>[0];
type BlobRow = {
  id: string; checksum: string; content: Buffer; created_at_utc: string;
  kind: string; mime_type: string; protected: boolean; byte_size: string | number;
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function fixture(runId: string, groupKey: string): ArtifactInput {
  const descriptor = createFanoutDescriptor({
    workflowVersion: "matrix-v4-rabbit-parallel", runId, planVersion: 1,
    groupKey, kind: "assessment-rows", inputFingerprint: "synthetic-input-v1",
    profileFingerprint: "synthetic-profile-v1", configFingerprint: "synthetic-config-v1",
    shards: [{ identity: `${groupKey}:0001`, toolKey: "candidate.row-shard/v1", payload: { criterionIds: ["synthetic-criterion-1"] } }],
  });
  return { candidatePk, runId, kind: "fanout-descriptor", identity: `synthetic-rows-plan:${groupKey}`,
    value: { descriptor, groupId: fanoutGroupId(descriptor) } };
}
function storageIdentity(input: ArtifactInput) {
  return { id: `candidate:${input.candidatePk}:${input.runId}:${input.kind}:${input.identity}`,
    scope: `candidate:${input.candidatePk}:run:${input.runId}` };
}
async function snapshot(database: PostgresClient, input: ArtifactInput): Promise<BlobRow> {
  const { id, scope } = storageIdentity(input);
  const rows = await database<BlobRow[]>`SELECT id,checksum,content,created_at_utc,kind,mime_type,protected,byte_size
    FROM artifact_blobs WHERE id=${id} AND scope=${scope}`;
  assert.equal(rows.length, 1, "one immutable blob must belong to this operation identity");
  return rows[0];
}
async function assertUnchanged(database: PostgresClient, input: ArtifactInput, expected: BlobRow) {
  const observed = await snapshot(database, input);
  assert.equal(observed.id, expected.id);
  assert.equal(observed.checksum, expected.checksum);
  assert.equal(observed.created_at_utc, expected.created_at_utc);
  assert.equal(observed.kind, expected.kind);
  assert.equal(observed.mime_type, expected.mime_type);
  assert.equal(observed.protected, expected.protected);
  assert.equal(observed.byte_size, expected.byte_size);
  assert.deepEqual(observed.content, expected.content, "replay must preserve the original stored bytes");
  const { scope } = storageIdentity(input);
  const [count] = await database<{ count: number }[]>`SELECT count(*)::integer AS count FROM artifact_blobs WHERE scope=${scope}`;
  assert.equal(count.count, 1, "replay must not create a second blob under another identity");
}

test("rows-plan artifact replay preserves immutable identity in real PostgreSQL 16", async (context) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "TEST_DATABASE_URL must point to an explicitly prepared isolated synthetic PostgreSQL 16 database");
  const configuredName = decodeURIComponent(new URL(url).pathname.slice(1));
  assert.ok(configuredName.startsWith(SYNTHETIC_DATABASE_PREFIX), "refuse migrations or writes outside the isolated synthetic database");
  const database = createPostgresClient({ url, max: 8, connectTimeoutSeconds: 5 });
  const runIds: string[] = [];
  try {
    const [environment] = await database<{ database: string; major: number }[]>`SELECT current_database() AS database,
      floor(current_setting('server_version_num')::numeric / 10000)::integer AS major`;
    assert.equal(environment.database, configuredName);
    assert.equal(environment.major, 16, "this acceptance must execute on PostgreSQL 16");
    await migratePostgres(database, path.resolve(import.meta.dirname, "../drizzle-postgres"));
    const blobs = new PostgresBlobStore(database);
    const store = new PostgresCandidateArtifactStore(blobs);
    const newFixture = (key: string) => {
      const runId = `synthetic-fanout-acceptance-${randomUUID()}`;
      runIds.push(runId);
      return fixture(runId, key);
    };

    await context.test("first materialization and replay reuse one immutable artifact despite created true/false", async () => {
      const input = newFixture("rows-sequential");
      const value = input.value as Record<string, unknown>;
      const first = await store.putJson({ ...input, value: { ...value, created: true } });
      const original = await snapshot(database, input);
      const replay = await store.putJson({ ...input, value: { ...value, created: false } });
      assert.deepEqual(replay, first, "a replay is the same successful immutable operation");
      await assertUnchanged(database, input, original);
    });

    await context.test("legacy descriptors stored with created true or false replay without migration or overwrite", async () => {
      for (const created of [true, false]) {
        const input = newFixture(`rows-legacy-${created}`);
        const oldValue = { ...(input.value as Record<string, unknown>), created };
        const legacy = await blobs.put({ ...storageIdentity(input), kind: "domain-artifact", mimeType: "application/json", bytes: encode(oldValue) });
        const original = await snapshot(database, input);
        const replay = await store.putJson(input);
        assert.equal(replay.checksum, legacy.checksum, "the already-published legacy checksum must remain valid");
        assert.equal(replay.byteSize, legacy.byteSize);
        assert.equal(replay.artifactRef, `pgblob://${encodeURIComponent(legacy.id)}?scope=${encodeURIComponent(legacy.scope)}`);
        assert.deepEqual(await store.getJson(replay.artifactRef), oldValue, "legacy stored bytes remain unchanged");
        await assertUnchanged(database, input, original);
      }
    });

    await context.test("concurrent first attempts and replays converge on a single artifact", async () => {
      const input = newFixture("rows-concurrent");
      const value = input.value as Record<string, unknown>;
      const results = await Promise.allSettled(Array.from({ length: 16 }, (_, index) => store.putJson({ ...input,
        value: index % 3 === 0 ? value : { ...value, created: index % 3 === 1 },
      })));
      for (const result of results) assert.equal(result.status, "fulfilled", "every identical concurrent materialization must be successful");
      const first = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof store.putJson>>>).value;
      for (const result of results) assert.deepEqual((result as PromiseFulfilledResult<typeof first>).value, first);
      await assertUnchanged(database, input, await snapshot(database, input));
    });

    await context.test("a corrected writer racing a legacy writer accepts the committed immutable winner", async () => {
      for (let iteration = 0; iteration < 4; iteration++) {
        const input = newFixture(`rows-mixed-writer-race-${iteration}`);
        const oldValue = { ...(input.value as Record<string, unknown>), created: iteration % 2 === 0 };
        const writeLegacy = () => blobs.put({ ...storageIdentity(input), kind: "domain-artifact", mimeType: "application/json", bytes: encode(oldValue) });
        const canonical = iteration % 2 === 0 ? store.putJson(input) : undefined;
        const legacy = writeLegacy();
        const corrected = canonical ?? store.putJson(input);
        const [legacyResult, correctedResult] = await Promise.allSettled([legacy, corrected]);
        assert.equal(correctedResult.status, "fulfilled", "the corrected writer must safely reconcile a compatible legacy winner");
        const stored = (correctedResult as PromiseFulfilledResult<Awaited<typeof corrected>>).value;
        if (legacyResult.status === "fulfilled") {
          assert.equal(stored.checksum, legacyResult.value.checksum);
          assert.deepEqual(await store.getJson(stored.artifactRef), oldValue);
        } else {
          assert.equal((legacyResult.reason as Error).message, "BLOB_IDENTITY_CONFLICT",
            "the raw writer must reject a canonical winner rather than overwrite it");
          assert.deepEqual(await store.getJson(stored.artifactRef), input.value);
        }
        assert.deepEqual(await store.putJson(input), stored);
        await assertUnchanged(database, input, await snapshot(database, input));
      }
    });

    await context.test("legacy insert committed after a corrected writer's initial read miss is reconciled without overwrite", async () => {
      const input = newFixture("rows-controlled-read-miss-race");
      let signalReadMiss!: () => void;
      let releaseRead!: () => void;
      const readMiss = new Promise<void>((resolve) => { signalReadMiss = resolve; });
      const readReleased = new Promise<void>((resolve) => { releaseRead = resolve; });
      let gated = false;
      class GatedBlobStore extends PostgresBlobStore {
        override async get(id: string, scope: string) {
          const observed = await super.get(id, scope);
          if (observed === null && !gated) {
            gated = true;
            signalReadMiss();
            await readReleased;
          }
          return observed;
        }
      }
      // Every read/write remains a real PostgreSQL operation. This barrier only
      // makes the otherwise probabilistic post-read insert window reproducible.
      const corrected = new PostgresCandidateArtifactStore(new GatedBlobStore(database)).putJson(input);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          readMiss,
          corrected.then(() => {
            assert.equal(gated, true, "the corrected writer must reach the initial missing-row read before insertion");
          }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("SYNTHETIC_READ_MISS_BARRIER_NOT_REACHED")), 5_000);
          }),
        ]);
        clearTimeout(timeout);
        const oldValue = { ...(input.value as Record<string, unknown>), created: true };
        const legacy = await blobs.put({ ...storageIdentity(input), kind: "domain-artifact", mimeType: "application/json", bytes: encode(oldValue) });
        const original = await snapshot(database, input);
        releaseRead();
        const replay = await corrected;
        assert.equal(replay.checksum, legacy.checksum);
        assert.equal(replay.byteSize, legacy.byteSize);
        assert.equal(replay.artifactRef, `pgblob://${encodeURIComponent(legacy.id)}?scope=${encodeURIComponent(legacy.scope)}`);
        assert.deepEqual(await store.getJson(replay.artifactRef), oldValue);
        await assertUnchanged(database, input, original);
      } finally {
        clearTimeout(timeout);
        releaseRead();
        await Promise.allSettled([corrected]);
      }
    });

    await context.test("genuinely changed descriptor or group identity is rejected as BLOB_IDENTITY_CONFLICT", async () => {
      for (const changedField of ["descriptor", "groupId"]) {
        const input = newFixture(`rows-conflict-${changedField}`);
        const first = await store.putJson(input);
        const original = await snapshot(database, input);
        const value = input.value as { descriptor: Record<string, unknown>; groupId: string };
        const changed = changedField === "descriptor"
          ? { ...value, descriptor: { ...value.descriptor, inputFingerprint: "genuinely-different-synthetic-input" } }
          : { ...value, groupId: "genuinely-different-group-id" };
        await assert.rejects(store.putJson({ ...input, value: changed }),
          (error: Error) => error.message === "BLOB_IDENTITY_CONFLICT", "changing immutable content must never silently reuse an earlier descriptor");
        assert.deepEqual(await store.putJson(input), first);
        await assertUnchanged(database, input, original);
      }
    });

    await context.test("ordinary artifact content changes still fail and preserve the original bytes", async () => {
      const input = { ...newFixture("ordinary-artifact"), kind: "transcript-bundle", value: { syntheticPayload: "original" } };
      const first = await store.putJson(input);
      const original = await snapshot(database, input);
      await assert.rejects(store.putJson({ ...input, value: { syntheticPayload: "changed" } }),
        "the fanout compatibility rule must not weaken immutability for ordinary artifacts");
      assert.deepEqual(await store.putJson(input), first);
      await assertUnchanged(database, input, original);
    });

    await context.test("fanout payload may not silently discard extra metadata or a nonboolean created field", async () => {
      for (const fields of [{ created: "true" }, { created: 0 }, { created: null }, { created: false, unexpected: "must-not-be-ignored" }]) {
        const input = newFixture(`rows-malformed-${runIds.length}`);
        await assert.rejects(store.putJson({ ...input, value: { ...(input.value as Record<string, unknown>), ...fields } }),
          "only the descriptor/groupId and a boolean legacy created outcome belong to the fanout contract");
        const { scope } = storageIdentity(input);
        const [count] = await database<{ count: number }[]>`SELECT count(*)::integer AS count FROM artifact_blobs WHERE scope=${scope}`;
        assert.equal(count.count, 0, "malformed incoming payload must not be persisted");
      }
    });

    await context.test("malformed legacy blobs cannot be reused by ignoring their extra or nonboolean metadata", async () => {
      for (const fields of [{ created: "false" }, { created: true, unexpected: "must-not-be-ignored" }]) {
        const input = newFixture(`rows-malformed-legacy-${runIds.length}`);
        const malformed = { ...(input.value as Record<string, unknown>), ...fields };
        await blobs.put({ ...storageIdentity(input), kind: "domain-artifact", mimeType: "application/json", bytes: encode(malformed) });
        const original = await snapshot(database, input);
        await assert.rejects(store.putJson(input), "legacy compatibility is limited to the documented boolean created field");
        await assertUnchanged(database, input, original);
      }
    });

    await context.test("corrupted legacy checksum fails closed and the stored bytes are not overwritten", async () => {
      const input = newFixture("rows-corrupted-checksum");
      const bytes = encode({ ...(input.value as Record<string, unknown>), created: true });
      const { id, scope } = storageIdentity(input);
      // Seed a syntactically valid storage row with a deliberately false digest.
      // The immutable-row trigger remains enabled; existing blobs are not edited.
      await database`INSERT INTO artifact_blobs (id,scope,kind,checksum,mime_type,byte_size,content,protected,created_at_utc)
        VALUES (${id},${scope},'domain-artifact',${"0".repeat(64)},'application/json',${bytes.byteLength},${Buffer.from(bytes)},false,${new Date().toISOString()})`;
      const original = await snapshot(database, input);
      await assert.rejects(store.putJson(input), (error: Error) => error.message === "BLOB_CHECKSUM_MISMATCH",
        "legacy compatibility must verify stored bytes against the persisted checksum before reuse");
      await assertUnchanged(database, input, original);
    });

    await context.test("legacy fanout reuse rejects protected, MIME or storage-kind metadata mismatches without overwrite", async () => {
      const mismatches = [
        { protected: true, mimeType: "application/json", kind: "domain-artifact" },
        { protected: false, mimeType: "text/plain", kind: "domain-artifact" },
        { protected: false, mimeType: "application/json", kind: "protected-llm-trace" },
      ];
      for (const [index, mismatch] of mismatches.entries()) {
        const input = newFixture(`rows-metadata-conflict-${index}`);
        const bytes = encode({ ...(input.value as Record<string, unknown>), created: false });
        await blobs.put({ ...storageIdentity(input), bytes, ...mismatch });
        const original = await snapshot(database, input);
        await assert.rejects(store.putJson(input), (error: Error) => error.message === "BLOB_IDENTITY_CONFLICT",
          "fanout compatibility must never bypass storage provenance or protected artifact boundaries");
        await assertUnchanged(database, input, original);
      }
    });
  } finally {
    // Remove only the scopes created by this invocation; the name guard above
    // excludes production databases and no candidate/provider data is loaded.
    for (const runId of runIds) {
      assert.ok(runId.startsWith("synthetic-fanout-acceptance-"));
      await database`DELETE FROM artifact_blobs WHERE scope=${`candidate:${candidatePk}:run:${runId}`}`;
    }
    await database.end({ timeout: 3 });
  }
});
