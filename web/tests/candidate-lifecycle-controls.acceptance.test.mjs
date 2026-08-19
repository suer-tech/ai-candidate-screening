import assert from "node:assert/strict";
import test from "node:test";
import { readProductSource } from "./helpers/product-acceptance-harness.mjs";

const model = await import("../app/product-model.ts");
const base = { id: 42, name: "Синтетический кандидат", initials: "СК", vacancyId: "vac-1", vacancy: "Тест", archived: false, stageStartedAt: "2026-08-19T08:00:00.000Z", elapsedMinutes: 4, etaMinutes: null, result: null };

test("TST-089: nine canonical workflow states are exact and separate from recommendation/archive", () => {
  assert.deepEqual(model.WORKFLOW_STATUS, {
    NEW: "Новый", WAITING_FOR_STABILITY: "Ожидание стабильности", MATERIALS_INCOMPLETE: "Недостаточно материалов",
    MATERIALS_READY: "Материалы готовы", TRANSCRIBING: "Транскрибация", ANALYZING: "Анализ",
    VALIDATING: "Проверка результата", READY: "Готово", FAILED: "Ошибка",
  });
  assert.equal(model.isProcessingStatus("VALIDATING"), true);
  assert.equal(model.isProcessingStatus("READY"), false);
  assert.ok(!Object.values(model.WORKFLOW_STATUS).some((label) => /%|рекоменд/i.test(label)));
});

test("TST-090: archive/restore/delete guards are server-authoritative and all outcomes are audited", () => {
  const processing = { ...base, status: "ANALYZING" };
  assert.equal(model.canArchive(processing), false);
  assert.throws(() => model.archiveCandidate(processing), /после завершения/i);
  const ready = { ...base, status: "READY" };
  const archived = model.archiveCandidate(ready);
  assert.equal(archived.archived, true);
  assert.equal(model.restoreCandidate(archived).archived, false);
  const deleteContract = model.deleteCandidate ?? model.deleteArchivedCandidate ?? model.removeCandidateApplicationData;
  const auditedCommand = model.applyLifecycleCommand ?? model.executeCandidateLifecycleCommand ?? model.recordLifecycleAction;
  assert.equal(typeof deleteContract, "function", "Permanent app-data deletion must have an executable domain contract");
  assert.equal(typeof auditedCommand, "function", "archive/restore/delete need actor/outcome audit and idempotent command guards");
});

test("TST-091: manual reprocess permissions, confirmation and stability gate", async () => {
  assert.equal(model.canReprocess({ ...base, status: "READY" }), true);
  assert.equal(model.canReprocess({ ...base, status: "FAILED", automaticRetriesExhausted: false }), false);
  assert.equal(model.canReprocess({ ...base, status: "FAILED", automaticRetriesExhausted: true }), true);
  assert.equal(model.canReprocess({ ...base, status: "READY", archived: true }), false);
  assert.equal(model.canReprocess({ ...base, status: "ANALYZING" }), false);
  const source = await readProductSource();
  assert.match(source, /confirm\([^\n]{0,180}предыдущ[^\n]{0,180}результ/i, "A cancelable warning precedes manual reprocessing");
  assert.match(source, /disabled=\{!canReprocess\(/, "The reprocess control remains visible and disabled during an active run");
  const stabilityContract = model.advanceReprocessAfterStability ?? model.startReprocessAfterStability ?? model.completeCandidateStabilityCheck;
  assert.equal(typeof stabilityContract, "function", "No run may be created before the canonical file-stability check succeeds");
});

test("TST-092: a manual run versions immutable bindings, avoids file-change auto-run and supports safe reuse", () => {
  const versionedRun = model.createVersionedCandidateRun ?? model.createCandidateRunVersion ?? model.startVersionedReprocessRun;
  const stageReuse = model.selectReusableStages ?? model.planReusableWorkflowStages ?? model.reuseCompletedStages;
  assert.equal(typeof versionedRun, "function", "New run/version creation must be observable to acceptance tests");
  assert.equal(typeof stageReuse, "function", "WF-023 safe reuse must be deterministic and testable");
  assert.equal(typeof model.onCandidateDriveFilesChanged, "undefined", "File changes alone must not expose an automatic reprocess command");
});

test("TST-093: out-of-scope demo controls are absent while normative controls remain", async () => {
  const source = await readProductSource();
  assert.doesNotMatch(source, />\s*На следующий этап\s*</);
  assert.doesNotMatch(source, />\s*Аналитика\s*</);
  assert.doesNotMatch(source, /table-tools[^]*?>[^]*?(?:Фильтры|Экспорт)/i);
  assert.doesNotMatch(source, /AI-соответствие|Кандидат отмечен для следующего этапа/);
  assert.match(source, /В архив/);
  assert.match(source, /Архив/);
});
