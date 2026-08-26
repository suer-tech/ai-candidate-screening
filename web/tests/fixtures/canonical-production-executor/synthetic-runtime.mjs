const ids = Object.freeze({
  candidateId: "candidate-prod-executor-synthetic-8f2a",
  candidatePk: 880021,
  runId: "run-prod-executor-synthetic-8f2a-v0001",
  inputVersion: "input-v0001",
  profileVersion: "profile-v0007",
  policyVersion: "candidate-analysis/v1",
  connectionId: "google-oauth-connection-synthetic-8f2a",
  rootFolderId: "my-drive-hiring-root-synthetic-8f2a",
  vacancyFolderId: "my-drive-vacancy-synthetic-8f2a",
  candidateFolderId: "my-drive-candidate-synthetic-8f2a",
});

const credentials = Object.freeze({
  googleClientSecret: "synthetic-google-client-secret-never-emit-8f2a",
  googleRefreshToken: "synthetic-google-refresh-token-never-emit-8f2a",
  googleAccessToken: "synthetic-google-access-token-never-emit-8f2a",
  routerAiKey: "synthetic-routerai-key-never-emit-8f2a",
  assemblyAiKey: "synthetic-assemblyai-key-never-emit-8f2a",
  telegramToken: "synthetic-telegram-token-never-emit-8f2a",
});

export const forbiddenCredentialMarkers = Object.freeze(Object.values(credentials));

const candidateObjects = Object.freeze([
  { fileId: "resume-synthetic-8f2a", parentFolderId: ids.candidateFolderId, version: "17", name: "resume.pdf", mimeType: "application/pdf", size: 2841, modifiedTime: "2026-08-20T08:00:00.000Z" },
  { fileId: "interview-synthetic-8f2a", parentFolderId: ids.candidateFolderId, version: "4", name: "interview.mp4", mimeType: "video/mp4", size: 16384, modifiedTime: "2026-08-20T08:01:00.000Z" },
]);

const exactGrant = Object.freeze({
  id: "grant-prod-executor-synthetic-8f2a",
  toolKey: "candidate.drive-snapshot/v1",
  connectionId: ids.connectionId,
  rootFolderId: ids.rootFolderId,
  candidateId: ids.candidateId,
  candidateFolderId: ids.candidateFolderId,
  inputVersion: ids.inputVersion,
  operations: ["drive:list-candidate-folder", "drive:download-registered-input"],
  sideEffectClass: "read-only",
  budgetLink: "budget-prod-executor-synthetic-8f2a",
  expiresAt: 1_800_000_000_000,
});

const releaseEvidence = Object.freeze({
  buildId: "build-prod-executor-synthetic-8f2a",
  configurationFingerprint: "config-prod-executor-synthetic-8f2a",
  pairRecoveryGreen: true,
  outboxRecoveryGreen: true,
  hardBudgetsVerified: true,
});

function task(toolKey, suffix, extra = {}) {
  return Object.freeze({
    id: `task-${suffix}-synthetic-8f2a`,
    runId: ids.runId,
    taskKey: suffix,
    toolKey,
    candidatePk: ids.candidatePk,
    candidateId: ids.candidateId,
    candidateFolderId: ids.candidateFolderId,
    inputVersion: ids.inputVersion,
    profileVersion: ids.profileVersion,
    policyVersion: ids.policyVersion,
    idempotencyIdentity: `${ids.runId}:${suffix}`,
    authorizationGrantId: exactGrant.id,
    leaseToken: 41,
    worker: "synthetic-production-worker",
    attemptId: `attempt-${suffix}-001`,
    ...extra,
  });
}

const shadowNonVisibleTools = Object.freeze([
  "candidate.drive-snapshot/v1",
  "candidate.document-extraction/v1",
  "candidate.transcription/v1",
  "candidate.evidence-extraction/v1",
  "candidate.assessment/v1",
  "candidate.validation/v1",
  "candidate.report-pair/v1",
]);

function environment(routingMode) {
  return {
    CANDIDATE_PIPELINE_ROUTING: routingMode,
    CANDIDATE_PIPELINE_BUILD_ID: releaseEvidence.buildId,
    CANDIDATE_PIPELINE_RELEASE_EVIDENCE_JSON: JSON.stringify(releaseEvidence),
    AGENT_RUNTIME_INTERNAL_TOKEN: "synthetic-internal-runtime-token-never-emit-8f2a",
    AGENT_RUNTIME_CONFIG_JSON: JSON.stringify({ contract: "durable-agent-runtime/v1" }),
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client.apps.googleusercontent.invalid",
    GOOGLE_OAUTH_CLIENT_SECRET: credentials.googleClientSecret,
    GOOGLE_OAUTH_REDIRECT_URI: "https://synthetic.example.invalid/api/integrations/google-drive/oauth/callback",
    GOOGLE_OAUTH_DEPLOYMENT_MODE: "production-personal",
    GOOGLE_OAUTH_TOKEN_KEYRING_JSON: "{\"activeVersion\":\"synthetic-v1\"}",
    LLM_RUNTIME_CONFIG_JSON: "{\"provider\":\"routerai\"}",
    ROUTERAI_API_KEY: credentials.routerAiKey,
    ASSEMBLYAI_API_KEY: credentials.assemblyAiKey,
    TELEGRAM_BOT_TOKEN: credentials.telegramToken,
    TELEGRAM_RECIPIENT_REFS_JSON: "{\"hr-primary\":\"100001\",\"hr-backup\":\"100002\"}",
  };
}

