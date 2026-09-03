export const syntheticCredentialSentinels = Object.freeze([
  "synthetic-database-password-never-emit-vpspg",
  "synthetic-google-oauth-secret-never-emit-vpspg",
  "synthetic-routerai-key-never-emit-vpspg",
  "synthetic-assemblyai-key-never-emit-vpspg",
  "synthetic-telegram-token-never-emit-vpspg",
]);

export const syntheticPiiSentinels = Object.freeze([
  "synthetic.person@example.invalid",
  "+7-000-000-00-00",
  "SYNTHETIC_PRIVATE_NAME_VPSPG",
]);

const common = Object.freeze({
  fixtureSetId: "vps-postgres-runtime-synthetic-v1",
  runId: "vpspg-run-synthetic-7c91",
  dataClassification: "synthetic-no-real-pii-no-real-secrets-no-provider-expense",
  privateCandidateFolderMayBeRead: false,
});

export const credentialAllowlist = Object.freeze([
  "database-url",
  "google-oauth-client-secret",
  "google-oauth-keyring.json",
  "routerai-api-key",
  "assemblyai-api-key",
  "telegram-bot-token",
  "telegram-recipients.json",
  "internal-service-tokens.json",
  "rabbitmq-password",
]);

export const benchmarkFixture = Object.freeze({
  fixtureId: "benchmark-synthetic-7c91",
  consent: { fileName: "consent-proof.synthetic.txt", checksum: "c".repeat(64), confirmed: true },
  files: [
    { role: "pipeline-input", fileName: "input-resume.synthetic.pdf", checksum: "1".repeat(64), magicMime: "application/pdf" },
    { role: "pipeline-input", fileName: "input-interview.synthetic.bin", checksum: "2".repeat(64), magicMime: "video/mp4" },
    { role: "consent-proof", fileName: "consent-proof.synthetic.txt", checksum: "c".repeat(64), magicMime: "text/plain" },
    { role: "reference-abc", fileName: "reference-abc.synthetic.pdf", checksum: "a".repeat(64), magicMime: "application/pdf" },
    { role: "reference-result", fileName: "reference-result.synthetic.pdf", checksum: "b".repeat(64), magicMime: "application/pdf" },
    { role: "excluded", fileName: "excluded.synthetic.json", checksum: "e".repeat(64), magicMime: "application/json" },
  ],
  denyChecksums: ["a".repeat(64), "b".repeat(64)],
  profile: Object.freeze({
    draftChecksum: "d".repeat(64),
    approvalChecksum: "d".repeat(64),
    draftProfileSnapshotHash: "snapshot-profile-1",
    approvalProfileSnapshotHash: "snapshot-profile-1",
    title: "Синтетическая вакансия",
    approvalBy: "local-operator",
  }),
  privateReview: Object.freeze({
    ownerOnlyRetentionCount: 2,
    retentionDays: 7,
  }),
  providerRequests: [
    { provider: "GoogleDrive", checksums: ["1".repeat(64), "2".repeat(64)] },
    { provider: "AssemblyAI", checksums: ["2".repeat(64)] },
    { provider: "RouterAI", checksums: ["1".repeat(64)] },
  ],
  oracle: {
    version: "private-benchmark-oracle/v1",
    exactRecommendationRequired: true,
    requiredSectionRecall: 1,
    significantClaimEvidenceRecall: 1,
    criticalAnchorRecallMinimum: 0.85,
    abcGradeMatchMinimum: 0.8,
    forbidGradeInversion: true,
    inventedStopFactorsMaximum: 0,
  },
  simulatedAggregateResult: {
    recommendationExact: false,
    requiredSectionRecall: 1,
    significantClaimEvidenceRecall: 1,
    criticalAnchorRecall: 0.84,
    abcGradeMatch: 0.8,
    gradeInversions: 0,
    inventedStopFactors: 0,
  },
});

const progressCandidate = Object.freeze({
  id: 7101,
  name: "Синтетический кандидат",
  initials: "СК",
  vacancyId: "vac-synthetic-vpspg",
  vacancy: "Синтетическая вакансия",
  status: "ANALYZING",
  archived: false,
  elapsedMinutes: 11,
  etaMinutes: null,
  stageStartedAt: "2026-08-20T08:00:00.000Z",
  progressPercent: 55,
  progressMilestone: "Доказательства собраны",
  result: null,
  tone: "blue",
  updated: "AI-анализ",
});

