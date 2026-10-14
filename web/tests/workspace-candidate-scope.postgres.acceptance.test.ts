import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { PostgresProductRepository } from "../server/product/postgres-repository.ts";
import { ProductNotFoundError } from "../server/product/application.ts";
import { migratePostgres } from "../server/storage/migrations.ts";
import { createPostgresClient, probePostgres } from "../server/storage/postgres.ts";

// Independent real PostgreSQL application-boundary acceptance. Uses no runtime
// configuration/credentials, real candidate materials, providers or SQL doubles.
test("selected workspace projection is isolated by typed candidate identity in PostgreSQL 16", async (t) => {
  const url = process.env.WORKSPACE_SCOPE_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  assert.ok(url, "BLOCKED: WORKSPACE_SCOPE_TEST_DATABASE_URL or TEST_DATABASE_URL must identify a prepared isolated PostgreSQL test database");
  const parsed = new URL(url);
  assert.match(parsed.pathname, /^\/hh_workspace_scope_acceptance_[a-z0-9_]+$/);
  assert.equal(process.env.HH_WORKSPACE_SCOPE_ACCEPTANCE_CONSENT, "isolated-synthetic-only");
  const database = createPostgresClient({ url, max: 2, connectTimeoutSeconds: 5 });
  try {
    await probePostgres(database);
    await migratePostgres(database, path.resolve(import.meta.dirname, "../drizzle-postgres"));
    assert.equal(Number((await database`SELECT count(*) AS count FROM candidates`)[0].count), 0,
      "Test requires a fresh empty database and will not modify existing candidates");
    const vacancy = { id: "scope-synthetic-vacancy", title: "Синтетическая вакансия", active: true,
      archived: false, version: 1, profile: {}, abcDirections: [], templateVersion: "vacancy-profile/v1" };
    await database`INSERT INTO vacancies(id,normalized_title,record_json) VALUES (${vacancy.id},'synthetic-scope',${JSON.stringify(vacancy)})`;
    const base = { vacancyId: vacancy.id, vacancy: vacancy.title, archived: false, status: "ANALYZING", revision: 1,
      name: "Синтетический кандидат", initials: "СК", elapsedMinutes: 1, result: null };
    await database`INSERT INTO candidates(id,public_id,revision,record_json) VALUES
      (701,'synthetic-public-a',1,${JSON.stringify({ ...base, id: 701, name: "Числовой 701" })}),
      (702,'701',1,${JSON.stringify({ ...base, id: "701", name: "Строковый 701" })})`;
    const at = "2026-10-14T00:00:00.000Z";
    for (const candidateId of [701, 702]) {
      await database`INSERT INTO candidate_material_snapshots(id,candidate_id,fingerprint,complete,stable_comparisons,captured_at_utc)
        VALUES (${`scope-snapshot-${candidateId}`},${candidateId},${`synthetic-${candidateId}`},true,3,${at})`;
      await database`INSERT INTO candidate_input_versions(id,candidate_id,snapshot_id,sequence,manifest_json,state,created_at_utc)
        VALUES (${`scope-input-${candidateId}`},${candidateId},${`scope-snapshot-${candidateId}`},1,
          ${JSON.stringify({ entries: [{ fileId: `synthetic-file-${candidateId}`, name: `synthetic-${candidateId}.pdf`, role: "resume", supported: true }] })},'MATERIALS_READY',${at})`;
    }
    const repository = new PostgresProductRepository(database);
    const scoped = (candidateId: string | number) => repository.dashboardSource({ summaryOnly: false, candidateId } as
      Parameters<typeof repository.dashboardSource>[0] & { candidateId: string | number });

    await t.test("numeric primary ID selects exactly its candidate", async () => {
      const result = await scoped(701);
      assert.deepEqual(result.candidates.map((candidate) => candidate.id), [701]);
      assert.equal(result.candidates[0].name, "Числовой 701");
      assert.equal(result.vacancies[0].id, vacancy.id);
      assert.equal(result.candidates[0].materials?.[0]?.fileName, "synthetic-701.pdf", "Selected full projection retains its material metadata");
    });
    await t.test("numeric-looking string selects public ID, preserving its type", async () => {
      const result = await scoped("701");
      assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["701"]);
      assert.equal(result.candidates[0].name, "Строковый 701");
      assert.equal(result.candidates[0].materials?.[0]?.fileName, "synthetic-702.pdf", "Public ID resolves to its own internal candidate material scope");
    });
    await t.test("missing candidate returns no other candidate", async () => {
      assert.deepEqual((await scoped(999)).candidates, []);
      assert.deepEqual((await scoped(Number.MAX_SAFE_INTEGER)).candidates, [], "A valid absent safe-integer ID is not a PostgreSQL integer overflow");
      await assert.rejects(scoped("synthetic-missing"), ProductNotFoundError,
        "Missing public ID preserves the existing repository not-found error; HTTP maps it to 404");
    });
    await t.test("existing summary and unfiltered full workspace remain compatible", async () => {
      for (const summaryOnly of [false, true]) {
        const result = await repository.dashboardSource({ summaryOnly });
        assert.equal(result.candidates.length, 2);
        assert.equal(result.vacancies[0].id, vacancy.id);
      }
    });
    await t.test("selected read excludes an unrelated unusable product record at the database boundary", async () => {
      // JSON syntax remains valid for hh_validate_json_text; null is not a
      // candidate object and a broad product projection would dereference it.
      await database`INSERT INTO candidates(id,public_id,revision,record_json) VALUES (703,'synthetic-unrelated-invalid',1,'null')`;
      const result = await scoped(701);
      assert.deepEqual(result.candidates.map((candidate) => candidate.id), [701]);
      assert.equal(Number((await database`SELECT count(*) AS count FROM candidates WHERE id=703`)[0].count), 1,
        "Isolation is achieved without deleting or repairing unrelated data");
    });
    await t.test("selected full read does not project another candidate's unusable input manifest", async () => {
      // Valid JSON passes the same syntax trigger; a broad manifest projection
      // would access .entries on null instead of the selected candidate's data.
      await database`UPDATE candidate_input_versions SET manifest_json='null' WHERE id='scope-input-702'`;
      const result = await scoped(701);
      assert.deepEqual(result.candidates.map((candidate) => candidate.id), [701]);
      assert.equal(result.candidates[0].materials?.[0]?.fileName, "synthetic-701.pdf");
    });
  } finally {
    // Database lifecycle belongs to the isolated runner; no DROP or broad cleanup.
    await database.end({ timeout: 5 });
  }
});
