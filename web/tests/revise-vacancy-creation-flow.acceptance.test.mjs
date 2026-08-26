import assert from "node:assert/strict";
import test from "node:test";
import { scenarios } from "./fixtures/vacancy-creation/synthetic-conformance.mjs";
import { equal, every, includes, runVacancyCreationScenario, verify } from "./helpers/vacancy-creation-conformance-harness.mjs";
import { findAll, loadProductUiHarness, textContent } from "./helpers/product-acceptance-harness.mjs";

function accept(result, checks) {
  const failures = verify(result, [
    equal("evidence.synthetic", true),
    equal("evidence.containsSecrets", false),
    equal("evidence.containsRawProviderResponse", false),
    equal("evidence.containsRealPersonalData", false),
    ...checks,
  ]);
  assert.equal(failures.length, 0, failures.join("\n"));
}

test("TST-086: first step exposes manual title and explicit generation only", async (t) => {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const tree = runtime.create("CreateVacancy", {
    existing: { vacancies: [], operationBindings: {} }, onClose() {}, onCreated() {},
  }).render();
  const fields = findAll(tree, (node) => node.type === "input" || node.type === "textarea");
  const buttons = findAll(tree, (node) => node.type === "button").map(textContent).map((value) => value.trim());
  assert.equal(fields.length, 1, "first step must expose exactly one profile field: vacancy title");
  assert.ok(buttons.includes("Сформировать вакансию"), `expected explicit generation action; buttons=${JSON.stringify(buttons)}`);
  assert.doesNotMatch(textContent(tree), /Критерии оценки|ABC-профиль|Образ результата|Компетенции|Стоп-факторы|Допуск к КЕ/);
});

test("TST-086: normalized uniqueness is enforced server-side before the first LLM call", async () => {
  const result = await runVacancyCreationScenario(scenarios.normalizedTitlePreflight);
  accept(result, [equal("status", "REJECTED"), equal("error.code", "VACANCY_TITLE_DUPLICATE"),
    equal("title.original", "  бизнес   ассистент "), equal("title.normalized", "бизнес ассистент"),
    equal("llm.calls", 0), equal("drive.calls", 0), equal("persistence.vacancies", 0),
    equal("persistence.versions", 0), equal("persistence.drafts", 0)]);
});

test("TST-086: valid structured output succeeds on attempts 1, 2, 3 and 4 with one operation ID", async () => {
  const result = await runVacancyCreationScenario(scenarios.successOnEveryAllowedAttempt);
  accept(result, [equal("status", "SUCCEEDED"), equal("cases.length", 4),
    every("cases", "each allowed success attempt must open one editor from the valid LLM snapshot", (item, index) => item.successAttempt === index + 1
      && item.calls === index + 1 && item.operationIds.length === index + 1 && new Set(item.operationIds).size === 1
      && item.editorOpenCount === 1 && item.validStructuredProfile === true
      && item.manualInterventionBetweenAttempts === false && item.driveCalls === 0)]);
});

test("TST-086: editor exists only after valid LLM output and reset/discard stay session-only", async () => {
  const result = await runVacancyCreationScenario(scenarios.editorLifecycle);
  accept(result, [equal("status", "SUCCEEDED"), equal("beforeValidResponse.editorAvailable", false),
    equal("afterValidResponse.editorAvailable", true), equal("afterValidResponse.source", "LLM_STRUCTURED_PROFILE"),
    equal("hrDecisionMarkers.editable", true), equal("reset.confirmed", true),
    equal("reset.matchesLastValidLlmSnapshot", true), equal("reset.additionalLlmCalls", 0),
    equal("discard.confirmationShown", true), equal("discard.unsavedStateCleared", true),
    equal("reload.unsavedStatePresent", false), equal("persistence.vacancies", 0),
    equal("persistence.versions", 0), equal("persistence.drafts", 0)]);
});

test("TST-086: preview confirms the exact snapshot and any edit invalidates confirmation", async () => {
  const result = await runVacancyCreationScenario(scenarios.previewConfirmation);
  accept(result, [equal("status", "SUCCEEDED"), includes("preview.sections", ["assessmentRules", "reportStructure"]),
    equal("confirmation.snapshotHash", scenarios.previewConfirmation.expectedConfirmedHash), equal("confirmation.explicit", true),
    equal("afterEdit.confirmationValid", false), equal("afterEdit.finalSaveAllowed", false),
    equal("afterRepreview.confirmationValid", true), equal("afterRepreview.snapshotHash", scenarios.previewConfirmation.expectedEditedHash)]);
});

test("TST-087: timeout/network/429/5xx/invalid output use initial plus three retries", async () => {
  const result = await runVacancyCreationScenario(scenarios.retryableFailureMatrix);
  accept(result, [equal("status", "TERMINAL_FAILURES_OBSERVED"),
    includes("failureKinds", ["timeout", "network", "http-429", "http-500", "http-503", "invalid-structured-output"]),
    every("cases", "every retryable failure must perform exactly four calls with one stable operation ID", (item) => item.attempts === 4
      && item.operationIds.length === 4 && new Set(item.operationIds).size === 1
      && item.automaticRetries === 3 && item.manualInterventionBetweenAttempts === false)]);
});

