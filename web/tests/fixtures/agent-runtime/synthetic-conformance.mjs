const goal = Object.freeze({
  goalType: "synthetic-candidate-processing/v1",
  goalId: "goal-synthetic-001",
  runId: "run-synthetic-001",
  candidateId: "candidate-synthetic-001",
  inputVersion: "input-v0001",
  profileVersion: "profile-v0001",
  policyVersion: "agent-policy-v1",
  completionCriteriaVersion: "synthetic-completion-v1",
  completionCriteria: [
    "transcript-checkpoint-confirmed",
    "assessment-gates-passed",
    "publication-visible-as-complete-pair",
  ],
  budgets: {
    wallTimeMs: 60_000,
    taskAttempts: 8,
    repairAttempts: 1,
    replans: 1,
    llmCalls: 3,
    tokens: 1_000,
    costMicrounits: 10_000,
    externalRequests: 6,
  },
});

const tools = Object.freeze({
  transcript: {
    key: "synthetic.transcript/v1",
    sideEffectClass: "idempotent-write",
    idempotencyIdentity: "stt:candidate-synthetic-001:input-v0001",
    remoteJobId: "synthetic-stt-job-001",
    deterministicOutput: { artifactId: "transcript-artifact-001", checksum: "sha256:synthetic-transcript" },
  },
  assessment: {
    key: "synthetic.assessment/v1",
    sideEffectClass: "idempotent-write",
    idempotencyIdentity: "assessment:run-synthetic-001:plan-v1",
    deterministicOutput: { artifactId: "assessment-artifact-001", checksum: "sha256:synthetic-assessment" },
  },
  publishPdf: {
    key: "synthetic.publish-pdf/v1",
    sideEffectClass: "reversible-write",
    identities: ["pdf:run-synthetic-001:abc", "pdf:run-synthetic-001:result"],
  },
  notify: {
    key: "synthetic.notify/v1",
    sideEffectClass: "irreversible-write",
    idempotencyIdentity: "notify:run-synthetic-001:ready",
  },
});

const restartPoints = [
  "before-task-claim",
  "during-active-lease",
  "after-effect-before-ack",
  "after-provider-job-checkpoint",
  "between-eval-and-repair",
];

function scenario(id, operations, overrides = {}) {
  return Object.freeze({ scenarioId: id, goal, tools, operations, ...overrides });
}

export const scenarios = Object.freeze({
  TST110: scenario("TST-110", [], {
    restartPoints,
    cases: restartPoints.map((point, index) => ({
      caseId: `restart-${index + 1}`,
      isolationKey: `restart-${index + 1}`,
      restartPoint: point,
      operations: [
        { action: "start-worker", worker: "worker-a" },
        { action: "stop-worker", worker: "worker-a", at: point },
        { action: "start-worker", worker: "worker-b" },
        { action: "drain" },
      ],
    })),
  }),

  TST111: scenario("TST-111", [
    { action: "publish-trigger", identity: "trigger-synthetic-001", deliveries: 2 },
    { action: "claim-concurrently", workers: ["worker-a", "worker-b"] },
    { action: "expire-current-lease" },
    { action: "claim", worker: "worker-b" },
    { action: "late-complete", worker: "worker-a" },
    { action: "complete", worker: "worker-b" },
  ]),

  TST112: scenario("TST-112", [
    { action: "exercise-budget-matrix", kinds: ["taskAttempts", "repairAttempts", "replans", "llmCalls", "tokens", "costMicrounits", "wallTimeMs", "externalRequests"] },
    { action: "restart-after-budget-use", kind: "repairAttempts" },
    { action: "exercise-grant-matrix", cases: ["absent", "expired", "wrong-scope", "wrong-side-effect"] },
  ]),

  TST113: scenario("TST-113", [
    { action: "evaluate", decision: "PASS" },
    { action: "evaluate", decision: "REPAIRABLE", violation: "MISSING_LOCATOR", fingerprint: "missing-locator:claim-1" },
    { action: "repair", expectedChange: "add-locator-to-claim-1" },
    { action: "evaluate", decision: "PASS" },
    { action: "evaluate-repeated-violation", decision: "REPLAN_REQUIRED", fingerprint: "missing-locator:claim-2" },
    { action: "replan", template: "synthetic-alternate-assessment/v1" },
    { action: "evaluate-repeated-violation", decision: "HUMAN_REQUIRED", fingerprint: "missing-locator:claim-2" },
  ]),

  TST114: scenario("TST-114", [
    { action: "raise-escalation", obstacle: "AMBIGUOUS_SYNTHETIC_MAPPING", allowedAction: "confirm-mapping" },
    { action: "resolve", escalationVersion: 1, changesImmutableInputs: false },
    { action: "resolve", escalationVersion: 1, expect: "stale-rejection" },
    { action: "raise-escalation", obstacle: "REPLACE_SYNTHETIC_INPUT", allowedAction: "replace-input" },
    { action: "replace-input", newInputVersion: "input-v0002" },
  ]),

  TST115: scenario("TST-115", [
    { action: "inject", point: "timeout-before-call" },
    { action: "inject", point: "timeout-after-effect" },
    { action: "inject", point: "partial-pdf-pair" },
    { action: "inject", point: "lost-notification-response" },
    { action: "inject", point: "compensation-failure" },
  ]),

  TST116: scenario("TST-116", [
    { action: "run-focused", tests: ["TST-110", "TST-111", "TST-112", "TST-113", "TST-114", "TST-115"] },
    { action: "run-regression", tests: ["E2E-VAC-001", "E2E-TRN-001", "E2E-ABC-001", "E2E-RESULT-001"] },
    { action: "collect-safe-evidence", retentionDays: 30 },
  ], { productionLike: true }),
});
