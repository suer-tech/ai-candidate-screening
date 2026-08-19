import { randomUUID } from "node:crypto";
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

function assertAttestations(evidence, names) {
  for (const name of names) expect(evidence?.attestations?.[name], `Missing attestation: ${name}`).toBe(true);
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
  return body.length;
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
    run.id = created.runId;
  });

  test.afterAll(async () => {
    if (!run.id) return;
    const cleanup = await control.request(`/runs/${encodeURIComponent(run.id)}/cleanup`, { method: "POST" });
    expect(cleanup.complete, "E2E cleanup is incomplete").toBe(true);
    expect(cleanup.applicationDataRemoved).toBe(true);
    expect(cleanup.driveDataRemoved).toBe(true);
    expect(cleanup.derivedDataRemoved).toBe(true);
    expect(cleanup.providerDataRemoved).toBe(true);
  });

  test("E2E-VAC-001 - create and fully provision a vacancy", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Вакансии", exact: true }).click();
    await page.getByRole("button", { name: /Новая вакансия/ }).click();

    const dialog = page.getByRole("dialog", { name: "Новая вакансия" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: /Сформировать|черновик|Предпросмотр|Активировать/i })).toHaveCount(0);

    const title = `${run.prefix} Руководитель продукта`;
    await dialog.getByRole("textbox", { name: /Название вакансии/ }).fill(title);
    await dialog.getByRole("button", { name: "Продолжить" }).click();
    await expect(dialog.getByRole("button", { name: "Сохранить вакансию" })).toBeVisible();
    expect(await dialog.getByRole("textbox").count()).toBeGreaterThan(1);

    const saveResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/vacancies") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Сохранить вакансию" }).click();
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
    assertAttestations(evidence, [
      "normalizedTitleUnique",
      "fullProfilePersisted",
      "standardAbcPersisted",
      "activeImmediately",
      "driveFolderBound",
      "driveFolderIdempotent",
      "auditRecorded",
      "crossHrAccessAllowed",
      "anonymousAccessRejected",
      "consumerMatrixConsistent",
    ]);
    await attachSafeEvidence(testInfo, "vacancy-evidence", evidence);
  });

  test("E2E-TRN-001 - transcribe a synthetic two-speaker interview", async ({ request }, testInfo) => {
    expect(run.vacancy?.id).toBeTruthy();
    const seeded = await control.request(`/runs/${encodeURIComponent(run.id)}/candidates`, {
      method: "POST",
      body: { vacancyId: run.vacancy.id, fixtureSetId: config.fixtureSetId },
    });
    expect(seeded.candidateId).toBeGreaterThan(0);
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
    assertAttestations(evidence, [
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
      "candidateAndVacancyLinked",
    ]);
    await attachSafeEvidence(testInfo, "transcript-evidence", evidence);
  });

  test("E2E-ABC-001 - publish an evidence-backed ABC result", async ({ request }, testInfo) => {
    expect(run.candidate?.candidateId).toBeGreaterThan(0);
    expect(run.resultVersion).toBeGreaterThan(0);
    const evidence = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/abc`);
    expect(evidence.candidateId).toBe(run.candidate.candidateId);
    expect(evidence.resultVersion).toBe(run.resultVersion);
    expect(evidence.documentType).toBe("abc-test");
    expect(evidence.llmGatewayMode).toBe("deterministic-test-gateway");
    const version = `v${String(run.resultVersion).padStart(4, "0")}`;
    expect(evidence.drivePath).toBe(`Результаты/${version}/ABC-тест — ${run.candidate.candidateName} — ${version}.pdf`);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    assertAttestations(evidence, [
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
    ]);

    const response = await request.get(`/api/results?candidate=${run.candidate.candidateId}&type=abc-test&version=${run.resultVersion}`);
    const pdfBytes = await expectPdf(response, "inline");
    expect(evidence.pdfBytes).toBe(pdfBytes);
    await attachSafeEvidence(testInfo, "abc-evidence", evidence);
  });

  test("E2E-RESULT-001 - publish, preview and notify the final result", async ({ page, request }, testInfo) => {
    expect(run.candidate?.candidateId).toBeGreaterThan(0);
    const evidence = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/result`);
    expect(evidence.candidateId).toBe(run.candidate.candidateId);
    expect(evidence.resultVersion).toBe(run.resultVersion);
    expect(evidence.documentType).toBe("candidate-results");
    expect(["Не рекомендовать", "Недостаточно данных", "Рекомендовать с оговорками", "Рекомендовать"]).toContain(evidence.recommendation);
    const version = `v${String(run.resultVersion).padStart(4, "0")}`;
    expect(evidence.drivePath).toBe(`Результаты/${version}/Итоги по кандидату — ${run.candidate.candidateName} — ${version}.pdf`);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    assertAttestations(evidence, [
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
      "dashboardUsesCurrentSuccessfulVersion",
    ]);

    const publication = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/report-publication`, { method: "POST" });
    assertAttestations(publication, ["sameChecksumsReuseFileIds", "occupiedPathConflictReturned", "conflictingFileNotOverwritten"]);
    expect(publication.conflictCode).toBe("REPORT_VERSION_CONFLICT");

    const resultResponse = await request.get(`/api/results?candidate=${run.candidate.candidateId}&type=candidate-results&version=${run.resultVersion}`);
    const resultPdfBytes = await expectPdf(resultResponse, "inline");
    expect(evidence.pdfBytes).toBe(resultPdfBytes);
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
    assertAttestations(versioning, [
      "activeRunUsesFrozenInputSnapshot",
      "fileChangeDoesNotAutoStartRun",
      "hrSeesInputChange",
      "manualRunUsesLatestStableInput",
      "previousResultNotOverwritten",
    ]);
    const failures = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/failure-matrix`);
    assertAttestations(failures, [
      "timeoutsAndAttemptLimitsMatched",
      "transientErrorsRetriedWithBackoff",
      "permanentErrorsNotRetried",
      "failedStageCodeAndAttemptsPersisted",
      "missingAndUnprocessableMaterialsDiffer",
      "noPartialPublicationOrSuccessNotification",
      "replacementRequiresManualStableReprocess",
      "notificationFailureKeepsReady",
    ]);
    const metadata = await control.request(`/runs/${encodeURIComponent(run.id)}/evidence/run`);
    expect(metadata.buildId).toBe(config.buildId);
    expect(metadata.environment).toBe(config.environment);
    expect(metadata.fixtureSetId).toBe(config.fixtureSetId);
    expect(metadata.startedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(metadata.finishedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    assertAttestations(metadata, [
      "modelsAndProvidersRecorded",
      "promptAndSchemaVersionsRecorded",
      "migrationChainRecorded",
      "inputAndArtifactDigestsRecorded",
      "stageDurationsUseMonotonicTime",
      "readyAndNotificationTimingRecorded",
      "allConsumerMatrixRowsResolved",
      "evidenceContainsNoSecretsOrRealPii",
    ]);
    await attachSafeEvidence(testInfo, "versioning-evidence", versioning);
    await attachSafeEvidence(testInfo, "failure-matrix-evidence", failures);
    await attachSafeEvidence(testInfo, "run-metadata", metadata);
  });
});
