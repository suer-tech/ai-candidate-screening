import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findAll, loadProductUiHarness, readProductSource, textContent } from "./helpers/product-acceptance-harness.mjs";

const model = await import("../app/product-model.ts");
const base = { id: 42, name: "Синтетический кандидат", initials: "СК", vacancyId: "vac-1", vacancy: "Тест", archived: false, stageStartedAt: "2026-08-19T08:00:00.000Z", elapsedMinutes: 4, etaMinutes: null, result: null };

test("TST-089: nine canonical workflow states are exact and separate from recommendation/archive", () => {
  assert.deepEqual(model.WORKFLOW_STATUS, {
    NEW: "Новый", WAITING_FOR_STABILITY: "Ожидание стабильности", MATERIALS_INCOMPLETE: "Недостаточно материалов",
    MATERIALS_READY: "Материалы готовы", TRANSCRIBING: "Транскрибация", ANALYZING: "Анализ",
    VALIDATING: "Проверка результата", READY: "Готово", FAILED: "Ошибка",
  });
  assert.equal(model.isProcessingStatus("VALIDATING"), true);
  assert.equal(model.isProcessingStatus("WAITING_FOR_STABILITY"), true, "a confirmed reprocess is visible in the live processing queue immediately");
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

test("TST-090 regression: postgres deletion authorizes the scoped immutable-history cascade", async () => {
  const source = await readFile(new URL("../server/product/postgres-repository.ts", import.meta.url), "utf8");
  const deletion = source.slice(source.indexOf("async deleteCandidate("), source.indexOf("async findCurrentResult("));
  assert.match(deletion, /agent_runs[\s\S]*agent_goals[\s\S]*candidate_id/, "all run ids for the deleted candidate are resolved");
  assert.match(deletion, /set_config\('hh\.cleanup_run_ids'/, "immutable agent history receives the transaction-local cleanup scope");
  assert.match(deletion, /SELECT drive_folder_id FROM candidate_drive_folders/, "the exact Drive folder identity is resolved before candidate deletion");
  assert.match(deletion, /INSERT INTO candidate_drive_folder_tombstones/, "deleted candidates cannot be rediscovered from the unchanged Drive folder");
  assert.ok(deletion.indexOf("candidate_drive_folder_tombstones") < deletion.indexOf("DELETE FROM candidates"), "the rediscovery tombstone is committed before the candidate cascade");
  assert.ok(deletion.indexOf("set_config('hh.cleanup_run_ids'") < deletion.indexOf("DELETE FROM candidates"), "cleanup scope is installed before the candidate cascade");
});

test("TST-090 UI: candidate archive and delete use the site confirmation dialog", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /setCandidateConfirmation\("archive"\)/);
  assert.match(source, /setCandidateConfirmation\("delete"\)/);
  assert.match(source, /Переместить кандидата в архив\?/);
  assert.match(source, /Удалить кандидата\?/);
  assert.doesNotMatch(source, /window\.confirm\("Архивировать кандидата\?/);
  assert.doesNotMatch(source, /window\.confirm\([^)]*Окончательно удалить данные кандидата/s);
});

function expandFunctionComponents(node) {
  if (Array.isArray(node)) return node.map(expandFunctionComponents);
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (typeof node.type === "function") return expandFunctionComponents(node.type(node.props ?? {}));
  return { ...node, props: { ...node.props, children: expandFunctionComponents(node.props?.children) } };
}

function exactButton(tree, label) {
  const buttons = findAll(tree, (node) => node.type === "button" && textContent(node).replace(/^\P{L}+/u, "").trim() === label);
  assert.equal(buttons.length, 1, `exactly one ${JSON.stringify(label)} action is rendered`);
  return buttons[0];
}

test("TST-090 UI regression: confirmed archive immediately replaces the open-card action with delete", async (t) => {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout() { return 0; } };
  const staleProjection = { ...base, status: "READY", archived: false, revision: 2 };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/candidates/lifecycle");
    assert.deepEqual(JSON.parse(init.body), { candidateId: base.id, action: "archive", expectedRevision: 1 });
    return Response.json({ candidate: staleProjection });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const active = { ...base, status: "READY", revision: 1, tone: "blue", updated: "Готово" };
  const view = runtime.create("ProductApp", { onLogout() {} }, [
    "candidate", "dashboard", base.id, [active], { vacancies: [], operationBindings: {} },
    "", "", "light", null, 15, null, null, null,
  ]);

  let tree = expandFunctionComponents(view.render());
  exactButton(tree, "В архив").props.onClick();
  tree = expandFunctionComponents(view.render());
  const dialog = findAll(tree, (node) => node.props?.role === "dialog")[0];
  assert.ok(dialog, "archive confirmation is displayed");
  exactButton(dialog, "В архив").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));

  tree = expandFunctionComponents(view.render());
  assert.match(textContent(findAll(tree, (node) => node.props?.role === "status")[0]), /Состояние кандидата обновлено/,
    "the lifecycle success notification is visible in the same render");
  exactButton(tree, "Удалить");
  assert.equal(findAll(tree, (node) => node.type === "button" && textContent(node).replace(/^\P{L}+/u, "").trim() === "В архив").length, 0,
    "the acknowledged archive command updates the local lifecycle flag even when its returned projection is stale");
});

