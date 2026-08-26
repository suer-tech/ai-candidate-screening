const evidence = { synthetic: true, containsSecrets: false, containsRawProviderResponse: false, containsRealPersonalData: false };
const title = "ACCEPT-VAC-20260820 — Бизнес ассистент";
const operationId = "vacancy-generation-op-synthetic-001";
const finalSaveOperationId = "vacancy-final-save-op-synthetic-001";
const base = { title, operationId, evidence };

export const scenarios = {
  normalizedTitlePreflight: { ...base, scenarioId: "TST-086-normalized-title-preflight", existingTitles: ["Бизнес ассистент"], title: "  бизнес   ассистент ", expectedNormalizedTitle: "бизнес ассистент" },
  successOnEveryAllowedAttempt: { ...base, scenarioId: "TST-086-success-on-attempts-1-2-3-4", cases: [1, 2, 3, 4].map((successAttempt) => ({ successAttempt, responses: Array.from({ length: successAttempt }, (_, index) => index + 1 === successAttempt ? "valid-structured-profile" : "timeout") })) },
  editorLifecycle: { ...base, scenarioId: "TST-086-editor-reset-discard", operations: ["generate-valid-profile", "edit-hr-decision-marker", "reset", "edit", "discard", "reload"] },
  previewConfirmation: { ...base, scenarioId: "TST-086-preview-exact-snapshot", expectedConfirmedHash: "sha256:synthetic-generated-profile-v1", expectedEditedHash: "sha256:synthetic-hr-edited-profile-v2", operations: ["preview", "confirm", "edit", "attempt-final-save", "preview", "confirm"] },
  retryableFailureMatrix: { ...base, scenarioId: "TST-087-retryable-failure-matrix", failureKinds: ["timeout", "network", "http-429", "http-500", "http-503", "invalid-structured-output"], expectedAttempts: 4 },
  nonRetryableFailureMatrix: { ...base, scenarioId: "TST-087-non-retryable-auth-config", failureKinds: ["authentication", "configuration"], forbiddenEvidence: ["provider-api-key-synthetic", "raw-provider-body", "internal-system-instruction"] },
  duplicateGenerationClick: { ...base, scenarioId: "TST-087-duplicate-generation-click", concurrentClicks: 2, providerResponse: "valid-structured-profile" },
  terminalGenerationFailure: { ...base, scenarioId: "TST-087-terminal-generation-failure", responses: ["timeout", "network", "http-429", "invalid-structured-output"] },
  manualRetryAfterTerminalFailure: { ...base, scenarioId: "TST-087-manual-retry-after-terminal", failedResponses: ["timeout", "timeout", "timeout", "timeout"], retryResponse: "valid-structured-profile" },
  idempotentFinalSave: { ...base, scenarioId: "TST-088-idempotent-final-save", operationId: finalSaveOperationId, requests: 2, confirmedSnapshotHash: "sha256:synthetic-hr-edited-profile-v2" },
  noDriveDuringGeneration: { ...base, scenarioId: "TST-088-no-drive-during-generation", generationResponses: ["timeout", "network", "invalid-structured-output", "valid-structured-profile"], finalSaveOperationId },
  timeoutAfterFolderCreate: { ...base, scenarioId: "TST-088-timeout-after-folder-create", operationId: finalSaveOperationId, expectedFolderId: "drive-folder-synthetic-001", firstResponse: "timeout-after-effect", retryResponse: "reconcile-existing-binding" },
  terminalDriveFailure: { ...base, scenarioId: "TST-088-terminal-drive-failure", operationId: finalSaveOperationId, driveResponses: ["timeout", "timeout", "timeout"] },
};
