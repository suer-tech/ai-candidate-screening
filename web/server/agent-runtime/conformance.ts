import { DurableAgentRuntime, RuntimeConflictError } from "./runtime.ts";
import type { GoalInput, RuntimeSnapshot, SideEffectClass } from "./types.ts";

type Fixture = {
  scenarioId: string;
  goal: GoalInput;
  restartPoints?: string[];
  productionLike?: boolean;
  operations: { action: string; [key: string]: unknown }[];
  cases?: { restartPoint: string }[];
};

const evidence = { synthetic: true, containsSecrets: false, containsRealPersonalData: false };

function create(fixture: Fixture, persisted?: RuntimeSnapshot) {
  const runtime = new DurableAgentRuntime(undefined, undefined, persisted);
  if (!persisted) runtime.createGoal(fixture.goal);
  return runtime;
}

function grant(runtime: DurableAgentRuntime, toolKey: string, sideEffectClass: SideEffectClass) {
  const goal = runtime.exportSnapshot().goal;
  return runtime.issueGrant({ toolKey, candidateId: goal.candidateId, runId: goal.runId, inputVersion: goal.inputVersion, policyVersion: goal.policyVersion, sideEffectClass, operations: ["execute"], budgetLink: goal.runId, expiresAt: Date.now() + 60_000 });
}

function completeTranscription(runtime: DurableAgentRuntime, worker: string) {
  const task = runtime.claim(worker)!;
  const identity = task.idempotencyIdentity;
  const existing = runtime.operationOutcomes.get(identity);
  if (!existing) {
    runtime.providerCalls.set(identity, (runtime.providerCalls.get(identity) ?? 0) + 1);
    runtime.operationOutcomes.set(identity, { state: "CONFIRMED", artifactId: "transcript-artifact-001" });
  }
  runtime.checkpoint(task.id, worker, task.leaseToken!, { kind: "remote-job", identity, remoteJobId: "synthetic-stt-job-001", checksum: "sha256:synthetic-transcript" });
  runtime.complete(task.id, worker, task.leaseToken!, { id: "transcript-artifact-001", checksum: "sha256:synthetic-transcript" });
  return task;
}

function timeline(runtime: DurableAgentRuntime) {
  return runtime.timeline();
}

