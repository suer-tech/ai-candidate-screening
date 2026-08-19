import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readProductSource } from "./helpers/product-acceptance-harness.mjs";

const model = await import("../app/product-model.ts");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const vacancy = { id: "vac-1", title: "Тест", normalizedTitle: "тест", active: true, version: 1, templateVersion: "v1", driveFolderId: "folder-1", profile: {}, abcDirections: [] };
const base = { name: "Кандидат", initials: "К", vacancyId: "vac-1", vacancy: "Тест", archived: false, elapsedMinutes: 5, etaMinutes: null, result: null };
const record = (id, status, stageStartedAt, extra = {}) => ({ ...base, id, status, stageStartedAt, ...extra });

test("TST-094: seven HR-facing cards use exact canonical stages and archive lifecycle", () => {
  const candidates = [
    record(1, "ANALYZING", "2026-08-19T08:03:00Z"), record(2, "FAILED", "2026-08-19T08:05:00Z"),
    record(3, "TRANSCRIBING", "2026-08-19T08:01:00Z"), record(4, "READY", "2026-08-19T07:00:00Z"),
    record(5, "WAITING_FOR_STABILITY", "2026-08-19T07:30:00Z"), record(6, "MATERIALS_INCOMPLETE", "2026-08-19T07:40:00Z"),
    record(7, "VALIDATING", "2026-08-19T08:02:00Z"), record(8, "ANALYZING", "2026-08-19T07:59:00Z", { archived: true }),
  ];
  const snapshot = model.buildDashboardSnapshot(candidates, [vacancy], 7, new Date("2026-08-19T10:00:00Z"));
  assert.deepEqual(snapshot.counts, { MATERIALS_INCOMPLETE: 1, TRANSCRIBING: 1, ANALYZING: 1, VALIDATING: 1, READY: 1, FAILED: 1 });
  assert.deepEqual(snapshot.queue.map((item) => item.id), [2, 3, 7, 1]);
  assert.ok(snapshot.queue.length <= 5);
  assert.equal(snapshot.archivedCandidates, 1);
  assert.equal("activeVacancies" in snapshot, false);
  assert.equal("WAITING_FOR_STABILITY" in snapshot.counts, false);
  assert.equal("PROCESSING" in snapshot.counts, false);
});

test("TST-095: 7/30/90 inclusive current-result aggregation excludes archived and latest FAILED", () => {
  const result = { version: 2, completedAt: "2026-08-19T06:00:00Z", summary: "Итог", recommendation: "Рекомендовать", documents: [
    { id: "a", type: "candidate-results", fileName: "Итоги.pdf", version: 2, candidateId: 1, vacancyId: "vac-1", published: true, valid: true },
    { id: "b", type: "abc-test", fileName: "ABC.pdf", version: 2, candidateId: 1, vacancyId: "vac-1", published: true, valid: true },
  ] };
  const ready = record(1, "READY", "2026-08-19T05:00:00Z", { result });
  const latestFailed = record(2, "FAILED", "2026-08-19T07:00:00Z", { result: { ...result, documents: result.documents.map((doc) => ({ ...doc, candidateId: 2 })) } });
  for (const period of [7, 30, 90]) {
    const snapshot = model.buildDashboardSnapshot([ready, latestFailed], [vacancy], period, new Date("2026-08-19T10:00:00Z"));
    assert.deepEqual(snapshot.ready.map((item) => item.id), [1]);
    assert.equal(snapshot.flow[0].count, 1);
    assert.equal(snapshot.queue.filter((item) => item.id === 2).length, 1);
  }
});

test("TST-096: recommendation graph has exactly four canonical categories and no score dimension", () => {
  const snapshot = model.buildDashboardSnapshot([], [vacancy], 30, new Date("2026-08-19T10:00:00Z"));
  assert.deepEqual(Object.keys(snapshot.recommendations), ["Не рекомендовать", "Недостаточно данных", "Рекомендовать с оговорками", "Рекомендовать"]);
  assert.equal("score" in snapshot, false);
  assert.equal("rating" in snapshot, false);
});

test("TST-097: greeting boundaries, Drive polling states and no-demo boundary are observable", async () => {
  assert.equal(model.getGreeting(new Date("2026-08-19T00:00:00Z")), "Доброе утро"); // 05:00 UTC+5
  assert.equal(model.getGreeting(new Date("2026-08-19T07:00:00Z")), "Добрый день"); // 12:00 UTC+5
  assert.equal(model.getGreeting(new Date("2026-08-19T13:00:00Z")), "Добрый вечер"); // 18:00 UTC+5
  const source = await readProductSource();
  for (const state of ["Подключён", "Проверяем подключение", "Нет подключения"]) assert.match(source, new RegExp(state, "i"));
  assert.match(source, /15_?000|15\s*\*\s*1000/, "Drive health polling interval is exactly 15 seconds");
  assert.doesNotMatch(source, /отдельн[^\n]{0,40}(?:панель|блок)[^\n]{0,20}ошиб/i);
  assert.doesNotMatch(source, /static demo|demoValue|mockDashboard/i);
  assert.match(source, /metric-card archive/);
  for (const [status, label] of [["MATERIALS_INCOMPLETE", "Недостаточно материалов"], ["TRANSCRIBING", "Транскрибация"], ["ANALYZING", "AI-анализ"], ["VALIDATING", "Проверка результатов"], ["READY", "Готово"], ["FAILED", "Ошибка"]]) {
    assert.match(source, new RegExp(`\\["${status}", "${label}"`));
  }
  assert.doesNotMatch(source, /\["WAITING_FOR_STABILITY", "Ожидание стабильности"/);
  assert.doesNotMatch(source, /\["PROCESSING", "Обработка"/);
  for (const tone of ["status-insufficient", "status-transcribing", "status-analyzing", "status-validating", "status-ready", "status-failed"]) assert.match(source, new RegExp(tone));
  for (const [tone, color] of [["status-insufficient", "#f3d37e"], ["status-transcribing", "#c7c2ff"], ["status-analyzing", "#c9c0ff"], ["status-validating", "#d6bfff"], ["status-ready", "#a9e4c2"], ["status-failed", "#f2b4ae"], ["archive", "#cbd3dd"]]) {
    assert.match(styles, new RegExp(`\\.metric-card\\.${tone}\\{[^}]*${color}`, "i"));
  }
  assert.match(styles, /\.metric-grid\{[^}]*repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:1180px\)[^{]*\{[^}]*\.metric-grid\{[^}]*repeat\(4,1fr\)/);
  assert.match(source, /kind: "archive"/);
  assert.match(source, /В архиве кандидатов нет\./);
  assert.doesNotMatch(source, /<p>Активные вакансии<\/p>/);
});
