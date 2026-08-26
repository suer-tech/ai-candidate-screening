import assert from "node:assert/strict";
import test from "node:test";
import { scenarios } from "./fixtures/agent-runtime/synthetic-conformance.mjs";
import { equal, includes, runConformanceScenario, satisfies, verify } from "./helpers/agent-runtime-conformance-harness.mjs";

function accept(result, checks) {
  const failures = verify(result, [
    equal("evidence.synthetic", true),
    equal("evidence.containsSecrets", false),
    equal("evidence.containsRealPersonalData", false),
    ...checks,
  ]);
  assert.equal(failures.length, 0, failures.join("\n"));
}

test("TST-110: controlled restart points resume checkpoints without duplicate expensive work", async () => {
  const result = await runConformanceScenario(scenarios.TST110);
  accept(result, [
    equal("status", "SUCCEEDED"),
    includes("restartPointsObserved", scenarios.TST110.restartPoints),
    satisfies("restartCases", "each isolated restart case must finish and create at most one remote job/expensive output", (value) => Array.isArray(value)
      && value.length === scenarios.TST110.restartPoints.length
      && value.every((item) => item.outcome === "SUCCEEDED"
        && item.providerCreateCalls === 1
        && item.transcriptionEffectiveExecutions === 1
        && item.duplicateArtifacts === 0
        && item.unknownOutcomeReconciledBeforeNewEffect === true)),
    satisfies("restartCases", "provider-job checkpoint recovery must poll the same saved remote job", (value) => Array.isArray(value)
      && value.some((item) => item.restartPoint === "after-provider-job-checkpoint"
        && item.savedRemoteJobId === item.polledRemoteJobId
        && item.uploadRepeated === false)),
    satisfies("timeline", "expected a readable event/plan timeline", (value) => Array.isArray(value) && value.length > 0),
  ]);
});

test("TST-111: concurrent delivery, lease reclaim and fencing yield one effective result", async () => {
  const result = await runConformanceScenario(scenarios.TST111);
  accept(result, [
    equal("status", "SUCCEEDED"),
    equal("claims.acceptedAcrossLeaseEpochs", 2),
    equal("claims.concurrentWinners", 1),
    equal("transitions.effectiveCompletions", 1),
    equal("provider.effectfulCalls", 1),
    equal("artifacts.identities", ["transcript-artifact-001"]),
    equal("leases.staleAcknowledgement.accepted", false),
    equal("leases.staleAcknowledgement.code", "STALE_LEASE_TOKEN"),
    equal("deliveries.duplicatesLinkedToExistingOutcome", true),
  ]);
});

test("TST-112: every budget and invalid grant is a durable pre-effect hard gate", async () => {
  const result = await runConformanceScenario(scenarios.TST112);
  const budgetKinds = ["taskAttempts", "repairAttempts", "replans", "llmCalls", "tokens", "costMicrounits", "wallTimeMs", "externalRequests"];
  const grantCases = ["absent", "expired", "wrong-scope", "wrong-side-effect"];
  accept(result, [
    equal("status", "SUCCEEDED"),
    includes("budgets.deniedKinds", budgetKinds),
    equal("budgets.deniedExternalSideEffects", 0),
    equal("budgets.usagePreservedAfterRestart", true),
    equal("budgets.exhaustedObstacle", "BUDGET_EXHAUSTED"),
    includes("grants.deniedCases", grantCases),
    equal("grants.deniedProviderCalls", 0),
    equal("grants.secretResolvedBeforeChecks", false),
    equal("audit.policyDenialsContainSecret", false),
  ]);
});

