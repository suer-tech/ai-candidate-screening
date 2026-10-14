import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "../openspec/changes/format-candidate-assessment-text/evidence/detail-loading-browser");
await mkdir(output, { recursive: true });
const candidates = [1, 2, 3].map((id) => ({ id, revision: 1, name: `Синтетический кандидат ${id}`, initials: "СК", vacancyId: "synthetic",
  vacancy: "Синтетическая вакансия", status: "READY", archived: false, stageStartedAt: "2026-10-14T10:00:00Z", elapsedMinutes: 10, etaMinutes: null,
  progressPercent: 100, tone: "blue", updated: "сейчас", result: { version: 1, completedAt: "2026-10-14T10:10:00Z", recommendation: "Рекомендовать",
    summary: "Синтетическое обоснование.\n\nВторой абзац сохранён.", documents: [{ id: `synthetic-report-${id}`, type: "candidate-report", fileName: "synthetic.pdf",
      version: 1, candidateId: id, vacancyId: "synthetic", published: true, valid: true }], aiOverview: { recommendationBasis: "Синтетическое основание.", abc: [],
      stopFactors: [], competencies: [], risks: [], accessToKe: [], evidence: [] } } }));
const vacancies = [{ id: "synthetic", title: "Синтетическая вакансия", active: true, archived: false, version: 1, profile: {}, abcDirections: [] }];
const sourcePath = path.join(root, "app/page.tsx");
const result = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {ProductApp} from ${JSON.stringify(sourcePath.replaceAll("\\", "/"))}; createRoot(document.getElementById('app')).render(<ProductApp onLogout={()=>{}} />);`,
  resolveDir: root, loader: "tsx" }, bundle: true, platform: "browser", format: "esm", jsx: "automatic", write: false,
  plugins: [{ name: "test-only-ui-export", setup(builder) { builder.onLoad({ filter: /[/\\]app[/\\]page\.tsx$/ }, async () => ({ contents: `${await readFile(sourcePath, "utf8")}\nexport {ProductApp};`, loader: "tsx" })); } }], logLevel: "silent" });
const css = await readFile(path.join(root, "app/globals.css"), "utf8");
const server = createServer((request, response) => {
  if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(result.outputFiles[0].text); return; }
  if (request.url === "/app.css") { response.setHeader("Content-Type", "text/css"); response.end(css); return; }
  if (request.url !== "/") { response.writeHead(404); response.end(); return; }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="app"></div><script type="module" src="/app.js"></script></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/workspace") {
      requests.push(url.pathname + url.search);
      const summary = url.searchParams.get("summary") === "1";
      const id = url.searchParams.has("candidateId") ? JSON.parse(url.searchParams.get("candidateId")) : undefined;
      if (!summary && id === undefined) { await route.fulfill({ status: 503, json: { error: "Unscoped detail is forbidden in this fixture" } }); return; }
      await new Promise((resolve) => setTimeout(resolve, summary ? 10 : 100));
      await route.fulfill({ json: { candidates: summary ? candidates.map((candidate) => ({ ...candidate, result: { ...candidate.result, aiOverview: undefined } })) : candidates.filter((candidate) => candidate.id === id), vacancies } });
      return;
    }
    if (url.pathname.includes("google-drive")) { await route.fulfill({ json: { connected: false, state: "DISCONNECTED" } }); return; }
    await route.fulfill({ status: 503, json: { error: "Synthetic dashboard unavailable" } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: /Кандидаты$/ }).first().click();
  await page.getByRole("button", { name: "Открыть карточку Синтетический кандидат 1", exact: true }).click();
  await page.getByRole("heading", { name: "Синтетический кандидат 1", exact: true }).waitFor();
  await page.waitForResponse((response) => response.url().includes("candidateId=1"));
  await page.getByRole("button", { name: /Назад к списку/ }).click();
  await page.getByRole("button", { name: "Открыть карточку Синтетический кандидат 2", exact: true }).click();
  await page.getByRole("heading", { name: "Синтетический кандидат 2", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Синтетический кандидат 1", exact: true }).count(), 0);
  await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMetrics = await page.evaluate(() => ({ contentWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
  await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
  assert.ok(requests.filter((url) => url.includes("candidateId=1")).length >= 2, "Initial detail and its poll retain candidate scope");
  assert.ok(requests.includes("/api/workspace?candidateId=2"));
  assert.ok(!requests.includes("/api/workspace"));
  assert.deepEqual(errors, []);
  const evidence = { generatedAtUtc: new Date().toISOString(), status: "PASSED", boundary: "Actual React ProductApp + Chromium with synthetic network fixtures; not server latency proof",
    requests, candidatesPreserved: true, selectedDetailAndPolling: true, secondCandidateShown: true, mobileMetrics, browserErrors: errors, providerCalls: false };
  await writeFile(path.join(output, "checks.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
