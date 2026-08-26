import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { environmentProjection, loadRuntimeConfiguration } from "../configuration/runtime.ts";
import { createPostgresClient } from "../storage/postgres.ts";
import { domainArtifactReferences, latestDomainArtifactReference } from "./production-runtime.ts";

process.env.ROUTERAI_STRUCTURED_OUTPUTS = "true";

test("production artifact lookup compiles against the current PostgreSQL schema", async () => {
  const configuration = await loadRuntimeConfiguration(path.resolve(import.meta.dirname, "../.."));
  const database = createPostgresClient({ url: environmentProjection(configuration).DATABASE_URL, max: 1 });
  try {
    assert.equal(await latestDomainArtifactReference(database, "synthetic-absent-run", "synthetic-provenance"), undefined);
    assert.deepEqual(await domainArtifactReferences(database, "synthetic-absent-run", "synthetic-provenance"), []);
  } finally {
    await database.end({ timeout: 3 });
  }
});