const frozenProfileApproval = Object.freeze({
  ...common,
  scenarioId: "ATDD-VPSPG-008",
  kind: "frozen-profile-approval",
  approvalPack: Object.freeze({
    schemaVersion: "profile-approval-pack/v1",
    present: true,
    approvedChecksum: "6".repeat(64),
    approvedSnapshotHash: "snapshot-profile-approved-1",
    approvedBy: "local-operator",
    immutable: true,
  }),
  profile: Object.freeze({
    title: "Синтетическая вакансия",
    currentChecksum: "6".repeat(64),
    currentSnapshotHash: "snapshot-profile-approved-1",
  }),
  probes: Object.freeze([
    { case: "approval-absent", expectedCode: "PROFILE_APPROVAL_REQUIRED" },
    { case: "checksum-mismatch", expectedCode: "PROFILE_APPROVAL_REQUIRED" },
    { case: "implicit-regeneration", expectedCode: "PROFILE_APPROVAL_REQUIRED" },
  ]),
  pipelineInputChecksums: Object.freeze(["1".repeat(64), "2".repeat(64)]),
  providerRequestChecksums: Object.freeze(["2".repeat(64)]),
  oracle: {
    status: "SUCCEEDED",
    profileApprovalFailClosed: true,
    failClosedProbesPassed: 3,
    failClosedBeforePipelineInputRead: true,
    failClosedBeforeProviderCalls: true,
    pipelineInputsRead: 0,
    providerCallsMade: 0,
    implicitProfileRegenerationBlocked: true,
    profileSnapshotImmutable: true,
    profileFingerprintInEvidence: true,
    referenceDerivedProfileMutation: false,
  },
});

const referenceDerivedProfile = Object.freeze({
  ...common,
  scenarioId: "ATDD-VPSPG-009",
  kind: "reference-derived-profile",
  benchmark: Object.freeze({
    fixtureId: "benchmark-reference-derived-synthetic-7c91",
    consent: { fileName: "consent-proof.synthetic.txt", checksum: "c".repeat(64), confirmed: true },
    files: [
      { role: "pipeline-input", fileName: "input-resume.synthetic.pdf", checksum: "1".repeat(64), magicMime: "application/pdf" },
      { role: "consent-proof", fileName: "consent-proof.synthetic.txt", checksum: "c".repeat(64), magicMime: "text/plain" },
      { role: "reference-abc", fileName: "reference-abc.synthetic.pdf", checksum: "a".repeat(64), magicMime: "application/pdf" },
      { role: "reference-result", fileName: "reference-result.synthetic.pdf", checksum: "b".repeat(64), magicMime: "application/pdf" },
    ],
    denyChecksums: ["a".repeat(64), "b".repeat(64)],
    providerRequests: [
      { provider: "RouterAI", checksums: ["1".repeat(64), "a".repeat(64)], anchors: ["anchor-synthetic-critical-risk-1"] },
      { provider: "GoogleDrive", checksums: ["1".repeat(64), "2".repeat(64)] },
    ],
    profile: Object.freeze({
      draftChecksum: "d".repeat(64),
      approvalChecksum: "d".repeat(64),
      draftProfileSnapshotHash: "snapshot-profile-1",
      approvalProfileSnapshotHash: "snapshot-profile-1",
      title: "Синтетическая вакансия",
      approvalBy: "local-operator",
    }),
  }),
  referenceContentChecksum: "f".repeat(64),
  extractedAnchors: ["anchor-synthetic-critical-risk-1", "anchor-synthetic-contradiction-2"],
  oracle: {
    status: "SUCCEEDED",
    referenceChecksumsReachedNetwork: 0,
    referenceChecksumsReachedDriveSnapshot: 0,
    referenceChecksumsReachedBlobs: 0,
    referenceDerivedAnchorsReachedProvider: 0,
    profileDerivedFromReferenceBlocked: true,
    profileChecksumReferenceIndependent: true,
    referenceContentProfileMutationPrevented: true,
    profileFingerprintUnchangedByReference: true,
  },
});

const privatePdfRetention = Object.freeze({
  ...common,
  scenarioId: "ATDD-VPSPG-010",
  kind: "private-pdf-retention",
  retention: Object.freeze({
    expectedGeneratedPdfCount: 2,
    permissions: "0600",
    retentionDays: 7,
    deadlineIso: "2026-08-28T00:00:00.000Z",
    reviewCompleted: true,
    cleanupPerformedAfterReviewOrDeadline: true,
  }),
  generatedPdfNames: Object.freeze(["generated-report-1.synthetic.pdf", "generated-report-2.synthetic.pdf"]),
  oracle: {
    status: "SUCCEEDED",
    retentionCount: 2,
    ownerOnlyPermissions: "0600",
    retentionDeadline: true,
    reviewOrDeadlineTriggeredCleanup: true,
    deletionProven: true,
    deletionEvidenceSaved: true,
    incompleteCleanupTerminalRed: true,
  },
});

