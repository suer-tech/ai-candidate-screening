import assert from "node:assert/strict";
import test from "node:test";
import { scenarios } from "./fixtures/canonical-production-executor/synthetic-runtime.mjs";
import { runProductionExecutorScenario, verifyOracle } from "./helpers/canonical-production-executor-harness.mjs";

const cases = [
  ["production entry receives PostgreSQL and personal OAuth runtime, enforces the exact grant, and derives the snapshot from the candidate folder", scenarios.routeRuntimeAndSnapshot],
  ["shadow routing executes every non-visible stage through production provider ports without Drive publication or Telegram", scenarios.shadowAllNonVisible],
  ["effectful routing requires matching release evidence and durable outbox, then publishes one idempotent report pair and Telegram event", scenarios.effectfulReleaseAndIdempotency],
  ["durable checkpoints survive restart, unknown effects reconcile before retry, and invalid_grant waits for a human", scenarios.restartReconcileAndInvalidGrant],
  ["large artifacts remain referenced through PostgreSQL blobs and no credential reaches results, evidence, or logs", scenarios.artifactAndCredentialBoundaries],
];

for (const [title, fixture] of cases) {
  test(`${fixture.scenarioId}: ${title}`, async () => {
    const actual = await runProductionExecutorScenario(structuredClone(fixture));
    const failures = verifyOracle(actual, fixture.oracle);
    assert.equal(failures.length, 0, `${failures.join("\n")}\nobserved=${JSON.stringify(actual)}`);
  });
}