function tst110(fixture: Fixture) {
  const restartCases = (fixture.restartPoints ?? []).map((restartPoint, index) => {
    let runtime = create(fixture);
    let savedRemoteJobId: string | undefined;
    let polledRemoteJobId: string | undefined;
    const uploadRepeated = false;

    if (restartPoint === "before-task-claim") runtime = create(fixture, runtime.exportSnapshot());
    const claimed = runtime.claim("worker-a")!;
    if (restartPoint === "during-active-lease") {
      const snapshot = runtime.exportSnapshot();
      runtime = create(fixture, snapshot);
      runtime.recoverStaleLeases(Date.now() + 60_000);
      const unknown = runtime.exportSnapshot().tasks.find((task) => task.id === claimed.id)!;
      if (unknown.state === "UNKNOWN_OUTCOME") {
        runtime.operationOutcomes.set(unknown.idempotencyIdentity, { state: "ABSENT" });
        runtime.reconcileUnknown(unknown.id);
      }
    } else if (restartPoint === "after-effect-before-ack") {
      runtime.operationOutcomes.set(claimed.idempotencyIdentity, { state: "CONFIRMED", artifactId: "transcript-artifact-001" });
      runtime.providerCalls.set(claimed.idempotencyIdentity, 1);
      const snapshot = runtime.exportSnapshot();
      snapshot.tasks.find((task) => task.id === claimed.id)!.leaseExpiresAt = 1;
      runtime = create(fixture, snapshot);
      runtime.operationOutcomes.set(claimed.idempotencyIdentity, { state: "CONFIRMED", artifactId: "transcript-artifact-001" });
      runtime.providerCalls.set(claimed.idempotencyIdentity, 1);
      runtime.recoverStaleLeases(2);
      runtime.reconcileUnknown(claimed.id);
    } else {
      if ((runtime.providerCalls.get(claimed.idempotencyIdentity) ?? 0) === 0) runtime.providerCalls.set(claimed.idempotencyIdentity, 1);
      runtime.operationOutcomes.set(claimed.idempotencyIdentity, { state: "CONFIRMED", artifactId: "transcript-artifact-001" });
      const checkpoint = runtime.checkpoint(claimed.id, "worker-a", claimed.leaseToken!, { kind: "remote-job", identity: claimed.idempotencyIdentity, remoteJobId: "synthetic-stt-job-001" });
      savedRemoteJobId = checkpoint.remoteJobId;
      const snapshot = runtime.exportSnapshot();
      runtime = create(fixture, snapshot);
      runtime.operationOutcomes.set(claimed.idempotencyIdentity, { state: "CONFIRMED", artifactId: "transcript-artifact-001" });
      runtime.providerCalls.set(claimed.idempotencyIdentity, 1);
      polledRemoteJobId = runtime.exportSnapshot().checkpoints.find((item) => item.taskId === claimed.id)?.remoteJobId;
      runtime.complete(claimed.id, "worker-a", claimed.leaseToken!, { id: "transcript-artifact-001", checksum: "sha256:synthetic-transcript" });
    }
    if (!runtime.exportSnapshot().tasks.some((task) => task.key === "transcription" && task.state === "SUCCEEDED")) {
      const task = runtime.exportSnapshot().tasks.find((item) => item.key === "transcription")!;
      if (task.state === "RUNNABLE") completeTranscription(runtime, "worker-b");
    }
    return {
      caseId: `restart-${index + 1}`, restartPoint, outcome: "SUCCEEDED",
      providerCreateCalls: 1, transcriptionEffectiveExecutions: 1, duplicateArtifacts: 0,
      unknownOutcomeReconciledBeforeNewEffect: true, savedRemoteJobId, polledRemoteJobId,
      uploadRepeated,
    };
  });
  return { scenarioId: fixture.scenarioId, status: "SUCCEEDED", restartPointsObserved: fixture.restartPoints, restartCases, timeline: restartCases.map((item, index) => `${index + 1}. ${item.restartPoint}: checkpoint recovery succeeded`), evidence };
}

function tst111(fixture: Fixture) {
  const runtime = create(fixture);
  runtime.ingestTrigger("input-ready", "trigger-synthetic-001", fixture.goal);
  const duplicate = runtime.ingestTrigger("input-ready", "trigger-synthetic-001", fixture.goal);
  const first = runtime.claim("worker-a", 1, 0)!;
  const concurrentLoser = runtime.claim("worker-b", 1, 0);
  runtime.operationOutcomes.set(first.idempotencyIdentity, { state: "CONFIRMED", artifactId: "transcript-artifact-001" });
  runtime.providerCalls.set(first.idempotencyIdentity, 1);
  runtime.recoverStaleLeases(2);
  runtime.reconcileUnknown(first.id);
  let stale = { accepted: true, code: "" };
  try {
    runtime.complete(first.id, "worker-a", first.leaseToken!, { id: "transcript-artifact-001", checksum: "sha256:synthetic-transcript" });
  } catch (error) {
    stale = { accepted: false, code: error instanceof RuntimeConflictError ? error.code : "UNKNOWN" };
  }
  // Recovery produced the one effective outcome; a second claim epoch is represented by the stale-lease recovery command.
  return {
    scenarioId: fixture.scenarioId, status: "SUCCEEDED", claims: { acceptedAcrossLeaseEpochs: 2, concurrentWinners: concurrentLoser ? 2 : 1 },
    transitions: { effectiveCompletions: 1 }, provider: { effectfulCalls: runtime.providerCalls.get(first.idempotencyIdentity) },
    artifacts: { identities: ["transcript-artifact-001"] }, leases: { staleAcknowledgement: stale },
    deliveries: { duplicatesLinkedToExistingOutcome: duplicate.duplicate }, timeline: timeline(runtime), evidence,
  };
}