const localCanonicalE2e = Object.freeze({
  ...common,
  scenarioId: "ATDD-VPSPG-011",
  kind: "local-canonical-e2e",
  canonicalScenarios: Object.freeze(["E2E-VAC-001", "E2E-TRN-001", "E2E-ABC-001", "E2E-RESULT-001"]),
  runtimeUnderTest: "node-web-worker",
  storageUnderTest: "postgresql-16",
  controlledProviderMarked: true,
  oracle: {
    status: "SUCCEEDED",
    fourCanonicalE2eThroughNodePostgres: true,
    viaApplicationBoundary: true,
    evidenceFromDurablePostgresState: true,
    sqliteFixtureControllerUsed: false,
    inMemoryCanonicalPipelineUsed: false,
    productionLikeAcceptanceClaimed: false,
    buildConfigFixtureFingerprintsMatch: true,
    controlledProviderMarked: true,
  },
});

export const scenarios = Object.freeze({
  noCloudflare: Object.freeze({
    ...common,
    scenarioId: "ATDD-VPSPG-001",
    kind: "production-graph",
    oracle: { status: "SUCCEEDED", forbiddenProductionReferences: 0, readinessChecks: ["identity", "postgresql", "blob", "drive", "llm", "stt"], cloudflareReadyPath: false },
  }),
  postgresSchema: Object.freeze({
    ...common,
    scenarioId: "ATDD-VPSPG-002",
    kind: "postgres-clean-upgrade",
    operations: ["postgres-16-clean-migrate", "seed-supported-previous-schema", "upgrade-current", "verify-identities-revisions-encrypted-envelope-checksums", "transaction-rollback"],
    oracle: { status: "SUCCEEDED", backend: "postgresql-16", cleanSchema: true, upgradeSchema: true, transactionAtomic: true, preservedIdentityCount: 6, migrationLock: "advisory" },
  }),
  postgresDurability: Object.freeze({
    ...common,
    scenarioId: "ATDD-VPSPG-003",
    kind: "postgres-durable-concurrency",
    operations: ["two-worker-simultaneous-claim", "late-fenced-outcome", "timeout-after-effect", "outbox-reconcile-before-retry", "immutable-bounded-blob"],
    oracle: { status: "SUCCEEDED", uniqueClaims: 1, lateWorkerRejected: true, reconcileBeforeRetry: true, duplicateEffects: 0, outboxIntentAtomic: true, blobChecksumVerified: true, oversizeBlobRejectedWithoutPartialWrite: true, inlineBlobBytesInEventsOrLogs: 0 },
  }),
  nodeRuntime: Object.freeze({
    ...common,
    scenarioId: "ATDD-VPSPG-004",
    kind: "node-nitro-runtime",
    operations: ["build-node-target", "start-node-output", "unauthenticated-route", "authenticated-route", "short-request-publishes-postgres-task"],
    oracle: { status: "SUCCEEDED", target: "node-nitro", nodeEntrypointExists: true, cloudflareBindingsUsed: false, unauthorizedStatus: 401, authenticatedStatus: 200, longRunningWorkInRequest: false },
  }),
  configuration: Object.freeze({
    ...common,
    scenarioId: "ATDD-VPSPG-005",
    kind: "configuration-allowlist",
    runtimeEnvFiles: ["web/.runtime/runtime.env"],
    credentialDirectory: "web/.runtime/credentials",
    credentialAllowlist,
    rejectedSettings: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHARED_DRIVE_ID", "GOOGLE_SHARED_DRIVE_ROOT_FOLDER_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID", "R2_BUCKET"],
    oracle: { status: "SUCCEEDED", runtimeEnvCount: 1, credentialDirectoryCount: 1, allowlistExact: true, inlineSecretsRejected: true, unknownCredentialsRejected: true, pathEscapeRejected: true, legacySettingsRejected: 6, readinessLeaks: 0 },
  }),
  privateBenchmark: Object.freeze({
    ...common,
    scenarioId: "ATDD-VPSPG-006",
    kind: "private-benchmark",
    benchmark: benchmarkFixture,
    oracle: {
      status: "SUCCEEDED", consentCheckedBeforeInputRead: true, roleClassificationUnambiguous: true, referenceChecksumsReachedNetwork: 0,
      referenceChecksumsReachedDriveSnapshot: 0, referenceChecksumsReachedBlobs: 0, offlineOracleOnly: true, hardOracleStatus: "RED",
      cleanupAttemptedAfterRed: true, cleanupComplete: true, privateCandidateFolderReads: 0,
      profileChecksumMatched: true, reviewRetentionExpectedCount: 2, reviewRetentionDaysExpected: 7,
    },
  }),
  progressUi: Object.freeze({
    ...common,
    scenarioId: "ATDD-VPSPG-007",
    kind: "rendered-progress-ui",
    candidate: progressCandidate,
    oracle: { status: "SUCCEEDED", dashboardProgressBars: 1, listProgressBars: 1, dashboardPercent: 55, listPercent: 55, dashboardMilestone: "Доказательства собраны", listMilestone: "Доказательства собраны", ariaMin: 0, ariaMax: 100, browserInferredProgress: false },
  }),
  frozenProfileApproval,
  referenceDerivedProfile,
  privatePdfRetention,
  localCanonicalE2e,
});