test("TST-091 UI regression: confirmed reprocess immediately hides the previous result and shows new-run progress", async (t) => {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout() { return 0; } };
  const documents = [
    { id: "old-result", type: "candidate-results", fileName: "Итоги.pdf", version: 1, candidateId: base.id, vacancyId: base.vacancyId, published: true, valid: true },
    { id: "old-abc", type: "abc-test", fileName: "ABC.pdf", version: 1, candidateId: base.id, vacancyId: base.vacancyId, published: true, valid: true },
  ];
  const ready = { ...base, status: "READY", revision: 1, tone: "blue", updated: "Готово", progressPercent: 100,
    progressMilestone: "Результат опубликован", result: { version: 1, completedAt: "2026-08-19T08:20:00.000Z", recommendation: "Рекомендовать", summary: "Старый результат", documents } };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/candidates/lifecycle");
    assert.deepEqual(JSON.parse(init.body), { candidateId: base.id, action: "reprocess", expectedRevision: 1 });
    return Response.json({ candidate: { ...ready, revision: 2 } });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const view = runtime.create("ProductApp", { onLogout() {} }, [
    "candidate", "dashboard", base.id, [ready], { vacancies: [], operationBindings: {} },
    "", "", "light", null, 15, null, null, null,
  ]);
  let tree = expandFunctionComponents(view.render());
  exactButton(tree, "Повторная обработка").props.onClick();
  tree = expandFunctionComponents(view.render());
  exactButton(findAll(tree, (node) => node.props?.role === "dialog")[0], "Запустить").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));

  tree = expandFunctionComponents(view.render());
  assert.match(textContent(tree), /Ожидание стабильности материалов/);
  assert.match(textContent(tree), /0%/);
  assert.doesNotMatch(textContent(tree), /Старый результат|Итоги|ABC-тест/,
    "stale result content and document actions disappear until the new run publishes");
});

test("TST-091: manual reprocess permissions, confirmation and stability gate", async () => {
  assert.equal(model.canReprocess({ ...base, status: "READY" }), true);
  assert.equal(model.canReprocess({ ...base, status: "FAILED", automaticRetriesExhausted: false }), false);
  assert.equal(model.canReprocess({ ...base, status: "FAILED", automaticRetriesExhausted: true }), true);
  assert.equal(model.canReprocess({ ...base, status: "READY", archived: true }), false);
  assert.equal(model.canReprocess({ ...base, status: "ANALYZING" }), false);
  const source = await readProductSource();
  assert.match(source, /setCandidateConfirmation\("reprocess"\)/, "manual reprocessing opens the application confirmation dialog");
  assert.match(source, /Запустить повторную обработку кандидата\?[\s\S]{0,900}Предыдущие результаты станут недоступны/i,
    "the styled confirmation warns that previous results become unavailable");
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
