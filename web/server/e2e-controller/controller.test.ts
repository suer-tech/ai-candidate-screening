import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { environmentProjection, loadRuntimeConfiguration } from "../configuration/runtime.ts";
import { createPostgresClient } from "../storage/postgres.ts";
import { migratePostgres } from "../storage/migrations.ts";
import { FixtureController } from "./controller.ts";

test("local controller durably derives state and evidence from the PostgreSQL agent runtime", async () => {
  const configuration = await loadRuntimeConfiguration(path.resolve(import.meta.dirname, "../.."));
  const admin = createPostgresClient({ url: environmentProjection(configuration).DATABASE_URL, max: 1 });
  const database = `fixture_controller_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const isolatedUrl = new URL(environmentProjection(configuration).DATABASE_URL);
  isolatedUrl.pathname = `/${database}`;
  await admin.unsafe(`CREATE DATABASE ${database}`);
  const client = createPostgresClient({ url: isolatedUrl.toString(), max: 2 });
  try {
    await migratePostgres(client, path.resolve(import.meta.dirname, "../../drizzle-postgres"));
    const controller = new FixtureController(client, { token: "test-token", buildId: "build-1", environment: "local", fixtureSetId: "canonical-candidate-v1", allowDestructiveCleanup: true });
    const request = (urlPath: string, method = "GET", body?: unknown) => controller.handle(new Request(`http://127.0.0.1${urlPath}`, { method, headers: { authorization: "Bearer test-token", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }));
    const created = await (await request("/runs", "POST", { prefix: "local-run-123" })).json() as { runId: string; storage: string };
    assert.equal(created.storage, "postgresql-16");
    await request(`/runs/${created.runId}/vacancy`, "POST", { vacancyId: "vacancy-1" });
    const seeded = await (await request(`/runs/${created.runId}/candidates`, "POST")).json() as { candidateId: string; storage: string };
    assert.match(seeded.candidateId, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    assert.equal(seeded.storage, "postgresql-16");
    const state = await (await request(`/runs/${created.runId}`)).json() as { state: string; resultVersion: number };
    assert.ok(["READY", "FAILED", "PROCESSING"].includes(state.state));
    const evidence = await (await request(`/runs/${created.runId}/evidence/transcript`)).json() as { derivedFrom: string; storage: string; stages: Record<string, { status: string }> };
    assert.equal(evidence.derivedFrom, "durable-postgresql-agent-runtime");
    assert.equal(evidence.storage, "postgresql-16");
    assert.ok(["SUCCEEDED", "PENDING", "FAILED"].includes(evidence.stages["assemblyai-transcription"]?.status));
    const cleanup = await (await request(`/runs/${created.runId}/cleanup`, "POST")).json() as { complete: boolean };
    assert.equal(cleanup.complete, true);
  } finally {
    await client.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
});

test("controller rejects unauthenticated access and mismatched build preflight", async () => {
  const configuration = await loadRuntimeConfiguration(path.resolve(import.meta.dirname, "../.."));
  const admin = createPostgresClient({ url: environmentProjection(configuration).DATABASE_URL, max: 1 });
  const database = `fixture_controller_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const isolatedUrl = new URL(environmentProjection(configuration).DATABASE_URL);
  isolatedUrl.pathname = `/${database}`;
  await admin.unsafe(`CREATE DATABASE ${database}`);
  const client = createPostgresClient({ url: isolatedUrl.toString(), max: 1 });
  try {
    await migratePostgres(client, path.resolve(import.meta.dirname, "../../drizzle-postgres"));
    const controller = new FixtureController(client, { token: "test-token", buildId: "build-1", environment: "local", fixtureSetId: "canonical-candidate-v1", allowDestructiveCleanup: false });
    assert.equal((await controller.handle(new Request("http://127.0.0.1/health"))).status, 401);
    const response = await controller.handle(new Request("http://127.0.0.1/preflight", { method: "POST", headers: { authorization: "Bearer test-token" }, body: JSON.stringify({ buildId: "other" }) }));
    assert.equal(response.status, 409);
  } finally {
    await client.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
});
