import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { productionDiscoveryFixture } from "./fixtures/production-drive-discovery/synthetic-runtime.mjs";
import { equal, every, includes, runProductionDiscoveryScenario, verify } from "./helpers/production-drive-discovery-harness.mjs";

function accept(result, checks) {
  const failures = verify(result, [
    equal("evidence.synthetic", true),
    equal("evidence.containsRealPersonalData", false),
    equal("evidence.containsCredentials", false),
    equal("evidence.containsProviderTokens", false),
    ...checks,
  ]);
  assert.equal(failures.length, 0, failures.join("\n"));
}

test("PROD-DISC-001: local/VPS worker entry starts the production Drive discovery runtime", async () => {
  const [workerEntry, runtimeEntry] = await Promise.all([
    readFile(new URL("../server/agent-runtime/worker-cli.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-runtime-process.ts", import.meta.url), "utf8"),
  ]);
  assert.match(runtimeEntry, /worker-cli\.ts/, "local/VPS worker service resolves to the production worker entry");
  assert.match(workerEntry, /production-discovery/, "the production worker imports its Drive discovery runtime wiring");
  assert.match(workerEntry, /startProductionDriveDiscoveryWorker/, "the production worker starts Drive discovery alongside the queue consumer");
  assert.match(workerEntry, /await\s+consumer\.start\(\)/, "the canonical task consumer remains active");
});

test("PROD-DISC-002: 15-second loop survives Drive errors and enqueues a stable candidate goal durably", async () => {
  const result = await runProductionDiscoveryScenario(productionDiscoveryFixture);
  accept(result, [
    equal("status", "SUCCEEDED"),
    equal("loop.discoveryIntervalMs", 15_000),
    equal("loop.stabilityIntervalMs", 15_000),
    equal("loop.started", true),
    equal("loop.stoppedAfterDriveError", false),
    equal("loop.tickCount", 3),
    includes("loop.logEvents", ["drive-discovery.tick", "drive-discovery.success", "drive-discovery.error"]),
    equal("loop.error.safe", true),
    equal("loop.error.containsCredentials", false),
    equal("loop.error.containsProviderToken", false),
    every("loop.timeline", "an error tick is followed by another successful tick", (item, index, all) => item.outcome !== "ERROR" || all.slice(index + 1).some((later) => later.outcome === "SUCCESS")),
    equal("candidate.registeredDurably", true),
    equal("candidate.driveFolderId", productionDiscoveryFixture.candidateFolder.folderId),
    equal("candidate.duplicateRegistrations", 0),
    equal("stability.fullMinuteComparisons", 4),
    equal("stability.materialsReady", true),
    equal("inputVersion.immutable", true),
    equal("goal.createdDurably", true),
    equal("goal.automaticFirstRun", true),
    equal("goal.queued", true),
    equal("goal.candidateDriveFolderId", productionDiscoveryFixture.candidateFolder.folderId),
    equal("goal.profileVersion", productionDiscoveryFixture.vacancy.profileVersion),
    equal("goal.taskIds", productionDiscoveryFixture.canonicalTaskIds),
    every("goal.tasks", "every canonical task is durable and initially queueable", (item) => item.persisted === true && ["READY", "WAITING"].includes(item.state)),
  ]);
});