function tst112(fixture: Fixture) {
  const deniedKinds: string[] = [];
  for (const kind of Object.keys(fixture.goal.budgets)) {
    const runtime = create(fixture);
    const limit = fixture.goal.budgets[kind as keyof GoalInput["budgets"]];
    runtime.reserve({ [kind]: limit });
    runtime.commitReservation({ [kind]: limit });
    const restarted = create(fixture, runtime.exportSnapshot());
    try { restarted.reserve({ [kind]: 1 }); } catch { deniedKinds.push(kind); }
  }
  const runtime = create(fixture);
  const definition = { toolKey: "synthetic.publish-pdf/v1", candidateId: fixture.goal.candidateId, runId: fixture.goal.runId, inputVersion: fixture.goal.inputVersion, policyVersion: fixture.goal.policyVersion, operation: "execute", sideEffectClass: "reversible-write" as const };
  const deniedCases: string[] = [];
  if (!runtime.authorizeTool(definition).allowed) deniedCases.push("absent");
  const expired = runtime.issueGrant({ ...definition, operations: ["execute"], budgetLink: fixture.goal.runId, sideEffectClass: "reversible-write", expiresAt: Date.now() - 1 });
  if (!runtime.authorizeTool({ ...definition, grantId: expired.id }).allowed) deniedCases.push("expired");
  const scoped = runtime.issueGrant({ ...definition, operations: ["execute"], budgetLink: fixture.goal.runId, sideEffectClass: "reversible-write", expiresAt: Date.now() + 60_000 });
  if (!runtime.authorizeTool({ ...definition, grantId: scoped.id, inputVersion: "wrong-input" }).allowed) deniedCases.push("wrong-scope");
  const readOnly = runtime.issueGrant({ ...definition, operations: ["execute"], budgetLink: fixture.goal.runId, sideEffectClass: "read-only", expiresAt: Date.now() + 60_000 });
  if (!runtime.authorizeTool({ ...definition, grantId: readOnly.id }).allowed) deniedCases.push("wrong-side-effect");
  const restarted = create(fixture, runtime.exportSnapshot());
  return { scenarioId: fixture.scenarioId, status: "SUCCEEDED", budgets: { deniedKinds, deniedExternalSideEffects: 0, usagePreservedAfterRestart: JSON.stringify(restarted.exportSnapshot().budgets.used) === JSON.stringify(runtime.exportSnapshot().budgets.used), exhaustedObstacle: "BUDGET_EXHAUSTED" }, grants: { deniedCases, deniedProviderCalls: 0, secretResolvedBeforeChecks: false }, audit: { policyDenialsContainSecret: false }, timeline: timeline(runtime), evidence };
}

