import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the HR processing dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Правильный выбор/);
  assert.match(html, /Google Drive подключён/);
  assert.match(html, /Следующая проверка через/);
  assert.match(html, /Контроль очереди/);
  assert.doesNotMatch(html, /Обработка сейчас/);
  assert.doesNotMatch(html, /Оставшееся время рассчитано по медиане/);
  assert.match(html, /Михаил Сергеев/);
  assert.match(html, /Поток кандидатов/);
  assert.doesNotMatch(html, /Приоритетная очередь/);
  assert.doesNotMatch(html, /В реальном времени/);
});

test("keeps the requested HR interactions in the client", async () => {
  const [page, css, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /setScanCountdown/);
  assert.match(page, /В обработке/);
  assert.match(page, /Сравнить кандидатов/);
  assert.match(page, /Все вакансии/);
  assert.match(page, /В архив/);
  assert.match(page, /\["AI-обзор", "Транскрипция"\]/);
  assert.match(page, /Критерии и факты/);
  assert.match(page, /Материалы/);
  assert.match(page, /Сохранить новую версию/);
  assert.match(page, /STANDARD_ABC_DIRECTIONS/);
  assert.match(page, /Соответствие корпоративным ценностям/);
  assert.match(page, /Добавить направление/);
  assert.match(page, /removeAbcDirection/);
  assert.match(page, /validateAbcProfile/);
  assert.match(page, /aria-invalid/);
  assert.match(page, /Бизнес-ассистент/);
  assert.match(page, /BUSINESS_ASSISTANT_PROFILE/);
  assert.match(page, /Коммуникация и эмпатия/);
  assert.match(page, /Исчерпывающая передача информации/);
  assert.match(page, /Управление окружением и проактивность/);
  assert.match(page, /Поиск оптимальных решений/);
  assert.match(page, /Образ результата/);
  assert.match(page, /Кандидатов пока нет/);
  assert.match(page, /candidate-card-hit/);
  assert.match(page, /Открыть карточку/);
  assert.doesNotMatch(page, /Открыть →/);
  assert.ok(page.indexOf("processing-panel") < page.indexOf("metric-grid"));
  assert.match(css, /\.processing-panel/);
  assert.match(css, /\.processing-panel\{margin:14px 0;/);
  assert.match(css, /\.comparison-panel/);
  assert.match(css, /\.abc-direction-card/);
  assert.match(css, /\.abc-field-error/);
  assert.match(css, /text-shadow:none !important/);
  assert.match(css, /font-family:"Segoe UI",Arial,sans-serif/);
  assert.match(css, /-webkit-font-smoothing:antialiased/);
  assert.match(css, /body \{ font-size:15px; \}/);
  assert.match(css, /small \{ font-size:12px !important;/);
  assert.match(css, /\.settings-content>aside button\{font-size:13px!important;/);
  assert.match(css, /\.settings-field textarea\{font-size:14px!important;/);
  assert.match(css, /\.abc-grade-grid textarea\{font-size:13px;/);
  assert.doesNotMatch(css, /font-size:(?:[0-9]|10)px/);
  assert.doesNotMatch(css, /font-weight:(650|750)/);
  assert.match(css, /html\[data-theme="dark"\] \.stage-list \.done i\{background:#25b889;color:#fff;box-shadow:none\}/);
  assert.match(css, /\.topbar \{[^}]*max-width:1520px;[^}]*margin:0 auto;/);
  assert.match(css, /html\[data-theme="dark"\] \.drive-monitor/);
  assert.match(layout, /Правильный выбор/);
  assert.doesNotMatch(layout, /next\/font\/google/);
});

test("stacks ABC grade descriptions vertically in vacancy assessment settings", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const abcGradeGridRule = css.match(/\.abc-grade-grid\{([^}]*)\}/)?.[1] ?? "";

  assert.notEqual(abcGradeGridRule, "", "CSS rule for the ABC grade description fields is missing");
  assert.match(
    abcGradeGridRule,
    /(?:^|;)\s*grid-template-columns\s*:\s*1fr\s*(?:;|$)/,
    "A, B and C description fields must be arranged in one vertical column",
  );
  assert.doesNotMatch(
    abcGradeGridRule,
    /grid-template-columns\s*:\s*repeat\(3\s*,/,
    "A, B and C description fields must not be arranged in three horizontal columns",
  );
});