test("TST-113: eval PASS, bounded local repair and immutable replan remain distinct", async () => {
  const result = await runConformanceScenario(scenarios.TST113);
  accept(result, [
    equal("status", "WAITING_FOR_HUMAN"),
    includes("gates.decisions", ["PASS", "REPAIRABLE", "REPLAN_REQUIRED", "HUMAN_REQUIRED"]),
    equal("repair.tasksCreated", 1),
    equal("repair.reEvaluations", 1),
    equal("repair.expensiveArtifactsReused", ["transcript-artifact-001"]),
    equal("tasks.transcription.effectiveExecutions", 1),
    equal("replan.planVersions", [1, 2]),
    equal("replan.previousPlanImmutable", true),
    equal("replan.mappingRecorded", true),
    equal("loopGuard.repeatedFingerprintBlocked", true),
    satisfies("budgets.repairAttempts.used", "repair usage must stay within the configured budget", (value) => Number.isInteger(value) && value <= 1),
    satisfies("budgets.replans.used", "replan usage must stay within the configured budget", (value) => Number.isInteger(value) && value <= 1),
  ]);
});

test("TST-114: typed WAITING_FOR_HUMAN resumes the same run or supersedes on input change", async () => {
  const result = await runConformanceScenario(scenarios.TST114);
  accept(result, [
    equal("escalation.initialCandidateState", "WAITING_FOR_HUMAN"),
    equal("escalation.initialRunState", "WAITING_FOR_HUMAN"),
    satisfies("escalation.record", "typed escalation must contain obstacle, impact, attempts, budgets, evidence, reusable artifacts and concrete actions", (value) => value && ["obstacle", "impact", "attempts", "budgets", "evidence", "reusableArtifacts", "actions", "version"].every((field) => field in value)),
    equal("sameInputResolution.runIdBefore", "run-synthetic-001"),
    equal("sameInputResolution.runIdAfter", "run-synthetic-001"),
    equal("sameInputResolution.checkpointsPreserved", true),
    equal("sameInputResolution.budgetUsagePreserved", true),
    equal("sameInputResolution.expensiveTaskRepeated", false),
    equal("staleResolution.accepted", false),
    equal("staleResolution.code", "STALE_ESCALATION_VERSION"),
    equal("inputReplacement.previousRunState", "SUPERSEDED"),
    equal("inputReplacement.newRunLinkedToEscalation", true),
    equal("inputReplacement.newInputVersion", "input-v0002"),
  ]);
});

test("TST-115: intent, outbox reconciliation and compensation never expose partial success", async () => {
  const result = await runConformanceScenario(scenarios.TST115);
  accept(result, [
    equal("status", "SUCCEEDED"),
    includes("faults.exercised", ["timeout-before-call", "timeout-after-effect", "partial-pdf-pair", "lost-notification-response", "compensation-failure"]),
    equal("effects.allHaveDurableIntentBeforeCall", true),
    equal("effects.allHaveIdempotencyIdentity", true),
    equal("effects.duplicatePublications", 0),
    equal("effects.duplicateNotifications", 0),
    equal("publication.partialSuccessVisible", false),
    equal("publication.visibleResultVersions", 1),
    equal("outbox.separateFromCandidateReadiness", true),
    equal("outbox.lostResponseReconciledBeforeRetry", true),
    equal("compensation.failureAudited", true),
    equal("compensation.failureReportedAsSuccess", false),
  ]);
});

test("TST-116: one production-like build supplies focused, regression and safe evidence gates", async () => {
  const result = await runConformanceScenario(scenarios.TST116);
  accept(result, [
    equal("status", "SUCCEEDED"),
    equal("build.productionLike", true),
    satisfies("build.id", "one immutable build id is required", (value) => typeof value === "string" && value.length > 0),
    includes("focused.passed", ["TST-110", "TST-111", "TST-112", "TST-113", "TST-114", "TST-115"]),
    includes("regression.passed", ["E2E-VAC-001", "E2E-TRN-001", "E2E-ABC-001", "E2E-RESULT-001"]),
    equal("focused.buildIdMatches", true),
    equal("regression.buildIdMatches", true),
    equal("evidence.machineResultAvailable", true),
    equal("evidence.readableTimelineAvailable", true),
    equal("evidence.runtimeArtifactsCleansed", true),
    equal("evidence.retentionDays", 30),
    equal("evidence.provisionedBackgroundRuntime", true),
  ]);
});
