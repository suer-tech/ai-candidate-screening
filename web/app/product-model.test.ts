import assert from "node:assert/strict";
import test from "node:test";
import { archiveCandidate, beginManualReprocess, buildDashboardSnapshot, createVacancyAtomically, mergeCandidateLifecycleProjection, normalizeVacancyTitle, validateResultPair, type CandidateRecord, type VacancyCreateInput } from "./product-model";

const profile = { "Образ результата": "Результат", "Компетенции": "Правила и признаки", "Стоп-факторы": "Условие и доказательство", "Допуск к КЕ": "Обязательный пункт" };
const input: VacancyCreateInput = { operationId: "op-1", title: "  Бизнес   ассистент ", profile, templateVersion: "abc-standard-v1", abcDirections: [{ id: "a", name: "Продуктивность", gradeA: "A", gradeB: "B", gradeC: "C", origin: "standard" }] };

test("vacancy creation normalizes title and is idempotent", () => {
  assert.equal(normalizeVacancyTitle(input.title), "бизнес ассистент");
  const first = createVacancyAtomically({ vacancies: [], operationBindings: {} }, input);
  const retry = createVacancyAtomically(first.state, input);
  assert.equal(retry.vacancy.id, first.vacancy.id);
  assert.equal(retry.state.vacancies.length, 1);
  assert.equal(retry.vacancy.driveFolderId, "drive-folder-vac-0001");
});

test("processing candidate cannot be archived and ready reprocess hides result", () => {
  const candidate = { id: 1, name: "Тест", initials: "Т", vacancyId: "vac-1", vacancy: "Тест", status: "ANALYZING", archived: false, stageStartedAt: new Date().toISOString(), elapsedMinutes: 1, etaMinutes: null, result: null } satisfies CandidateRecord;
  assert.throws(() => archiveCandidate(candidate), /после завершения/);
  const ready = { ...candidate, status: "READY", result: { version: 1, completedAt: new Date().toISOString(), summary: "Итог", recommendation: "Рекомендовать", documents: [{ id: "r1", type: "candidate-results", fileName: "Итоги.pdf", version: 1, candidateId: 1, vacancyId: "vac-1", published: true, valid: true }, { id: "r2", type: "abc-test", fileName: "ABC.pdf", version: 1, candidateId: 1, vacancyId: "vac-1", published: true, valid: true }] } } satisfies CandidateRecord;
  assert.equal(validateResultPair(ready), true);
  assert.equal(beginManualReprocess(ready).result, null);
});

test("new vacancy write contract has no requirements while legacy records remain readable", () => {
  const current = createVacancyAtomically({ vacancies: [], operationBindings: {} }, input).vacancy;
  assert.equal(current.requirements, undefined);
  const legacy = { ...current, requirements: [{ id: "req-1", text: "Старое требование", required: true, hardRequired: true }] };
  assert.equal(legacy.requirements[0]?.hardRequired, true);
});

test("archive and restore responses cannot erase an already projected published result", () => {
  const current = {
    id: 7, name: "Архивный", initials: "А", vacancyId: "vac-1", vacancy: "Тест", archived: true, status: "READY",
    stageStartedAt: "2026-08-19T08:00:00.000Z", elapsedMinutes: 18, etaMinutes: 0, progressPercent: 100, progressMilestone: "Результат опубликован",
    result: { version: 2, completedAt: "2026-08-19T08:18:00.000Z", summary: "Итог", recommendation: "Рекомендовать", documents: [
      { id: "r1", type: "candidate-results", fileName: "Итоги.pdf", version: 2, candidateId: 7, vacancyId: "vac-1", published: true, valid: true },
      { id: "r2", type: "abc-test", fileName: "ABC.pdf", version: 2, candidateId: 7, vacancyId: "vac-1", published: true, valid: true },
    ] },
  } satisfies CandidateRecord;
  const sparseRestore = { ...current, archived: false, result: null, progressPercent: undefined, progressMilestone: undefined } satisfies CandidateRecord;
  const restored = mergeCandidateLifecycleProjection(current, sparseRestore, "restore");
  assert.equal(restored.archived, false);
  assert.equal(restored.status, "READY");
  assert.equal(restored.progressPercent, 100);
  assert.equal(restored.result?.version, 2);

  const reprocessed = mergeCandidateLifecycleProjection(current, { ...sparseRestore, status: "WAITING_FOR_STABILITY" }, "reprocess");
  assert.equal(reprocessed.status, "WAITING_FOR_STABILITY");
  assert.equal(reprocessed.result, null);
});

test("dashboard excludes archived and latest failed result", () => {
  const base = { id: 1, name: "Тест", initials: "Т", vacancyId: "vac-1", vacancy: "Тест", archived: false, stageStartedAt: "2026-08-19T08:00:00.000Z", elapsedMinutes: 1, etaMinutes: null, result: null };
  const failed = { ...base, status: "FAILED", automaticRetriesExhausted: true } satisfies CandidateRecord;
  const snapshot = buildDashboardSnapshot([failed, { ...base, id: 2, archived: true, status: "READY" } as CandidateRecord], [{ ...createVacancyAtomically({ vacancies: [], operationBindings: {} }, { ...input, title: "Тест" }).vacancy, id: "vac-1" }], 7, new Date("2026-08-19T10:00:00Z"));
  assert.equal(snapshot.counts.FAILED, 1);
  assert.equal("WAITING_FOR_STABILITY" in snapshot.counts, false);
  assert.equal("PROCESSING" in snapshot.counts, false);
  assert.equal(snapshot.archivedCandidates, 1);
  assert.equal("activeVacancies" in snapshot, false);
  assert.equal(snapshot.ready.length, 0);
  assert.equal(snapshot.queue[0].id, 1);
});

test("dashboard period uses inclusive UTC+5 calendar boundaries independent of process timezone", () => {
  const ready = { id: 2, name: "Граница", initials: "Г", vacancyId: "vac-1", vacancy: "Тест", archived: false, status: "READY", stageStartedAt: "2026-08-19T08:00:00.000Z", elapsedMinutes: 1, etaMinutes: 0, result: { version: 1, completedAt: "2026-08-18T19:00:00.000Z", summary: "Итог", recommendation: "Рекомендовать", documents: [{ id: "r1", type: "candidate-results", fileName: "Итоги.pdf", version: 1, candidateId: 2, vacancyId: "vac-1", published: true, valid: true }, { id: "r2", type: "abc-test", fileName: "ABC.pdf", version: 1, candidateId: 2, vacancyId: "vac-1", published: true, valid: true }] } } satisfies CandidateRecord;
  const activeVacancy = { ...createVacancyAtomically({ vacancies: [], operationBindings: {} }, { ...input, title: "Граница" }).vacancy, id: "vac-1" };
  const snapshot = buildDashboardSnapshot([ready], [activeVacancy], 7, new Date("2026-08-19T18:59:59.000Z"));
  assert.equal(snapshot.ready.length, 1);
  const outside = buildDashboardSnapshot([{ ...ready, result: { ...ready.result, completedAt: "2026-08-12T18:59:59.999Z" } }], [activeVacancy], 7, new Date("2026-08-19T18:59:59.000Z"));
  assert.equal(outside.ready.length, 0);
});