test("TST-087: auth/config failure is immediate and safe", async () => {
  const result = await runVacancyCreationScenario(scenarios.nonRetryableFailureMatrix);
  accept(result, [equal("status", "TERMINAL_FAILURES_OBSERVED"), includes("failureKinds", ["authentication", "configuration"]),
    every("cases", "auth/config failures must stop after one attempt", (item) => item.attempts === 1
      && item.automaticRetries === 0 && item.error.safe === true
      && item.error.rawExposed === false && item.error.secretExposed === false)]);
});

test("TST-087: duplicate click joins one active generation operation", async () => {
  const result = await runVacancyCreationScenario(scenarios.duplicateGenerationClick);
  accept(result, [equal("status", "SUCCEEDED"), equal("clicks", 2), equal("generationOperations", 1),
    equal("parallelProviderCalls", 1), equal("operationIds.length", 1),
    equal("ui.submitDisabledWhilePending", true), equal("ui.currentAttemptVisible", true)]);
});

test("TST-087: terminal generation failure has a safe retry action and no fallback or persistent artifacts", async () => {
  const result = await runVacancyCreationScenario(scenarios.terminalGenerationFailure);
  accept(result, [equal("status", "FAILED"), equal("attempts", 4), equal("ui.titleRetainedInSession", true),
    equal("ui.retryAction", "Повторить генерацию"), equal("ui.messageMentionsAttemptCount", true),
    equal("ui.messageIsUnderstandable", true), equal("ui.rawProviderResponseExposed", false),
    equal("ui.secretExposed", false), equal("ui.editorAvailable", false), equal("ui.manualTemplateAvailable", false),
    equal("persistence.vacancies", 0), equal("persistence.versions", 0), equal("persistence.drafts", 0), equal("drive.calls", 0)]);
});

test("TST-087: manual retry after terminal failure starts a new operation without reviving failed state", async () => {
  const result = await runVacancyCreationScenario(scenarios.manualRetryAfterTerminalFailure);
  accept(result, [equal("status", "SUCCEEDED"), equal("failedOperation.attempts", 4),
    equal("retryOperation.startedExplicitly", true), equal("retryOperation.reusedFailedOperationId", false),
    equal("retryOperation.titlePreserved", true), equal("retryOperation.editorOpenCount", 1),
    equal("persistence.vacanciesBeforeFinalSave", 0), equal("drive.callsBeforeFinalSave", 0)]);
});

test("TST-088: final save is idempotent and publishes one active v1 only after complete confirmation and binding", async () => {
  const result = await runVacancyCreationScenario(scenarios.idempotentFinalSave);
  accept(result, [equal("status", "SUCCEEDED"), equal("requests", 2), equal("operationIds.length", 2),
    equal("operationIds.0", scenarios.idempotentFinalSave.operationId), equal("operationIds.1", scenarios.idempotentFinalSave.operationId),
    equal("outcome.vacancies", 1), equal("outcome.versions", 1), equal("outcome.version", 1),
    equal("outcome.activeVacancies", 1), equal("outcome.driveFolders", 1), equal("outcome.driveBindings", 1),
    equal("outcome.persistedHrEdits", true), equal("outcome.availableToIntakeAfterCommit", true),
    equal("outcome.availableToAnalysisAfterCommit", true)]);
});

test("TST-088: generation and all generation retries make zero Drive calls", async () => {
  const result = await runVacancyCreationScenario(scenarios.noDriveDuringGeneration);
  accept(result, [equal("status", "SUCCEEDED"), equal("generation.attempts", 4), equal("generation.driveCalls", 0),
    equal("beforePreview.driveCalls", 0), equal("afterPreviewBeforeConfirmation.driveCalls", 0),
    equal("afterConfirmationBeforeFinalSave.driveCalls", 0), equal("finalSave.driveCalls", 1)]);
});

test("TST-088: timeout after folder creation recovers the same binding without duplicates", async () => {
  const result = await runVacancyCreationScenario(scenarios.timeoutAfterFolderCreate);
  accept(result, [equal("status", "SUCCEEDED"), equal("firstResponse", "TIMEOUT_AFTER_FOLDER_CREATE"),
    equal("retry.safe", true), equal("retry.reconciledBeforeCreate", true),
    equal("retry.folderId", scenarios.timeoutAfterFolderCreate.expectedFolderId), equal("outcome.vacancies", 1),
    equal("outcome.versions", 1), equal("outcome.driveFolders", 1), equal("outcome.driveBindings", 1),
    equal("outcome.activeVacancies", 1)]);
});

test("TST-088: terminal Drive failure never exposes a partial active vacancy", async () => {
  const result = await runVacancyCreationScenario(scenarios.terminalDriveFailure);
  accept(result, [equal("status", "FAILED"), equal("ui.safeRetryAvailable", true), equal("ui.messageIsUnderstandable", true),
    equal("outcome.activeVacancies", 0), equal("outcome.intakeVisibleVacancies", 0),
    equal("outcome.analysisVisibleVacancies", 0), equal("outcome.duplicateVacancies", 0),
    equal("outcome.duplicateVersions", 0), equal("outcome.duplicateFolders", 0)]);
});
