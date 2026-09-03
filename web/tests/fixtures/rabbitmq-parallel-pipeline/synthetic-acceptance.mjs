export const fixtureSetId = "rabbitmq-parallel-pipeline-synthetic-v1";

export const envelopeSchema = Object.freeze({
  schemaVersion: "rabbit-task-envelope/v1",
  allowedFields: Object.freeze([
    "schemaVersion",
    "taskId",
    "runId",
    "taskVersion",
    "routingClass",
    "attemptHint",
    "correlationId",
    "traceId",
    "createdAt",
  ]),
});

export const forbiddenEnvelopeFixtures = Object.freeze([
  Object.freeze({ field: "candidateName", value: "SYNTHETIC_PRIVATE_NAME_RABBIT" }),
  Object.freeze({ field: "candidateEmail", value: "rabbit.person@example.invalid" }),
  Object.freeze({ field: "candidatePhone", value: "+7-000-111-22-33" }),
  Object.freeze({ field: "documentText", value: "SYNTHETIC_DOCUMENT_FRAGMENT_RABBIT" }),
  Object.freeze({ field: "transcript", value: "SYNTHETIC_TRANSCRIPT_FRAGMENT_RABBIT" }),
  Object.freeze({ field: "prompt", value: "SYNTHETIC_PRIVATE_PROMPT_RABBIT" }),
  Object.freeze({ field: "providerSecret", value: "synthetic-provider-secret-never-emit-rabbit" }),
  Object.freeze({ field: "signedUrl", value: "https://storage.example.invalid/object?X-Synthetic-Signature=never-emit" }),
]);

const common = Object.freeze({
  fixtureSetId,
  synthetic: true,
  containsRealPii: false,
  containsSecrets: false,
  providerExpense: false,
  privateCandidateFolderRead: false,
  buildConfigFixtureIdentity: "rabbit-acceptance-build-config-fixture-v1",
});

const parallelGroups = Object.freeze([
  Object.freeze({ kind: "documents", minimumOverlappingTasks: 2, taskKinds: ["document"] }),
  Object.freeze({ kind: "interviews", minimumOverlappingTasks: 2, taskKinds: ["interview"] }),
  Object.freeze({ kind: "evidence", minimumOverlappingTasks: 2, taskKinds: ["evidence-batch"] }),
  Object.freeze({ kind: "abc-rows", minimumOverlappingTasks: 3, taskKinds: ["abc", "matrix-row"] }),
  Object.freeze({ kind: "critical", minimumOverlappingTasks: 2, taskKinds: ["critical-row"] }),
]);

export const scenarios = Object.freeze({
  TST086: Object.freeze({
    ...common,
    scenarioId: "TST-086",
    kind: "rabbit-crash-boundaries",
    crashPoints: Object.freeze(["before-postgres-commit", "after-postgres-commit-before-rabbit-ack"]),
  }),
  TST087: Object.freeze({
    ...common,
    scenarioId: "TST-087",
    kind: "five-parallelisms",
    parallelGroups,
    candidateRunId: "synthetic-run-parallel-001",
  }),
  TST088: Object.freeze({
    ...common,
    scenarioId: "TST-088",
    kind: "candidate-failure-isolation",
    candidateRunIds: Object.freeze(["synthetic-run-poison", "synthetic-run-healthy-a", "synthetic-run-healthy-b"]),
    poisonTaskId: "synthetic-critical-shard-poison",
  }),
  TST089: Object.freeze({
    ...common,
    scenarioId: "TST-089",
    kind: "broker-outage-recovery",
    outagePoints: Object.freeze(["before-publish", "with-unacked-delivery"]),
  }),
  TST090: Object.freeze({
    ...common,
    scenarioId: "TST-090",
    kind: "envelope-confidentiality",
    envelopeSchema,
    workflowVersion: "matrix-v4-rabbit-parallel",
    forbiddenEnvelopeFixtures,
    locations: Object.freeze(["published", "unacked", "dead-letter"]),
  }),
  TST091: Object.freeze({
    ...common,
    scenarioId: "TST-091",
    kind: "release-gate-composition",
    requiredE2e: Object.freeze(["E2E-VAC-001", "E2E-TRN-001", "E2E-ABC-001", "E2E-RESULT-001"]),
    requiredDriveConflict: "MAIN_SPEC_SHARED_DRIVE_SERVICE_ACCOUNT_CONFLICT",
  }),
});
