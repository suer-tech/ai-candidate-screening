import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateRecord } from "../../app/product-model.ts";
import { projectCandidate } from "./dashboard-projection.ts";

const candidate = (overrides: Partial<CandidateRecord> = {}): CandidateRecord => ({ id: 1, name: "Кандидат", initials: "К", vacancyId: "vac-1", vacancy: "Инженер", status: "NEW", archived: false, stageStartedAt: "2026-08-20T00:00:00Z", elapsedMinutes: 0, etaMinutes: null, result: null, ...overrides });

test("server runtime projection maps durable task state to the product stage", () => {
  const runtime = [{ runId: "run", runState: "ACTIVE", lastProgressAt: "2026-08-20T00:00:00Z", taskKey: "transcription", taskState: "RUNNING", attemptCount: 1 }];
  assert.equal(projectCandidate(candidate(), runtime).status, "TRANSCRIBING");
  assert.equal(projectCandidate(candidate(), [{ ...runtime[0], taskKey: "assessment" }]).status, "ANALYZING");
  assert.equal(projectCandidate(candidate(), [{ ...runtime[0], taskKey: "publication" }]).status, "VALIDATING");
});

test("active runtime projects one factual elapsed counter for dashboard and candidate views", () => {
  const runtime = [{ runId: "run", runState: "ACTIVE", startedAt: "2026-08-20T10:00:00Z", lastProgressAt: "2026-08-20T10:07:00Z", taskKey: "assessment", taskState: "RUNNING" }];
  const projected = projectCandidate(candidate({ elapsedMinutes: 1 }), runtime, undefined, new Date("2026-08-20T10:18:59Z"));
  assert.equal(projected.elapsedMinutes, 18, "elapsed time is derived from the current run start, not the stale candidate snapshot");
  assert.equal(projected.stageStartedAt, "2026-08-20T10:00:00Z", "the browser receives the same run start for its live minute counter");
});

test("terminal runtime freezes elapsed time at its last progress timestamp", () => {
  const runtime = [{ runId: "run", runState: "FAILED", startedAt: "2026-08-20T10:00:00Z", lastProgressAt: "2026-08-20T10:12:40Z", taskKey: "assessment", taskState: "FAILED" }];
  const projected = projectCandidate(candidate({ elapsedMinutes: 1 }), runtime, undefined, new Date("2026-08-20T11:00:00Z"));
  assert.equal(projected.elapsedMinutes, 12);
});

test("validated Drive pair projects READY independently of Telegram state", () => {
  const ready = projectCandidate(candidate(), [{ runId: "run", runState: "ACTIVE", lastProgressAt: "2026-08-20T00:10:00Z", taskKey: "notification", taskState: "FAILED", attemptCount: 3 }], {
    runId: "run",
    analysisVersion: 2,
    completedAt: "2026-08-20T00:09:00Z",
    recommendation: "Рекомендовать",
    documents: [
      { id: "result", type: "candidate-results", fileName: "Итоги.pdf", driveFileId: "drive-result" },
      { id: "abc", type: "abc-test", fileName: "ABC.pdf", driveFileId: "drive-abc" },
    ],
  });
  assert.equal(ready.status, "READY");
  assert.equal(ready.result?.version, 2);
  assert.equal(ready.result?.documents.length, 2);
});

test("manual reprocess hides an older published report until the new run publishes its own pair", () => {
  const oldResult = { version: 1, completedAt: "2026-08-20T00:09:00Z", recommendation: "Рекомендовать" as const, summary: "Старый результат", documents: [] as never };
  const oldReport = {
    runId: "run-old", analysisVersion: 1, completedAt: "2026-08-20T00:09:00Z", elapsedMinutes: 9,
    recommendation: "Рекомендовать" as const,
    documents: [
      { id: "result-old", type: "candidate-results" as const, fileName: "Итоги.pdf", driveFileId: "drive-result-old" },
      { id: "abc-old", type: "abc-test" as const, fileName: "ABC.pdf", driveFileId: "drive-abc-old" },
    ],
  };

  const waiting = projectCandidate(candidate({ status: "WAITING_FOR_STABILITY", progressPercent: 100, progressMilestone: "Результат опубликован", result: oldResult }), [], oldReport);
  assert.equal(waiting.status, "WAITING_FOR_STABILITY");
  assert.equal(waiting.result, null, "the old report disappears as soon as reprocess is accepted");
  assert.equal(waiting.progressPercent, 0);

  const active = projectCandidate(candidate({ status: "ANALYZING", result: null }), [
    { runId: "run-new", runState: "ACTIVE", startedAt: "2026-08-20T01:00:00Z", lastProgressAt: "2026-08-20T01:03:00Z", taskKey: "assessment", taskState: "RUNNING" },
  ], oldReport);
  assert.equal(active.status, "ANALYZING");
  assert.equal(active.progressPercent, 70);
  assert.equal(active.result, null, "a report from another run cannot overwrite current progress");

  const current = projectCandidate(candidate({ status: "VALIDATING", result: null }), [
    { runId: "run-new", runState: "ACTIVE", startedAt: "2026-08-20T01:00:00Z", lastProgressAt: "2026-08-20T01:09:00Z", taskKey: "publication", taskState: "SUCCEEDED" },
  ], { ...oldReport, runId: "run-new", analysisVersion: 2 });
  assert.equal(current.status, "READY");
  assert.equal(current.result?.version, 2, "only the current run's published pair restores READY");
});

test("terminal runtime failure and archive are projected without browser inference", () => {
  const failed = projectCandidate(candidate(), [{ runId: "run", runState: "FAILED", lastProgressAt: "2026-08-20T00:00:00Z", taskKey: "documents", taskState: "FAILED", attemptCount: 1, errorCode: "CORRUPT_FILE" }]);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failedStage, "documents");
  assert.equal(failed.failureReason, "Один из файлов повреждён или не может быть прочитан. Замените файл и после стабилизации запустите обработку повторно");
  assert.equal(projectCandidate(candidate({ archived: true, status: "READY" }), [{ runId: "run", runState: "ACTIVE", lastProgressAt: "", taskKey: "assessment", taskState: "RUNNING" }]).status, "READY");
});

test("archived candidate keeps the latest published result instead of reverting to a processing snapshot", () => {
  const archived = projectCandidate(candidate({ archived: true, status: "ANALYZING", result: null }), [], {
    runId: "run-archived",
    analysisVersion: 4,
    completedAt: "2026-08-20T00:18:00Z",
    elapsedMinutes: 18,
    recommendation: "Рекомендовать с оговорками",
    assessment: {
      summary: "Подтверждённый итог сохраняется после архивации.",
      recommendationBasis: "Есть связанные факты.",
      stopFactors: [],
      abc: [{ direction: "Продуктивность", grade: "A", factIds: [] }, { direction: "Инициатива", grade: "B", factIds: [] }],
      competencies: [], risks: [], accessToKe: [], evidence: [],
    },
    documents: [
      { id: "result", type: "candidate-results", fileName: "Итоги.pdf", driveFileId: "drive-result" },
      { id: "abc", type: "abc-test", fileName: "ABC.pdf", driveFileId: "drive-abc" },
    ],
  });
  assert.equal(archived.archived, true);
  assert.equal(archived.status, "READY");
  assert.equal(archived.progressPercent, 100);
  assert.equal(archived.result?.version, 4);
  assert.equal(archived.result?.aiOverview?.abc.length, 2);
});
