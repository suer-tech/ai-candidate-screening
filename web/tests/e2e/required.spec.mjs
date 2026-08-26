import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2eControlClient } from "./control-client.mjs";
import { readE2eConfig } from "./config.mjs";

const config = readE2eConfig();
const control = new E2eControlClient(config);
const run = {
  id: "",
  prefix: `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`,
  vacancy: null,
  candidate: null,
  resultVersion: 0,
};

const FORBIDDEN_OBSERVATION_METHODS = new Set(["static-grep", "source-scan", "hard-coded", "self-attestation"]);

function assertObservedChecks(evidence, names) {
  expect(evidence?.attestations, "Boolean self-attestations are not acceptance evidence").toBeUndefined();
  for (const name of names) {
    const check = evidence?.checks?.[name];
    expect(check, `Missing observed check: ${name}`).toBeTruthy();
    expect(check.passed, `Observed check failed: ${name}`).toBe(true);
    expect(check.observedAtUtc, `Missing observation time: ${name}`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof check.method, `Missing observation method: ${name}`).toBe("string");
    expect(FORBIDDEN_OBSERVATION_METHODS.has(check.method), `Forbidden observation method: ${name}`).toBe(false);
    expect(check.artifactRefs?.length, `Missing deployed-state artifact references: ${name}`).toBeGreaterThan(0);
    for (const reference of check.artifactRefs) expect(reference).toMatch(/^(?:postgresql|my-drive|provider|http|browser|pdf|outbox|trace):/);
  }
}

async function attachSafeEvidence(testInfo, name, evidence) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
}