const common = Object.freeze({
  fixtureSetId: "canonical-production-executor-synthetic-v1",
  dataClassification: "synthetic-no-real-pii-no-real-secrets-no-provider-expense",
  ids,
  credentials,
  exactGrant,
  releaseEvidence,
  candidateObjects,
});

export const scenarios = Object.freeze({
  routeRuntimeAndSnapshot: Object.freeze({
    ...common,
    scenarioId: "ATDD-PEX-001",
    environment: environment("shadow"),
    tasks: [task("candidate.drive-snapshot/v1", "drive-snapshot")],
    oracle: {
      overallStatus: "SUCCEEDED",
      productionRoutePassesEnvironmentBindings: true,
      productionRoutePassesRuntime: true,
      dbBindingSource: "env.DB",
      dbBindingUsed: true,
      driveBackend: "personal-oauth-my-drive",
      oauthRuntimeUsed: true,
      driveAdapterUsed: true,
      exactGrantChecked: true,
      snapshotFolderId: ids.candidateFolderId,
      snapshotObjectIds: candidateObjects.map((object) => object.fileId),
      sharedDriveCalls: 0,
      serviceAccountCalls: 0,
    },
  }),
  shadowAllNonVisible: Object.freeze({
    ...common,
    scenarioId: "ATDD-PEX-002",
    environment: environment("shadow"),
    tasks: shadowNonVisibleTools.map((toolKey, index) => task(toolKey, `shadow-${index + 1}`)),
    oracle: {
      overallStatus: "SUCCEEDED",
      executedTools: shadowNonVisibleTools,
      providerAdapters: ["GoogleMyDriveAdapter", "RouterAI", "AssemblyAI", "PDFRenderer"],
      drivePublicationCalls: 0,
      telegramSendCalls: 0,
    },
  }),
  effectfulReleaseAndIdempotency: Object.freeze({
    ...common,
    scenarioId: "ATDD-PEX-003",
    environment: environment("effectful"),
    tasks: [
      task("candidate.report-pair/v1", "report-pair"),
      task("candidate.drive-publication/v1", "drive-publication"),
      task("candidate.telegram/v1", "telegram"),
      task("candidate.drive-publication/v1", "drive-publication"),
      task("candidate.telegram/v1", "telegram"),
    ],
    oracle: {
      overallStatus: "SUCCEEDED",
      releaseEvidenceValidated: true,
      outboxIntentPersistedBeforeEffect: true,
      durableOutbox: true,
      visiblePdfCount: 2,
      uniquePdfOperationCount: 2,
      telegramRecipientCount: 2,
      uniqueTelegramSendCount: 2,
      candidateState: "READY",
    },
  }),
  restartReconcileAndInvalidGrant: Object.freeze({
    ...common,
    scenarioId: "ATDD-PEX-004",
    environment: environment("effectful"),
    tasks: [
      task("candidate.transcription/v1", "restart-transcription", { syntheticFault: "restart-after-provider-create" }),
      task("candidate.drive-publication/v1", "reconcile-publication", { syntheticFault: "timeout-after-create" }),
      task("candidate.drive-snapshot/v1", "invalid-grant", { syntheticFault: "google-invalid-grant" }),
    ],
    oracle: {
      overallStatus: "SUCCEEDED",
      providerJobCheckpointRestored: true,
      publicationReconciledBeforeRetry: true,
      duplicateExternalEffects: 0,
      invalidGrantOutcome: "WAITING_FOR_HUMAN",
      goalState: "WAITING_FOR_HUMAN",
      obstacle: "GOOGLE_OAUTH_INVALID_GRANT",
      action: "Переподключить Google Drive",
      checkpointPreserved: true,
    },
  }),
  artifactAndCredentialBoundaries: Object.freeze({
    ...common,
    scenarioId: "ATDD-PEX-005",
    environment: environment("shadow"),
    tasks: [task("candidate.evidence-extraction/v1", "artifact-boundary", { syntheticLargeArtifact: "x".repeat(32_768) })],
    oracle: {
      overallStatus: "SUCCEEDED",
      d1ArtifactPayloadRows: 0,
      d1ArtifactReferenceRows: 1,
      inlineArtifactBytesInLogs: 0,
      credentialLeaks: 0,
    },
  }),
});