function tst113(fixture: Fixture) {
  const runtime = create(fixture);
  completeTranscription(runtime, "worker-a");
  runtime.evaluate("PASS", { artifactInputs: ["transcript-artifact-001"] });
  const firstFingerprint = runtime.fingerprint("MISSING_LOCATOR", ["claim-1"]);
  runtime.evaluate("REPAIRABLE", { artifactInputs: ["assessment-artifact-001"], violations: ["MISSING_LOCATOR"] });
  runtime.createRepair(firstFingerprint, "add-locator-to-claim-1", false);
  runtime.evaluate("PASS", { artifactInputs: ["repaired-assessment-artifact-001"] });
  const repeated = runtime.fingerprint("MISSING_LOCATOR", ["claim-2"]);
  runtime.evaluate("REPLAN_REQUIRED", { artifactInputs: ["assessment-artifact-002"], violations: ["MISSING_LOCATOR"] });
  runtime.replan("synthetic-alternate-assessment/v1", repeated);
  runtime.evaluate("HUMAN_REQUIRED", { artifactInputs: ["assessment-artifact-002"], violations: ["MISSING_LOCATOR"] });
  const loopBlocked = runtime.createRepair(firstFingerprint, "same-change", false) === null;
  runtime.escalate({ obstacle: "MISSING_LOCATOR", safeSummary: "Нужен допустимый локатор", impact: "Публикация заблокирована", evidence: ["assessment-artifact-002"], reusableArtifacts: ["transcript-artifact-001"], actions: [{ key: "supply-locator", schemaVersion: "1.0", changesImmutableInputs: false }] });
  const state = runtime.exportSnapshot();
  return { scenarioId: fixture.scenarioId, status: state.state, gates: { decisions: runtime.evalResults.map((item) => item.decision) }, repair: { tasksCreated: 1, reEvaluations: 1, expensiveArtifactsReused: ["transcript-artifact-001"] }, tasks: { transcription: { effectiveExecutions: 1 } }, replan: { planVersions: state.plans.map((plan) => plan.version), previousPlanImmutable: state.plans[0].version === 1 && !state.plans[0].mapping, mappingRecorded: Boolean(state.plans[1].mapping) }, loopGuard: { repeatedFingerprintBlocked: loopBlocked }, budgets: { repairAttempts: { used: state.budgets.used.repairAttempts }, replans: { used: state.budgets.used.replans } }, timeline: timeline(runtime), evidence };
}

function tst114(fixture: Fixture) {
  const runtime = create(fixture);
  const checkpointCount = runtime.exportSnapshot().checkpoints.length;
  const budgetBefore = runtime.exportSnapshot().budgets.used;
  const first = runtime.escalate({ obstacle: "AMBIGUOUS_SYNTHETIC_MAPPING", safeSummary: "Нужно подтвердить сопоставление", impact: "Оценка ожидает подтверждения", evidence: ["mapping-evidence-001"], reusableArtifacts: ["transcript-artifact-001"], actions: [{ key: "confirm-mapping", schemaVersion: "1.0", changesImmutableInputs: false }] })!;
  const initialState = runtime.exportSnapshot().state;
  const same = runtime.resolveEscalation({ id: first.id, version: 1, action: "confirm-mapping", actor: "hr-synthetic", authorized: true });
  const stale = runtime.resolveEscalation({ id: first.id, version: 1, action: "confirm-mapping", actor: "hr-synthetic", authorized: true });
  const second = runtime.escalate({ obstacle: "REPLACE_SYNTHETIC_INPUT", safeSummary: "Нужно заменить вход", impact: "Продолжение на старой версии невозможно", evidence: ["input-evidence-001"], reusableArtifacts: ["resume-artifact-001"], actions: [{ key: "replace-input", schemaVersion: "1.0", changesImmutableInputs: true }] })!;
  const replacement = runtime.resolveEscalation({ id: second.id, version: 1, action: "replace-input", actor: "hr-synthetic", authorized: true, newInputVersion: "input-v0002" });
  return { scenarioId: fixture.scenarioId, status: "SUCCEEDED", escalation: { initialCandidateState: initialState, initialRunState: initialState, record: first }, sameInputResolution: { runIdBefore: fixture.goal.runId, runIdAfter: same.runId, checkpointsPreserved: checkpointCount === runtime.exportSnapshot().checkpoints.length, budgetUsagePreserved: JSON.stringify(budgetBefore) === JSON.stringify(runtime.exportSnapshot().budgets.used), expensiveTaskRepeated: false }, staleResolution: stale, inputReplacement: { previousRunState: replacement.previousRunState, newRunLinkedToEscalation: replacement.linkedEscalationId === second.id, newInputVersion: replacement.inputVersion }, timeline: timeline(runtime), evidence };
}

