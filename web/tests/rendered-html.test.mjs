import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const servers = [];
let anonymousUrl;
let localHrUrl;

async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startServer(localHr) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [fileURLToPath(new URL("../.output/server/index.mjs", import.meta.url))], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      PATH: process.env.PATH,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NITRO_PORT: String(port), NITRO_HOST: "127.0.0.1", NODE_ENV: "production",
      HH_RUNTIME_CONFIG_ROOT: fileURLToPath(new URL("../.output/nonexistent-test-runtime", import.meta.url)),
      ...(localHr ? { E2E_ENVIRONMENT: "local", LOCAL_AUTH_USER_ID: "synthetic-hr" } : {}),
    },
    stdio: "ignore",
    windowsHide: true,
  });
  servers.push(server);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`RENDERED_SERVER_EXITED:${server.exitCode}`);
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(500) });
      return baseUrl;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("RENDERED_SERVER_START_TIMEOUT");
}

before(async () => {
  anonymousUrl = await startServer(false);
  localHrUrl = await startServer(true);
});

after(() => servers.forEach((server) => server.kill()));

async function render(pathname = "/", headers = { accept: "text/html" }, init = {}, localHr = false) {
  return fetch(`${localHr ? localHrUrl : anonymousUrl}${pathname}`, { headers, ...init, signal: AbortSignal.timeout(10_000) });
}

test("server-renders the canonical operational dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Правильный выбор/);
  assert.match(html, /Проверяем защищённую сессию/);
  assert.doesNotMatch(html, /Ожидают решения|высоким рейтингом|На следующий этап|Скачать отчёт/);
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
  const invalid = await render("/api/results?candidate=1&type=wrong&version=2", { accept: "application/pdf" }, {}, true);
  assert.equal(invalid.status, 400);
  const unavailable = await render("/api/results?candidate=1&type=abc-test&version=2", { accept: "application/pdf" }, {}, true);
  assert.equal(unavailable.status, 503);
  assert.match(JSON.stringify(await unavailable.json()), /временно недоступен/);
});

test("server product routes fail explicitly without the configured database", async () => {
  const dashboard = await render("/api/dashboard?period=7", { accept: "application/json" }, {}, true);
  assert.equal(dashboard.status, 503);
  const vacancy = await render("/api/vacancies", { accept: "application/json", "content-type": "application/json" }, { method: "POST", body: "{}" }, true);
  assert.equal(vacancy.status, 503);
});

test("Drive health never reports a synthetic connection", async () => {
  const unauthorized = await render("/api/integrations/google-drive/health", { accept: "application/json" });
  assert.equal(unauthorized.status, 401);
  const unavailable = await render("/api/integrations/google-drive/health", { accept: "application/json" }, {}, true);
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
  }, {}, true);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { ready: false, error: "PREFLIGHT_INFRASTRUCTURE_UNAVAILABLE" });
});
