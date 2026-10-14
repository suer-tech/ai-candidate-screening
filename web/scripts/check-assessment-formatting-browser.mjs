import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "../openspec/changes/format-candidate-assessment-text/evidence/refinement-browser");
await mkdir(output, { recursive: true });
const basis = "Кандидат самостоятельно выстроил рабочий процесс и описал измеримый результат. Это подтверждает соответствие части требований.\n\nОговорки: точный вклад в общий результат требует проверки. Отсутствие подробностей не означает отсутствия опыта.\n\nНа встрече обязательно проверить:\n1) Уточнить личные действия и исходные показатели.\n2) Разобрать пример решения с неполными данными.";
const abc = { direction: "Самостоятельность", grade: "B", reason: "Кандидат самостоятельно планировал работу и доводил задачи до результата.\n\nОднако пример сложного решения с эскалацией раскрыт частично, поэтому уровень A не подтверждён.",
  definingConditions: ["Самостоятельное выполнение задач в рамках своей ответственности.", "Своевременная эскалация вопросов, требующих согласования."],
  gradeA: "Самостоятельно решает новые задачи, оценивает риски и своевременно согласует критичные решения.",
  gradeB: "Устойчиво справляется с типовыми задачами, отдельные новые ситуации требуют поддержки.", gradeC: "Нуждается в регулярной постановке задач и контроле.", factIds: ["synthetic-fact"] };
const fixture = { id: 901, name: "Синтетический кандидат", initials: "СК", vacancyId: "synthetic", vacancy: "Операционный руководитель", status: "READY", archived: false,
  stageStartedAt: "2026-10-14T10:00:00Z", elapsedMinutes: 10, etaMinutes: null, tone: "blue", updated: "сейчас",
  result: { version: 1, completedAt: "2026-10-14T10:10:00Z", recommendation: "Рекомендовать с оговорками", summary: "Есть содержательные примеры самостоятельной работы.\n\nВопросы для уточнения приведены в обосновании итога.",
    documents: [{ id: "synthetic-report", type: "candidate-report", fileName: "synthetic.pdf", version: 1, candidateId: 901, vacancyId: "synthetic", published: true, valid: true }],
    aiOverview: { recommendationBasis: basis, abc: [abc], stopFactors: [], competencies: [], risks: [], accessToKe: [], evidence: [
      { id: "synthetic-fact", label: "Основание вывода", claim: "Самостоятельно организовал проверку рабочего процесса.", source: "Синтетическое интервью", timecode: "00:02:10", criterion: "Самостоятельность" },
    ] } } };