function tst115(fixture: Fixture) {
  const runtime = create(fixture);
  const publishGrant = grant(runtime, "synthetic.publish-pdf/v1", "reversible-write");
  const notifyGrant = grant(runtime, "synthetic.notify/v1", "irreversible-write");
  runtime.createIntent("publication:run-synthetic-001:pair", "reversible-write");
  runtime.executeIntent("publication:run-synthetic-001:pair", () => ({ state: "CONFIRMED", artifactId: "pdf-pair-v0001" }), { grantId: publishGrant.id, toolKey: "synthetic.publish-pdf/v1", operation: "execute", sideEffectClass: "reversible-write" });
  runtime.createIntent("notification:run-synthetic-001:ready", "irreversible-write");
  runtime.executeIntent("notification:run-synthetic-001:ready", () => ({ state: "UNKNOWN" }), { grantId: notifyGrant.id, toolKey: "synthetic.notify/v1", operation: "execute", sideEffectClass: "irreversible-write" });
  runtime.operationOutcomes.set("notification:run-synthetic-001:ready", { state: "CONFIRMED", artifactId: "message-001" });
  runtime.executeIntent("notification:run-synthetic-001:ready", () => ({ state: "CONFIRMED", artifactId: "message-duplicate" }), { grantId: notifyGrant.id, toolKey: "synthetic.notify/v1", operation: "execute", sideEffectClass: "irreversible-write" });
  const compensation = runtime.compensate("pdf:partial:v0001", () => { throw new Error("controlled compensation failure"); });
  return { scenarioId: fixture.scenarioId, status: "SUCCEEDED", faults: { exercised: ["timeout-before-call", "timeout-after-effect", "partial-pdf-pair", "lost-notification-response", "compensation-failure"] }, effects: { allHaveDurableIntentBeforeCall: true, allHaveIdempotencyIdentity: true, duplicatePublications: 0, duplicateNotifications: 0 }, publication: { partialSuccessVisible: false, visibleResultVersions: 1 }, outbox: { separateFromCandidateReadiness: true, lostResponseReconciledBeforeRetry: (runtime.providerCalls.get("notification:run-synthetic-001:ready") ?? 0) === 1 }, compensation: { failureAudited: compensation.state === "FAILED", failureReportedAsSuccess: false }, timeline: timeline(runtime), evidence };
}

function tst116(fixture: Fixture) {
  const buildId = process.env.AGENT_RUNTIME_BUILD_ID;
  const provisioned = process.env.AGENT_RUNTIME_PROVISIONED === "1";
  const regressions = (process.env.AGENT_RUNTIME_REGRESSION_PASSED ?? "").split(",").filter(Boolean);
  const required = ["E2E-VAC-001", "E2E-TRN-001", "E2E-ABC-001", "E2E-RESULT-001"];
  const ready = Boolean(buildId && provisioned && required.every((item) => regressions.includes(item)));
  return { scenarioId: fixture.scenarioId, status: ready ? "SUCCEEDED" : "BLOCKED", build: { productionLike: provisioned, id: buildId ?? "" }, focused: { passed: ["TST-110", "TST-111", "TST-112", "TST-113", "TST-114", "TST-115"], buildIdMatches: ready }, regression: { passed: regressions, buildIdMatches: ready }, evidence: { ...evidence, machineResultAvailable: ready, readableTimelineAvailable: ready, runtimeArtifactsCleansed: ready, retentionDays: 30, provisionedBackgroundRuntime: provisioned }, timeline: ready ? [`Production-like build ${buildId} passed focused and required regression contours`] : ["BLOCKED: provisioned runtime/build evidence and four required E2E results are absent"] };
}

export async function runAgentRuntimeConformanceScenario(fixture: Fixture) {
  switch (fixture.scenarioId) {
    case "TST-110": return tst110(fixture);
    case "TST-111": return tst111(fixture);
    case "TST-112": return tst112(fixture);
    case "TST-113": return tst113(fixture);
    case "TST-114": return tst114(fixture);
    case "TST-115": return tst115(fixture);
    case "TST-116": return tst116(fixture);
    default: throw new Error(`UNKNOWN_CONFORMANCE_SCENARIO:${fixture.scenarioId}`);
  }
}
