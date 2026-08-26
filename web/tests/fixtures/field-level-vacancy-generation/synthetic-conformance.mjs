const evidence = Object.freeze({ synthetic: true, containsSecrets: false, containsRawProviderResponse: false, containsRealPersonalData: false });
const base = Object.freeze({ fixtureSetId: "field-level-vacancy-generation-synthetic-v1", vacancyId: "vacancy-field-generation-001", actorId: "hr-field-generation-001", evidence });

export const supportedFieldOperations = Object.freeze(["Образ результата", "Компетенции", "Стоп-факторы", "Допуск к КЕ"]);
export const syntheticVacancyTitle = "ACCEPT-FIELD-20260825 — Руководитель клиентского сервиса";

export const scenarios = Object.freeze({
  fieldGeneration: {
    ...base, scenarioId: "VAC-042-field-generation", kind: "field-generation", fields: supportedFieldOperations,
    emptyField: "Компетенции", filledField: "Стоп-факторы", generatedText: "Подтверждает навык на наблюдаемых примерах.",
    operations: ["open-empty-field", "request", "cancel-confirmation", "request", "confirm", "double-submit", "resolve-success", "open-filled-field", "simulate-error"],
  },
  promptIsolation: {
    ...base, scenarioId: "VAC-043-vacancy-operation-prompt-isolation", kind: "prompt-isolation", operations: [...supportedFieldOperations, "ABC-критерии"],
    vacancies: [{ vacancyId: "vacancy-prompt-alpha", title: syntheticVacancyTitle }, { vacancyId: "vacancy-prompt-beta", title: "ACCEPT-FIELD-SECOND — Финансовый директор" }],
    editedOperation: "Компетенции", editedPrompt: "## Цель\nСформируй компетенции строго для вакансии ACCEPT-FIELD-20260825 — Руководитель клиентского сервиса.",
  },
  abcGeneration: {
    ...base, scenarioId: "VAC-044-actual-abc-composition", kind: "abc-generation",
    compositions: [
      { id: "mixed", directions: [{ id: "standard-productivity", name: "Продуктивность", origin: "standard" }, { id: "custom-client-care", name: "Забота о клиенте", origin: "custom" }, { id: "standard-autonomy", name: "Автономность", origin: "standard" }] },
      { id: "reduced", directions: [{ id: "custom-one", name: "Переговоры", origin: "custom" }] },
      { id: "zero", directions: [] },
    ],
  },
  allGenerationWarning: {
    ...base, scenarioId: "VAC-045-all-generation-overwrite-warning", kind: "all-generation-warning",
    populatedSections: [...supportedFieldOperations, "ABC-критерии"], operations: ["open", "cancel", "open", "confirm", "resolve"],
  },
  dirtyGuard: {
    ...base, scenarioId: "VAC-046-unified-dirty-navigation-guard", kind: "dirty-guard",
    transitionKinds: ["settings-section", "internal-page", "beforeunload"],
    operations: ["manual-edit", "request-section-transition", "close-dialog", "request-section-transition", "discard", "ai-edit", "request-internal-transition", "save-failure", "save-success", "browser-beforeunload"],
  },
});

export const cases = Object.freeze([
  { fixture: scenarios.fieldGeneration, requirements: ["VAC-042"], title: "each empty profile field generates once into the unsaved draft and preserves state on error", oracle: {
    status: "SUCCEEDED", supportedFields: supportedFieldOperations, confirmationRequired: true, callsBeforeConfirmation: 0, callsAfterCancelledConfirmation: 0, confirmedProviderCalls: 1,
    spinnerVisible: true, repeatedLaunchBlocked: true, selectedFieldOnlyChanged: true, otherFieldsUnchanged: true, abcUnchanged: true, pageReloads: 0, versionsCreated: 0,
    actionHiddenAfterFill: true, actionHiddenForInitiallyFilledField: true, errorPreservesEntireDraft: true, errorVisible: true, retryAvailable: true,
  } },
  { fixture: scenarios.promptIsolation, requirements: ["VAC-043"], title: "five operation prompts are Russian structured vacancy-scoped snapshots used exactly by the LLM request", oracle: {
    status: "SUCCEEDED", operationPrompts: supportedFieldOperations.concat("ABC-критерии"), defaultsRussian: true, defaultsStructured: true, defaultsContainExactVacancyTitle: true,
    promptsStoredSeparatelyByOperation: true, promptsStoredSeparatelyByVacancy: true, editedPromptPersisted: true, unrelatedPromptsUnchanged: true,
    nextLlmRequestContainsExactSavedPrompt: true, promptOccurrencesInRequest: 1, requestVacancyIdMatches: true,
  } },
  { fixture: scenarios.abcGeneration, requirements: ["VAC-044"], title: "one ABC request preserves exact actual standard/custom/reduced composition and skips zero directions", oracle: {
    status: "SUCCEEDED", confirmedRequestsPerNonEmptyComposition: 1, spinnerVisible: true, repeatedLaunchBlocked: true, pageReloads: 0, versionsCreated: 0,
    mixed: { idsPreserved: true, namesPreserved: true, originsPreserved: true, orderPreserved: true, countPreserved: true, gradesFilledAtomically: true },
    reduced: { idsPreserved: true, namesPreserved: true, originsPreserved: true, orderPreserved: true, countPreserved: true, gradesFilledAtomically: true },
    zero: { providerCalls: 0, explainsAddDirectionFirst: true }, responseMismatchApplied: false,
  } },
  { fixture: scenarios.allGenerationWarning, requirements: ["VAC-045"], title: "all-generation warns that every populated section is overwritten and cancellation has no effects", oracle: {
    status: "SUCCEEDED", actionStillAvailable: true, warningBeforeApi: true, warningMentionsAllSections: true, warningMentionsOverwriteExistingValues: true,
    cancelled: { apiCalls: 0, providerCalls: 0, draftChanged: false, versionsCreated: 0 }, confirmed: { apiCalls: 1, spinnerVisible: true, structuredDraftApplied: true, versionsCreated: 0 },
  } },
  { fixture: scenarios.dirtyGuard, requirements: ["VAC-046"], title: "one dirty guard covers settings, internal navigation and beforeunload with discard, save and close semantics", oracle: {
    status: "SUCCEEDED", manualEditMarksDirty: true, generatedEditMarksDirty: true, guardedTransitions: ["settings-section", "internal-page"], beforeUnloadOnlyWhenDirty: true,
    dialog: { discardLabel: "Не сохранять", discardColor: "red", saveLabel: "Сохранить изменения", saveColor: "blue", closeControl: true },
    close: { transitionPerformed: false, draftPreserved: true }, discard: { savedSnapshotRestored: true, transitionPerformed: true, versionsCreated: 0 },
    saveSuccess: { versionsCreated: 1, waitsForSave: true, transitionPerformedAfterSave: true }, saveFailure: { transitionPerformed: false, draftPreserved: true, errorVisible: true },
  } },
]);
