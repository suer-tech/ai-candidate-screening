const syntheticCredentials = Object.freeze({
  authorizationCode: "synthetic-oauth-code-do-not-emit",
  clientSecret: "synthetic-client-secret-do-not-emit",
  refreshToken: "synthetic-refresh-token-do-not-emit",
  accessToken: "synthetic-access-token-do-not-emit",
  pkceVerifier: "synthetic-pkce-verifier-do-not-emit",
});

const connection = Object.freeze({
  connectionId: "gdo-connection-synthetic-001",
  expectedSubject: "google-subject-synthetic-owner",
  ownerEmail: "synthetic.oauth.owner@example.invalid",
  rootId: "drive-root-hiring-synthetic-001",
  rootName: "Найм",
  scope: "https://www.googleapis.com/auth/drive",
});

const candidate = Object.freeze({
  candidateId: "candidate-gdo-synthetic-001",
  vacancyId: "vacancy-gdo-synthetic-001",
  inputVersion: "input-v0001",
  resultVersion: "v0001",
  candidateFolderId: "drive-candidate-synthetic-001",
  manualResumeFileId: "drive-resume-synthetic-001",
  interviewFileId: "drive-interview-synthetic-001",
  abcPdfIdentity: "gdo:result:candidate-gdo-synthetic-001:v0001:abc",
  resultPdfIdentity: "gdo:result:candidate-gdo-synthetic-001:v0001:result",
});

const common = Object.freeze({
  fixtureSetId: "personal-google-drive-oauth-synthetic-v1",
  dataClassification: "synthetic-only",
  credentials: syntheticCredentials,
  connection,
  candidate,
});

function scenario(scenarioId, operations, oracle) {
  return Object.freeze({ scenarioId, ...common, operations, oracle });
}

export const forbiddenEvidenceValues = Object.freeze(Object.values(syntheticCredentials));