const variants = [
  ["Абзацы", basis], ["Короткий итог", "Подтверждён явный стоп-фактор вакансии."],
  ["Сплошной текст", "Есть релевантный опыт и содержательные примеры. При этом личный вклад требует уточнения. Поэтому рекомендация сохраняет оговорки."],
  ["Явные разделы", "Сильные стороны: опыт выполнения новых задач. Риски и пробелы: не раскрыт масштаб команды. Допуск к КЕ: после уточнения этих вопросов."],
  ["Список в строке", "На встрече обязательно проверить: 1) Уточнить опыт; 2) Обсудить ограничения; 3) Разобрать личный вклад."],
  ["Неполная оценка", "Рекомендация сформирована по доступным данным; часть оценки требует ручной проверки."],
];
const sourcePath = path.join(root, "app/page.tsx");
const result = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {CandidateDetail} from ${JSON.stringify(sourcePath.replaceAll("\\", "/"))};
const fixture=${JSON.stringify(fixture)}, variants=${JSON.stringify(variants)};
const app=createRoot(document.getElementById('app'));
function preview(index=0){const candidate=structuredClone(fixture);candidate.result.aiOverview.recommendationBasis=variants[index][1];app.render(<><nav className="preview-variants">{variants.map(([label],i)=><button key={label} onClick={()=>preview(i)}>{label}</button>)}</nav><main className="format-preview"><CandidateDetail candidate={candidate} onBack={()=>{}} onArchive={()=>{}} onRestore={()=>{}} onDelete={()=>{}} onReprocess={()=>{}} onPreview={()=>{}} /></main></>)} preview();`,
  resolveDir: root, loader: "tsx" }, bundle: true, platform: "browser", format: "esm", jsx: "automatic", write: false,
  plugins: [{ name: "test-only-ui-export", setup(builder) { builder.onLoad({ filter: /[/\\]app[/\\]page\.tsx$/ }, async () => ({ contents: `${await readFile(sourcePath, "utf8")}\nexport {CandidateDetail};`, loader: "tsx" })); } }], logLevel: "silent" });
const css = await readFile(path.join(root, "app/globals.css"), "utf8");
const server = createServer((request, response) => {
  if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(result.outputFiles[0].text); return; }
  if (request.url === "/app.css") { response.setHeader("Content-Type", "text/css"); response.end(css); return; }
  if (request.url !== "/") { response.writeHead(404); response.end(); return; }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0}.format-preview{max-width:1220px;margin:auto;padding:20px}.preview-variants{display:flex;gap:8px;flex-wrap:wrap;padding:12px 20px;background:var(--paper);border-bottom:1px solid var(--line)}.preview-variants button{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink)}</style><div id="app"></div><script type="module" src="/app.js"></script></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const checks = [];
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("heading", { name: "Детальная оценка", exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
  for (const [label, value] of variants) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const prose = page.locator(".ai-recommendation-copy .assessment-prose");
    assert.equal((await prose.textContent()).replace(/\s/gu, ""), value.replace(/\s/gu, ""));
    checks.push({ variant: label, exactContent: true });
  }
  await page.getByRole("button", { name: "Абзацы", exact: true }).click();
  await page.getByText("Критерии уровней", { exact: true }).click();
  assert.equal(await page.locator(".criterion-scale[open] dt").count(), 3);
  const row = page.locator(".criterion-detail-row").first();
  assert.equal(await row.getByText("Учтённые признаки", { exact: true }).count(), 0);
  const order = await row.evaluate((element) => {
    const title = element.querySelector(".criterion-heading");
    const scale = element.querySelector(".criterion-scale");
    const button = element.querySelector(".criterion-row-trigger");
    const panel = element.querySelector(".criterion-evidence-area");
    return { titleBeforeButton: Boolean(title.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
      scaleBeforeButton: Boolean(scale.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
      adjacentPanel: button.nextElementSibling === panel,
      footerBelowScale: button.getBoundingClientRect().top >= scale.getBoundingClientRect().bottom - 1 };
  });
  assert.deepEqual(order, { titleBeforeButton: true, scaleBeforeButton: true, adjacentPanel: true, footerBelowScale: true });
  await page.locator(".criterion-row-trigger").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".criterion-row-trigger").first().getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".criterion-evidence-area").first().getAttribute("aria-hidden"), "false");
  await page.screenshot({ path: path.join(output, "desktop-expanded.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const metrics = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(metrics.content <= metrics.viewport + 1, JSON.stringify(metrics));
  const mobileOrder = await row.evaluate((element) => {
    const button = element.querySelector(".criterion-row-trigger").getBoundingClientRect();
    const scale = element.querySelector(".criterion-scale").getBoundingClientRect();
    return button.top >= scale.bottom - 1;
  });
  assert.equal(mobileOrder, true);
  await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: path.join(output, "mobile-dark.png"), fullPage: true });
  assert.deepEqual(errors, []);
  const evidence = { generatedAtUtc: new Date().toISOString(), status: "PASSED", boundary: "Actual React client mount and Chromium; synthetic fixtures; real production CSS", checks, scaleToggle: true, evidenceToggle: true, footerOrder: order, mobileFooterOrder: mobileOrder, keyboardToggle: true, mobileOverflow: false, browserErrors: errors, providerCalls: false };
  await writeFile(path.join(output, "checks.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