async function expectPdf(response, expectedDisposition) {
  expect(response.ok(), `PDF endpoint returned HTTP ${response.status()}`).toBe(true);
  expect(response.headers()["content-type"]?.split(";", 1)[0]).toBe("application/pdf");
  expect(response.headers()["content-disposition"]).toContain(expectedDisposition);
  const body = await response.body();
  expect(body.length).toBeGreaterThan(1_000);
  expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  return { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
}

test.describe.serial("mandatory production acceptance", () => {
  test.beforeAll(async () => {
    const created = await control.request("/runs", {
      method: "POST",
      body: {
        fixtureSetId: config.fixtureSetId,
        buildId: config.buildId,
        environment: config.environment,
        uniquePrefix: run.prefix,
      },
    });
    expect(created.runId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.dataClassification).toBe("synthetic-no-pii-no-secrets");
    expect(created.fixtureSetId).toBe(config.fixtureSetId);
    expect(created.controlContractVersion).toBe("1.1");
    expect(created.uniquePrefix).toBe(run.prefix);
    assertObservedChecks(created, ["freshDriveFolderIds", "freshInternalUuids", "isolatedRunPrefix"]);
    run.id = created.runId;
  });

  test.afterAll(async () => {
    if (!run.id) return;
    const cleanup = await control.request(`/runs/${encodeURIComponent(run.id)}/cleanup`, { method: "POST" });
    expect(cleanup.complete, "E2E cleanup is incomplete").toBe(true);
    assertObservedChecks(cleanup, [
      "applicationDataRemoved",
      "driveDataRemoved",
      "derivedDataRemoved",
      "providerDataRemoved",
      "notificationDataRemoved",
      "temporaryDataRemoved",
      "sourceDriveFolderAbsent",
      "rediscoveryBlockedByTombstone",
    ]);
    expect(cleanup.archiveOnly).toBe(false);
    expect(cleanup.minimalTombstoneContainsPersonalData).toBe(false);
  });

  test("E2E-VAC-001 - create and fully provision a vacancy", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Вакансии", exact: true }).click();
    await page.getByRole("button", { name: /Новая вакансия/ }).click();

    const dialog = page.getByRole("dialog", { name: "Новая вакансия" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Сформировать вакансию" })).toBeVisible();
    await expect(dialog.getByText(/Критерии оценки|Образ результата|ABC-направления|Допуск к КЕ/)).toHaveCount(0);

    await dialog.getByRole("button", { name: "Сформировать вакансию" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/название/i);

    const title = `${run.prefix} Руководитель продукта`;
    await dialog.getByRole("textbox", { name: /Название вакансии/ }).fill(title);
    let generationRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/vacancies/generate") && request.method() === "POST") generationRequests += 1;
    });
    await dialog.getByRole("button", { name: "Сформировать вакансию" }).dblclick();
    await expect(dialog.getByText(/Профиль сформирован LLM/)).toBeVisible();
    expect(generationRequests).toBe(1);
    expect(await dialog.getByRole("textbox").count()).toBeGreaterThan(1);

    const editableProfileField = dialog.getByRole("textbox").nth(1);
    const generatedValue = await editableProfileField.inputValue();
    await editableProfileField.fill(`${generatedValue} — правка HR ${run.prefix}`);
    const directionCount = await dialog.locator(".abc-direction-card").count();
    await dialog.getByRole("button", { name: "Добавить направление" }).click();
    await expect(dialog.locator(".abc-direction-card")).toHaveCount(directionCount + 1);
    const customDirection = dialog.locator(".abc-direction-card").last();
    await customDirection.getByRole("textbox").nth(0).fill(`${run.prefix} Системное мышление`);
    await customDirection.getByRole("textbox").nth(1).fill("A: связывает решения с измеримым результатом");
    await customDirection.getByRole("textbox").nth(2).fill("B: объясняет часть причинно-следственных связей");
    await customDirection.getByRole("textbox").nth(3).fill("C: подтверждает локальные действия без системного результата");
    await dialog.locator(".abc-direction-card").first().getByRole("button", { name: "Удалить направление" }).click();
    await expect(dialog.locator(".abc-direction-card")).toHaveCount(directionCount);

    await dialog.getByRole("button", { name: "Предварительный просмотр" }).click();
    await expect(dialog.getByRole("heading", { name: "Предварительный просмотр" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Сохранить и активировать" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Подтвердить профиль" }).click();
    await expect(dialog.getByRole("button", { name: "Сохранить и активировать" })).toBeVisible();

    const saveResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/vacancies") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Сохранить и активировать" }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status()).toBe(201);
    const payload = await saveResponse.json();
    expect(payload.vacancy?.id).toBeTruthy();
    expect(payload.vacancy?.active).toBe(true);
    expect(payload.vacancy?.version).toBe(1);
    expect(payload.vacancy?.driveFolderId).toBeTruthy();
    run.vacancy = payload.vacancy;
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await control.request(`/runs/${encodeURIComponent(run.id)}/vacancy`, {
      method: "POST",
      body: { vacancyId: run.vacancy.id, version: run.vacancy.version },
    });
    const evidence = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/vacancy`);
    expect(evidence.vacancyId).toBe(run.vacancy.id);
    expect(evidence.profileVersion).toBe(1);
    expect(evidence.driveFolderId).toBe(run.vacancy.driveFolderId);
    assertObservedChecks(evidence, [
      "normalizedTitleUnique",
      "fullProfilePersisted",
      "controlledRouterAiSchemaAccepted",
      "requiredFieldActivationMatrixPassed",
      "hrEditedAbcPersistedInOrder",
      "removedStandardDirectionStayedRemoved",
      "activatedAfterPreviewAndExplicitApproval",
      "generationFailureMatrixPassed",
      "generationDidNotExposeSecretsOrPrompts",
      "driveFolderBound",
      "driveFolderIdempotent",
      "personalOauthReadCreateWithoutMembership",
      "auditRecorded",
      "crossHrAccessAllowed",
      "anonymousAccessRejected",
      "consumerMatrixConsistent",
      "unrelatedEntitiesUnchanged",
    ]);
    await attachSafeEvidence(testInfo, "vacancy-evidence", evidence);
  });

  test("E2E-TRN-001 - transcribe a synthetic two-speaker interview", async ({ request }, testInfo) => {
    expect(run.vacancy?.id).toBeTruthy();
    const seeded = await control.request(`/runs/${encodeURIComponent(run.id)}/candidates`, {
      method: "POST",
      body: { vacancyId: run.vacancy.id, fixtureSetId: config.fixtureSetId },
    });
    expect(seeded.candidateId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    expect(seeded.candidateName).toBeTruthy();
    expect(seeded.driveFolderId).toBeTruthy();
    run.candidate = seeded;

    const terminal = await control.waitFor(run.id, (state) => ["READY", "FAILED"].includes(state.workflowStatus));
    expect(terminal.workflowStatus, terminal.failureCode ?? "candidate processing failed").toBe("READY");
    run.resultVersion = terminal.resultVersion;
    const workspaceResponse = await request.get("/api/workspace");
    expect(workspaceResponse.ok()).toBe(true);
    const workspace = await workspaceResponse.json();
    const storedCandidate = workspace.candidates?.find((candidate) => candidate.id === run.candidate.candidateId);
    expect(storedCandidate?.status).toBe("READY");
    expect(storedCandidate?.vacancyId).toBe(run.vacancy.id);

    const evidence = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/transcript`);
    expect(evidence.candidateId).toBe(run.candidate.candidateId);
    expect(evidence.providerMode).toBe("real");
    expect(evidence.speakerCount).toBe(2);
    expect(evidence.normalizedSchemaVersion).toBe(1);
    expect(evidence.controlPhrases?.length).toBeGreaterThanOrEqual(6);
    for (const phrase of evidence.controlPhrases) {
      expect(phrase.textMatched).toBe(true);
      expect(phrase.speakerMatched).toBe(true);
      expect(phrase.orderMatched).toBe(true);
      expect(phrase.timestampWithinTolerance).toBe(true);
    }
    assertObservedChecks(evidence, [
      "fixtureDigestMatched",
      "knownDurationMatched",
      "alternatingSpeakersMatched",
      "threeRepresentationsParsed",
      "transcriptPersisted",
      "timestampsMonotonic",
      "timestampsWithinMediaDuration",
      "confidenceBoundaryMatched",
      "utteranceConfidenceAggregationMatched",
      "roleMappingEvidenceComplete",
      "ambiguousRoleCasePassed",
      "noAcousticRoleOrNameInference",
      "representationsConsistent",
      "diarizationHasNoSplitMergeOrReorder",
      "realFfmpegUsed",
      "realAssemblyAiUsed",
      "remoteProviderArtifactsRemoved",
      "temporaryAudioRemoved",
      "candidateAndVacancyLinked",
      "folderRenamePreservedCandidateUuid",
      "folderMovePreservedVacancyBinding",
      "folderCopyCreatedDistinctCandidateUuid",
      "duplicateScanDidNotCreateRun",
      "resultsSubtreeExcludedFromInputs",
    ]);
    await attachSafeEvidence(testInfo, "transcript-evidence", evidence);
  });

  test("E2E-ABC-001 - publish an evidence-backed ABC result", async ({ request }, testInfo) => {
    expect(run.candidate?.candidateId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    expect(run.resultVersion).toBeGreaterThan(0);
    const evidence = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/abc`);
    expect(evidence.candidateId).toBe(run.candidate.candidateId);
    expect(evidence.resultVersion).toBe(run.resultVersion);
    expect(evidence.documentType).toBe("abc-test");
    expect(evidence.llmGatewayMode).toBe("deterministic-test-gateway");
    const version = `v${String(run.resultVersion).padStart(4, "0")}`;
    expect(evidence.drivePath).toBe(`Результаты/${version}/ABC-тест — ${run.candidate.candidateName} — ${version}.pdf`);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    assertObservedChecks(evidence, [
      "profileVersionMatched",
      "allAbcDirectionsPresent",
      "customAbcProfileOrderMatched",
      "everyConclusionHasEvidence",
      "textPdfLocatorMatched",
      "scannedPdfLocatorAndOcrMatched",
      "docxLocatorMatched",
      "transcriptLocatorMatched",
      "textPdfBypassedOcr",
      "ocrThresholdIndependentFromStt",
      "singleValidEvidenceAccepted",
      "lowConfidenceEvidenceRejected",
      "contradictionsPreserved",
      "insufficientEvidenceNotInvented",
      "noClickableEvidenceLinks",
      "noCrossEntityData",
      "noOverallScore",
      "protectedTraceComplete",
      "currentVersionOnly",
      "exactlyTwoUserPdfs",
      "rawAndNormalizedAiResponsesImmutable",
      "matrixCompiledOncePerProfileVersion",
      "matrixCriticCleanBeforePublish",
      "matrixHardRequiredOnlyForStopFactorSourceRefs",
      "transcriptCoveredByOverlappingTokenBudgetedBatches",
      "globalConflictsDerivedAcrossAllClaimBatches",
      "allMatrixRowsAssessedAndCriticalRowsVerified",
    ]);

    const response = await request.get(`/api/results?candidate=${run.candidate.candidateId}&type=abc-test&version=${run.resultVersion}`);
    const pdf = await expectPdf(response, "inline");
    expect(evidence.pdfBytes).toBe(pdf.bytes);
    expect(evidence.sha256).toBe(pdf.sha256);
    await attachSafeEvidence(testInfo, "abc-evidence", evidence);
  });

  test("E2E-RESULT-001 - publish, preview and notify the final result", async ({ page, request }, testInfo) => {
    expect(run.candidate?.candidateId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    const evidence = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/result`);
    expect(evidence.candidateId).toBe(run.candidate.candidateId);
    expect(evidence.resultVersion).toBe(run.resultVersion);
    expect(evidence.documentType).toBe("candidate-results");
    expect(["Не рекомендовать", "Недостаточно данных", "Рекомендовать с оговорками", "Рекомендовать"]).toContain(evidence.recommendation);
    const version = `v${String(run.resultVersion).padStart(4, "0")}`;
    expect(evidence.drivePath).toBe(`Результаты/${version}/Итоги по кандидату — ${run.candidate.candidateName} — ${version}.pdf`);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.sectionCount).toBe(15);
    assertObservedChecks(evidence, [
      "requiredSectionsPresent",
      "explicitEmptyStatesPresent",
      "sourceLocatorsComplete",
      "knownStrengthsLimitationsRisksAndGapsMatched",
      "conflictMatrixMatched",
      "recommendationPriorityMatrixMatched",
      "keAdmissionRulesMatched",
      "absoluteTimeRenderedAtUtcPlusFive",
      "relativeInterviewTimeUnchanged",
      "noClickableEvidenceLinks",
      "noLlmPseudoProbability",
      "immutableInUiAndApi",
      "structuredResultAndPdfsConsistent",
      "validPublishedPair",
      "telegramDelivered",
      "telegramDirectLinkTargetsCandidate",
      "notificationContainsNoPii",
      "protectedTraceComplete",
      "matrixV2WorkflowVersionFrozenForRun",
      "unmappedSignalsStayedInformationalByDefault",
      "criticalUnmappedRiskIndependentlyVerified",
      "unverifiedCriticalRiskDidNotChangeRecommendation",
      "dashboardUsesCurrentSuccessfulVersion",
      "telegramUsesSingleBotAndServerRecipients",
      "telegramSentEventNotDuplicated",
      "telegramFailedRecipientRetryIndependent",
      "telegramRecipientIdsNotExposed",
    ]);

    const publication = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/report-publication`, { method: "POST" });
    assertObservedChecks(publication, ["sameChecksumsReuseFileIds", "occupiedPathConflictReturned", "conflictingFileNotOverwritten"]);
    expect(publication.conflictCode).toBe("REPORT_VERSION_CONFLICT");

    const resultResponse = await request.get(`/api/results?candidate=${run.candidate.candidateId}&type=candidate-results&version=${run.resultVersion}`);
    const resultPdf = await expectPdf(resultResponse, "inline");
    expect(evidence.pdfBytes).toBe(resultPdf.bytes);
    expect(evidence.sha256).toBe(resultPdf.sha256);
    const resultDownload = await request.get(`/api/results?candidate=${run.candidate.candidateId}&type=candidate-results&version=${run.resultVersion}&download=1`);
    await expectPdf(resultDownload, "attachment");
    const abcDownload = await request.get(`/api/results?candidate=${run.candidate.candidateId}&type=abc-test&version=${run.resultVersion}&download=1`);
    await expectPdf(abcDownload, "attachment");

    await page.goto("/");
    await page.getByRole("button", { name: "Кандидаты", exact: true }).click();
    await page.getByRole("button", { name: `Открыть карточку ${run.candidate.candidateName}` }).click();
    await page.getByRole("button", { name: "Итоги", exact: true }).click();
    const resultDialog = page.getByRole("dialog", { name: "Просмотр документа Итоги" });
    await expect(resultDialog).toBeVisible();
    await expect(resultDialog.getByRole("link", { name: "Скачать Итоги" })).toBeVisible();
    await resultDialog.getByRole("button", { name: "Закрыть" }).first().click();
    await expect(page.getByRole("heading", { name: run.candidate.candidateName })).toBeVisible();

    await page.getByRole("button", { name: "ABC-тест", exact: true }).click();
    const abcDialog = page.getByRole("dialog", { name: "Просмотр документа ABC-тест" });
    await expect(abcDialog).toBeVisible();
    await expect(abcDialog.getByRole("link", { name: "Скачать ABC-тест" })).toBeVisible();
    await abcDialog.getByRole("button", { name: "Закрыть" }).first().click();
    await attachSafeEvidence(testInfo, "result-evidence", evidence);
    await attachSafeEvidence(testInfo, "publication-evidence", publication);

    const versioning = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/versioning`);
    assertObservedChecks(versioning, [
      "activeRunUsesFrozenInputSnapshot",
      "fileChangeDoesNotAutoStartRun",
      "hrSeesInputChange",
      "manualRunUsesLatestStableInput",
      "previousResultNotOverwritten",
    ]);
    const failures = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/failure-matrix`);
    assertObservedChecks(failures, [
      "timeoutsAndAttemptLimitsMatched",
      "transientErrorsRetriedWithBackoff",
      "permanentErrorsNotRetried",
      "failedStageCodeAndAttemptsPersisted",
      "missingAndUnprocessableMaterialsDiffer",
      "noPartialPublicationOrSuccessNotification",
      "replacementRequiresManualStableReprocess",
      "notificationFailureKeepsReady",
      "driveErrorIntervalDidNotCountAsStable",
      "threeFullStableIntervalsRequired",
      "stabilityResetOnSizeOrCountChange",
      "unsupportedSchemaFailedInValidating",
      "retryReusedExpensiveArtifacts",
    ]);
    const comparison = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/comparison`);
    assertObservedChecks(comparison, [
      "twoCandidatesComparedInHrOrder",
      "threeCandidatesComparedInHrOrder",
      "normativeSectionOrderMatched",
      "everyDifferenceHasEvidenceLocator",
      "noOverallScoreRankingOrWinner",
      "differentVacanciesBlocked",
      "differentProfileVersionsBlocked",
      "explicitReanalysisEnabledComparison",
      "previousAnalysesStayedImmutable",
    ]);
    const lifecycle = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/lifecycle`);
    assertObservedChecks(lifecycle, [
      "readyResultReadOnlyInUiAndApi",
      "directMutationRejectedWithoutChecksumChange",
      "hrDecisionDidNotOverwriteRecommendation",
      "archiveHidCandidateAndStoppedAutomation",
      "restoreDidNotStartAnalysis",
      "deleteCascadeRemovedDerivedData",
      "tombstonePreventedRediscovery",
    ]);
    const metadata = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/run`);
    expect(metadata.buildId).toBe(config.buildId);
    expect(metadata.environment).toBe(config.environment);
    expect(metadata.fixtureSetId).toBe(config.fixtureSetId);
    expect(metadata.startedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(metadata.finishedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    assertObservedChecks(metadata, [
      "modelsAndProvidersRecorded",
      "promptAndSchemaVersionsRecorded",
      "migrationChainRecorded",
      "inputAndArtifactDigestsRecorded",
      "stageDurationsUseMonotonicTime",
      "readyAndNotificationTimingRecorded",
      "allConsumerMatrixRowsResolved",
      "evidenceContainsNoSecretsOrRealPii",
      "oneBuildAndConfigurationForAllFourTests",
      "displayTimezoneUtcPlusFiveMatchedStoredUtc",
      "thirtyMinuteTargetWasMetricOnly",
      "etaSampleRulesMatched",
    ]);
    await attachSafeEvidence(testInfo, "versioning-evidence", versioning);
    await attachSafeEvidence(testInfo, "failure-matrix-evidence", failures);
    await attachSafeEvidence(testInfo, "comparison-evidence", comparison);
    await attachSafeEvidence(testInfo, "lifecycle-evidence", lifecycle);
    await attachSafeEvidence(testInfo, "run-metadata", metadata);
  });
});
