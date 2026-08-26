import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/", headers = { accept: "text/html" }, init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers, ...init }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the canonical operational dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const label of ["Правильный выбор", "Контроль очереди", "Недостаточно материалов", "Транскрибация", "AI-анализ", "Проверка результатов", "Готово", "Ошибка", "Архив", "Поток кандидатов", "Результаты анализа", "Проверяем подключение"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /<p>Ожидание стабильности<\/p>/);
  assert.doesNotMatch(html, /<p>Обработка<\/p>/);
  assert.match(html, /Загружаем актуальную очередь/);
  assert.doesNotMatch(html, /Ожидают решения|высоким рейтингом|На следующий этап|Скачать отчёт/);
  assert.doesNotMatch(html, /Активные вакансии/);
});

test("client source contains reviewed MVP flows and excludes demo controls", async () => {
  const [page, model, route, css, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/results/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  for (const value of ["Новая вакансия", "Название вакансии", "Сгенерировать описание", "Сохраняем вакансию", "ABC-критерии", "STANDARD_ABC_DIRECTIONS", "Добавить направление", "Повторная обработка", "Восстановить", "Удалить", "Итоги", "ABC-тест", "PdfPreview", "7 дней", "30 дней", "90 дней"]) assert.match(page, new RegExp(value));
  for (const removedStep of ["Предварительный просмотр", "Подтвердить профиль", "Подтвердить и создать вакансию", "Сохранить и активировать", "Сбросить изменения", "Шаг {step}"]) assert.doesNotMatch(page, new RegExp(removedStep.replace(/[{}]/g, "\\$&")));
  assert.doesNotMatch(page, /без LLM-генерации/);
  for (const value of ["WORKFLOW_STATUS", "createVacancyAtomically", "completeCandidateStabilityCheck", "deleteArchivedCandidate", "buildDashboardSnapshot", "validateResultPair"]) assert.match(model, new RegExp(value));
  assert.match(route, /application\/pdf/);
  assert.match(route, /requestPrincipal/);
  assert.doesNotMatch(page, />\s*Аналитика\s*</);
  assert.doesNotMatch(page, />\s*На следующий этап\s*</);
  assert.doesNotMatch(page, />[^<]*Скачать отчёт[^<]*</);
  assert.doesNotMatch(page, /table-tools[^]*(?:Фильтры|Экспорт)/);
  assert.match(css, /\.pdf-modal/);
  assert.match(css, /\.create-vacancy-modal/);
  assert.match(css, /\.abc-direction-card/);
  assert.match(css, /font-family:"Segoe UI",Arial,sans-serif/);
  assert.match(layout, /Правильный выбор/);
});

test("stacks ABC grade descriptions vertically", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.match(/\.abc-grade-grid\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /grid-template-columns\s*:\s*1fr/);
  assert.doesNotMatch(rule, /repeat\(3\s*,/);
});

test("sizes the desktop header brand column to its content", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const topbarRule = css.match(/\.topbar\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.notEqual(topbarRule, "", "Base desktop .topbar rule is missing");
  assert.match(
    topbarRule,
    /grid-template-columns\s*:\s*max-content\s+minmax\(/,
    "The brand column must fit “Правильный выбор” and its subtitle instead of clipping them",
  );
  assert.doesNotMatch(
    topbarRule,
    /grid-template-columns\s*:[^;}]*\b205px\b/,
    "The desktop brand column must not use the fixed 205px width",
  );
});

test("production worker protects PDF and never falls back when storage is unavailable", async () => {
  const unauthorized = await render("/api/results?candidate=1&type=abc-test&version=2", { accept: "application/pdf" });
  assert.equal(unauthorized.status, 401);
  const invalid = await render("/api/results?candidate=1&type=wrong&version=2", { accept: "application/pdf", "oai-authenticated-user-id": "synthetic-hr" });
  assert.equal(invalid.status, 400);
  const unavailable = await render("/api/results?candidate=1&type=abc-test&version=2", { accept: "application/pdf", "oai-authenticated-user-id": "synthetic-hr" });
  assert.equal(unavailable.status, 503);
  assert.match(JSON.stringify(await unavailable.json()), /временно недоступен/);
});

test("server product routes fail explicitly without the configured database", async () => {
  const dashboard = await render("/api/dashboard?period=7", { accept: "application/json", "oai-authenticated-user-id": "synthetic-hr" });
  assert.equal(dashboard.status, 503);
  const vacancy = await render("/api/vacancies", { accept: "application/json", "content-type": "application/json", "oai-authenticated-user-id": "synthetic-hr" }, { method: "POST", body: "{}" });
  assert.equal(vacancy.status, 503);
});

test("Drive health never reports a synthetic connection", async () => {
  const unauthorized = await render("/api/integrations/google-drive/health", { accept: "application/json" });
  assert.equal(unauthorized.status, 401);
  const unavailable = await render("/api/integrations/google-drive/health", {
    accept: "application/json",
    "oai-authenticated-user-id": "synthetic-hr",
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { state: "disconnected" });
});

test("production E2E readiness is protected and fails closed without provisioned bindings", async () => {
  const unauthorized = await render("/api/readiness/e2e", { accept: "application/json" });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { ready: false, error: "HR_IDENTITY_MISSING" });
  const unavailable = await render("/api/readiness/e2e", {
    accept: "application/json",
    "oai-authenticated-user-id": "synthetic-hr",
    "x-e2e-preflight-token": "not-a-provisioned-secret",
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { ready: false, error: "PREFLIGHT_INFRASTRUCTURE_UNAVAILABLE" });
});
