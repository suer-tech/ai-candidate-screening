import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createPostgresClient } from "../storage/postgres.ts";
import { migratePostgres } from "../storage/migrations.ts";
import { domainArtifactReferences, latestDomainArtifactReference } from "./production-runtime.ts";

process.env.ROUTERAI_STRUCTURED_OUTPUTS = "true";

test("production artifact lookup compiles against the current PostgreSQL schema", { skip: !process.env.MATRIX_TEST_POSTGRES_URL }, async () => {
  const database = createPostgresClient({ url: process.env.MATRIX_TEST_POSTGRES_URL!, max: 1 });
  try {
    await migratePostgres(database, path.resolve(import.meta.dirname, "../../drizzle-postgres"));
    assert.equal(await latestDomainArtifactReference(database, "synthetic-absent-run", "synthetic-provenance"), undefined);
    assert.deepEqual(await domainArtifactReferences(database, "synthetic-absent-run", "synthetic-provenance"), []);
  } finally {
    await database.end({ timeout: 3 });
  }
});