export const scenarios = Object.freeze({
  backendBoundary: scenario("TST-120-A", [
    { action: "startup", configuredBackend: "personal-oauth", serviceAccountConfigured: false, sharedDriveIdConfigured: false },
    { action: "startup", configuredBackend: "service-account", serviceAccountConfigured: true },
  ], { oauthOnlyReady: true, serviceAccountRejectedCode: "GOOGLE_DRIVE_BACKEND_UNSUPPORTED" }),

  authorizationBoundary: scenario("TST-120-B", [
    { action: "connect", principal: null },
    { action: "connect", principal: "synthetic-hr-owner" },
    { action: "callback", principal: null, stateCase: "valid" },
  ], { anonymousConnectDenied: true, anonymousCallbackDenied: true, anonymousOperationsCreated: 0 }),

  callbackSecurity: scenario("TST-120-C", [
    { action: "callback", principal: "synthetic-hr-owner", stateCase: "valid", pkceCase: "valid" },
    { action: "callback", principal: "synthetic-hr-owner", stateCase: "replay", pkceCase: "valid" },
    { action: "callback", principal: "synthetic-hr-owner", stateCase: "expired", pkceCase: "valid" },
    { action: "callback", principal: "synthetic-hr-owner", stateCase: "valid", pkceCase: "mismatch" },
    { action: "callback", principal: "synthetic-hr-owner", stateCase: "valid", redirectCase: "host-header-poisoning" },
  ], { successfulConnections: 1, exchanges: 1, replayRejected: true, expiryRejected: true, pkceMismatchRejected: true, redirectPoisoningRejected: true }),

  tokenConfidentiality: scenario("TST-120-D", [
    { action: "complete-consent" },
    { action: "inspect", surfaces: ["browser", "d1-diagnostics", "task-payload", "timeline", "logs", "metrics", "evidence"] },
    { action: "tamper-token-envelope" },
  ], { refreshTokenEncrypted: true, plaintextTokenColumns: 0, credentialLeaks: 0, tamperRejected: true }),

  readinessModes: scenario("TST-120-E", [
    { action: "preflight", environment: "local", deploymentMode: "testing", redirectUri: "http://localhost:3000/api/integrations/google-drive/oauth/callback" },
    { action: "preflight", environment: "production", deploymentMode: "testing", redirectUri: "https://hiring.example.invalid/api/integrations/google-drive/oauth/callback" },
    { action: "preflight", environment: "production", deploymentMode: "production-personal", redirectUri: "https://hiring.example.invalid/api/integrations/google-drive/oauth/callback" },
  ], { localTestingAllowed: true, testingProductionCode: "GOOGLE_OAUTH_TESTING_GRANT_NOT_DURABLE", productionPersonalReady: true }),

  restartRefresh: scenario("TST-120-F", [
    { action: "checkpoint", point: "after-drive-intent-before-effect" },
    { action: "discard-memory-access-token" },
    { action: "restart-worker" },
    { action: "refresh-and-resume" },
  ], { refreshCalls: 1, accessTokenPersisted: false, checkpointResumed: true, duplicateExternalEffects: 0 }),

  rootConfinement: scenario("TST-120-G", [
    { action: "discover-manual-file", fileId: candidate.manualResumeFileId, parentId: candidate.candidateFolderId },
    { action: "read", fileId: candidate.manualResumeFileId },
    { action: "read", fileId: "drive-unrelated-synthetic-001" },
    { action: "publish", parentId: "drive-unrelated-folder-synthetic-001" },
  ], { manualFileDiscovered: true, registeredDescendantRead: true, unrelatedReadDeniedBeforeApi: true, unrelatedWriteDeniedBeforeApi: true }),

  publicationRecovery: scenario("TST-120-H", [
    { action: "publish-pdf-pair", inject: "timeout-after-create" },
    { action: "reconcile-before-retry" },
    { action: "publish-same-version" },
    { action: "cleanup-derived-synthetic-state" },
  ], { visiblePdfCount: 2, duplicatePdfCount: 0, reconciledBeforeRetry: true, sourceFilesPreserved: true, cleanupComplete: true }),

  revocationEscalation: scenario("TST-120-I", [
    { action: "refresh", response: "invalid_grant" },
    { action: "attempt-drive-effect" },
  ], { connectionState: "REAUTH_REQUIRED", taskState: "WAITING_FOR_HUMAN", action: "Переподключить Google Drive", terminalFailed: false, blockedDriveEffects: 1 }),

  reconnectAndResume: scenario("TST-120-J", [
    { action: "reconnect", googleSubject: connection.expectedSubject },
    { action: "reconcile-unknown-outcome" },
    { action: "resume-checkpoint" },
    { action: "redeliver-resume-event" },
    { action: "reconnect", googleSubject: "google-subject-synthetic-other" },
  ], { expectedAccountResumed: true, accountMismatchBlocked: true, candidateCount: 1, candidateFolderCount: 1, resultVersionCount: 1, visiblePdfCount: 2, duplicateExternalEffects: 0 }),

  disconnect: scenario("TST-120-K", [
    { action: "disconnect", revokeResponse: "unavailable" },
    { action: "inspect-product-state" },
  ], { connectionState: "DISCONNECTED", durableRefreshTokenPresent: false, productRecordsPreserved: true, driveFilesPreserved: true }),

  rootGrantRuntimeBoundary: scenario("TST-120-M", [
    { action: "register-root-ancestry", fileId: candidate.manualResumeFileId, parentId: candidate.candidateFolderId },
    { action: "execute-drive-tool", fileId: candidate.manualResumeFileId, grantCase: "matching-connection-root-candidate-input-operation" },
    { action: "execute-drive-tool", fileId: candidate.manualResumeFileId, grantCase: "missing" },
    { action: "execute-drive-tool", fileId: candidate.manualResumeFileId, grantCase: "wrong-root" },
    { action: "execute-drive-tool", fileId: candidate.manualResumeFileId, grantCase: "wrong-operation" },
    { action: "execute-drive-tool", fileId: "drive-unrelated-client-supplied-001", grantCase: "matching-operation-only" },
  ], {
    authorizedDriveApiCalls: 1,
    missingGrantDeniedBeforeApi: true,
    wrongRootGrantDeniedBeforeApi: true,
    wrongOperationGrantDeniedBeforeApi: true,
    unregisteredClientIdDeniedBeforeApi: true,
    connectionRootCandidateInputAndOperationMatched: true,
  }),

  durableExecutorWiring: scenario("TST-120-N", [
    { action: "publish-drive-task", taskId: "drive-task-synthetic-001", tool: "candidate.drive-publication/v1" },
    { action: "claim-with-runtime-grant-and-budget" },
    { action: "checkpoint", point: "before-drive-effect" },
    { action: "stage-outbox-intent", identity: candidate.resultPdfIdentity },
    { action: "execute-through-oauth-token-provider-and-my-drive-adapter" },
    { action: "acknowledge-outcome" },
  ], {
    durableExecutorUsed: true,
    oauthTokenProviderUsed: true,
    myDriveAdapterUsed: true,
    grantCheckedBeforeTokenResolution: true,
    budgetReservedBeforeEffect: true,
    checkpointPersistedBeforeEffect: true,
    outboxIntentPersistedBeforeEffect: true,
    externalEffects: 1,
  }),

  durableRevocationEscalation: scenario("TST-120-O", [
    { action: "publish-drive-task", taskId: "drive-task-invalid-grant-001" },
    { action: "refresh-token", response: "invalid_grant" },
    { action: "redeliver-drive-task" },
    { action: "inspect-runtime-escalation" },
  ], {
    connectionState: "REAUTH_REQUIRED",
    taskState: "WAITING_FOR_HUMAN",
    runState: "WAITING_FOR_HUMAN",
    escalationObstacle: "GOOGLE_OAUTH_INVALID_GRANT",
    escalationAction: "Переподключить Google Drive",
    driveEffectsAfterRevocation: 0,
    terminalFailed: false,
    checkpointPreserved: true,
  }),

  durableReconnectResume: scenario("TST-120-P", [
    { action: "seed-unknown-publication-outcome", identity: candidate.resultPdfIdentity },
    { action: "reconnect", googleSubject: connection.expectedSubject },
    { action: "redeliver-reconnect-callback" },
    { action: "drain-runtime" },
  ], {
    durableResumeEvents: 1,
    resumedOriginalRun: true,
    timelineOrder: ["GOOGLE_DRIVE_OAUTH_RECONNECTED", "DRIVE_RESUME_PUBLISHED", "UNKNOWN_OUTCOME_RECONCILED", "DRIVE_EFFECT_RETRY_OR_REUSE"],
    reconcileBeforeRetry: true,
    duplicateCandidates: 0,
    duplicateFolders: 0,
    duplicateResultVersions: 0,
    duplicatePdfs: 0,
  }),

  productionReadinessProbes: scenario("TST-120-Q", [
    { action: "production-readiness", case: "healthy-production-personal" },
    { action: "production-readiness", case: "missing-config" },
    { action: "production-readiness", case: "token-envelope-decrypt-fails" },
    { action: "production-readiness", case: "active-owner-missing" },
    { action: "production-readiness", case: "root-read-fails" },
    { action: "production-readiness", case: "root-write-fails" },
    { action: "production-readiness", case: "operator-testing" },
  ], {
    healthyReady: true,
    configProbePassed: true,
    decryptProbePassed: true,
    activeOwnerProbePassed: true,
    rootReadProbePassed: true,
    rootWriteProbePassed: true,
    missingConfigBlocked: true,
    decryptFailureBlocked: true,
    missingOwnerBlocked: true,
    rootReadFailureBlocked: true,
    rootWriteFailureBlocked: true,
    testingProductionCode: "GOOGLE_OAUTH_TESTING_GRANT_NOT_DURABLE",
    staticConfigurationAloneAccepted: false,
  }),
});
