import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findAll, loadProductUiHarness, textContent } from "./helpers/product-acceptance-harness.mjs";

const generatedProfile = Object.freeze({
  schemaVersion: "synthetic-v1",
  templateVersion: "synthetic-template-v1",
  profile: {
    "Образ результата": "Освободить время руководителя и обеспечить прозрачность рабочего контура.",
    "Компетенции": "Управление календарём, приоритетами, коммуникациями и договорённостями.",
    "Стоп-факторы": "Нарушение конфиденциальности и систематическая потеря договорённостей.",
    "Допуск к КЕ": "После подтверждения точности и устойчивой самостоятельной работы.",
  },
  abcDirections: [
    { id: "productivity", name: "Продуктивность", gradeA: "Есть измеримые результаты.", gradeB: "Результаты подтверждены частично.", gradeC: "Результаты не подтверждены.", origin: "standard" },
    { id: "initiative", name: "Инициатива", gradeA: "Сам инициирует улучшения.", gradeB: "Предлагает улучшения после постановки.", gradeC: "Работает только по указанию.", origin: "standard" },
    { id: "self-learning", name: "Самообучаемость", gradeA: "Самостоятельно осваивает и применяет знания.", gradeB: "Осваивает с поддержкой.", gradeC: "Не демонстрирует самостоятельного обучения.", origin: "standard" },
    { id: "corporate-values", name: "Корпоративные ценности", gradeA: "Поведение подтверждает ценности.", gradeB: "В целом соответствует ценностям.", gradeC: "Есть подтверждённые противоречия.", origin: "standard" },
    { id: "autonomy", name: "Автономность", gradeA: "Самостоятельно ведёт блок до результата.", gradeB: "Самостоятелен в типовых задачах.", gradeC: "Требует постоянного контроля.", origin: "standard" },
  ],
  hrDecisionMarkers: [],
});

const createdVacancy = Object.freeze({
  id: "vacancy-1",
  title: "Бизнес-ассистент",
  version: 1,
  driveFolderId: "folder-1",
  profile: generatedProfile.profile,
  abcDirections: generatedProfile.abcDirections,
});

function button(tree, pattern) {
  const match = findAll(tree, (node) => node.type === "button" && pattern.test(textContent(node).trim()))[0];
  assert.ok(match, `button matching ${pattern} is present; rendered=${JSON.stringify(textContent(tree))}`);
  return match;
}

function installBrowserDouble(t, fetchImplementation) {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = { confirm: () => true, setInterval: () => 1, clearInterval: () => undefined, location: { reload() {} } };
  globalThis.fetch = fetchImplementation;
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  });
}

async function waitFor(predicate, message) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function expectedSnapshotHash(title) {
  const snapshot = {
    title: title.trim().replace(/\s+/g, " "),
    profile: generatedProfile.profile,
    abcDirections: generatedProfile.abcDirections,
    templateVersion: generatedProfile.templateVersion,
  };
  return `sha256:${createHash("sha256").update(stableJson(snapshot)).digest("hex")}`;
}

async function createView(t, props = {}) {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  return runtime.create("CreateVacancy", {
    existing: { vacancies: [], operationBindings: {} }, onClose() {}, onCreated() {}, ...props,
  });
}

test("ACC-VAC-UI-001: creation modal is a single unnumbered title-and-generate surface", async (t) => {
  installBrowserDouble(t, async (url) => { throw new Error(`Unexpected fetch: ${String(url)}`); });
  const tree = (await createView(t)).render();
  const dialog = findAll(tree, (node) => node.props?.role === "dialog")[0];
  assert.ok(dialog, "vacancy creation is exposed as a dialog");
  assert.doesNotMatch(textContent(dialog), /\bшаг\b|\bstep\b|\b\d+\s+из\s+\d+\b/i, "the modal must not mention or number steps");
  const fields = findAll(dialog, (node) => node.type === "input" || node.type === "textarea" || node.type === "select");
  assert.equal(fields.length, 1, "the modal exposes exactly one data field");
  assert.equal(fields[0].type, "input", "the only data field is the vacancy title input");
  assert.match(textContent(dialog), /Название вакансии/i);
  const actionLabels = findAll(dialog, (node) => node.type === "button").map((node) => textContent(node).trim());
  assert.ok(actionLabels.includes("Сформировать вакансию"), `the single primary action starts the whole operation; buttons=${JSON.stringify(actionLabels)}`);
  assert.ok(actionLabels.every((label) => ["Сформировать вакансию", "Отмена", "×"].includes(label)), `only generate and optional close/cancel controls are allowed; buttons=${JSON.stringify(actionLabels)}`);
  assert.doesNotMatch(textContent(dialog), /Образ результата|Компетенции|Стоп-факторы|Допуск к КЕ|ABC-критерии|Подтвердить|Создать вакансию/i);
});

test("ACC-VAC-UI-002: one click shows a styled accessible spinner without attempt counters", async (t) => {
  let releaseGeneration;
  const pendingGeneration = new Promise((resolve) => { releaseGeneration = resolve; });
  installBrowserDouble(t, async (url, init = {}) => {
    if (String(url) === "/api/vacancies/generate" && init.method === "POST") return pendingGeneration;
    throw new Error(`Unexpected fetch: ${String(url)}`);
  });
  t.after(() => releaseGeneration?.({ ok: false, async json() { return { error: { message: "cancelled" } }; } }));
  const view = await createView(t);
  let tree = view.render();
  findAll(tree, (node) => node.type === "input")[0].props.onChange({ target: { value: "Бизнес-ассистент" } });
  tree = view.render();
  button(tree, /^Сформировать вакансию$/).props.onClick();
  tree = view.render();
  const status = findAll(tree, (node) => node.props?.role === "status")[0];
  assert.ok(status, "the unified generation-and-save operation exposes an accessible status");
  assert.equal(status.props["aria-busy"], true);
  assert.ok(findAll(status, (node) => /spinner/i.test(node.props?.className ?? "")).length > 0, "status includes the designed visual spinner");
  assert.match(status.props.className ?? "", /generation-status/, "spinner uses the vacancy-creation design-system status class");
  assert.doesNotMatch(textContent(tree), /попыт(?:ка|ок|ки)|\b[1-4]\s+из\s+4\b/i, "attempt counters stay hidden");
  assert.equal(findAll(tree, (node) => node.type === "textarea").length, 0, "no editor appears while the operation is pending");
});

test("ACC-VAC-UI-003: successful generation automatically confirms the snapshot and saves the vacancy", async (t) => {
  const requests = [];
  let createdState;
  let closed = 0;
  installBrowserDouble(t, async (url, init = {}) => {
    const request = { url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(request);
    if (request.url === "/api/vacancies/generate" && request.method === "POST") return { ok: true, async json() { return { operation: { state: "SUCCEEDED", attemptCount: 1, profile: structuredClone(generatedProfile) } }; } };
    if (request.url === "/api/vacancies" && request.method === "POST") return { ok: true, async json() { return { vacancy: structuredClone(createdVacancy) }; } };
    throw new Error(`Unexpected fetch: ${request.url}`);
  });
  const view = await createView(t, { onCreated: (state) => { createdState = state; }, onClose: () => { closed += 1; } });
  let tree = view.render();
  findAll(tree, (node) => node.type === "input")[0].props.onChange({ target: { value: "Бизнес-ассистент" } });
  tree = view.render();
  await button(tree, /^Сформировать вакансию$/).props.onClick();
  assert.deepEqual(requests.map(({ url }) => url), ["/api/vacancies/generate", "/api/vacancies"], "one click performs generation and then persistence in order");
  const save = requests[1].body;
  assert.equal(save.title, "Бизнес-ассистент");
  assert.deepEqual(save.profile, generatedProfile.profile, "the exact generated profile is confirmed without an intermediate editor");
  assert.deepEqual(save.abcDirections, generatedProfile.abcDirections, "the exact generated ABC snapshot is confirmed");
  assert.equal(save.templateVersion, generatedProfile.templateVersion);
  assert.equal(save.confirmedSnapshotHash, expectedSnapshotHash("Бизнес-ассистент"), "confirmation hash is computed automatically from the generated snapshot");
  assert.match(save.operationId, /\S+/, "the final save remains idempotently bound to an operation ID");
  assert.match(save.generationOperationId, /\S+/, "the save remains bound to its generation operation");
  assert.equal(createdState.vacancies.length, 1, "onCreated receives the newly active vacancy state");
  assert.equal(createdState.vacancies[0].id, createdVacancy.id);
  assert.equal(createdState.operationBindings[save.operationId].vacancyId, createdVacancy.id);
  assert.equal(closed, 1, "the modal closes immediately after successful persistence");
});

test("ACC-VAC-UI-004: generation and persistence remain one uninterrupted UI operation", async (t) => {
  let releaseSave;
  let saveStarted = false;
  const pendingSave = new Promise((resolve) => { releaseSave = resolve; });
  installBrowserDouble(t, async (url, init = {}) => {
    if (String(url) === "/api/vacancies/generate" && init.method === "POST") return { ok: true, async json() { return { operation: { state: "SUCCEEDED", attemptCount: 1, profile: structuredClone(generatedProfile) } }; } };
    if (String(url) === "/api/vacancies" && init.method === "POST") { saveStarted = true; return pendingSave; }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  });
  t.after(() => releaseSave?.({ ok: false, async json() { return { error: "cancelled" }; } }));
  const view = await createView(t);
  let tree = view.render();
  findAll(tree, (node) => node.type === "input")[0].props.onChange({ target: { value: "Бизнес-ассистент" } });
  tree = view.render();
  button(tree, /^Сформировать вакансию$/).props.onClick();
  await waitFor(() => saveStarted, "automatic persistence must start after generation");
  tree = view.render();
  assert.ok(findAll(tree, (node) => node.props?.role === "status" && node.props?.["aria-busy"] === true).length > 0, "the spinner remains visible through persistence");
  assert.doesNotMatch(textContent(tree), /\bшаг\b|Образ результата|Компетенции|Стоп-факторы|Допуск к КЕ|ABC-критерии|Подтвердить|Сбросить изменения/i);
  assert.equal(findAll(tree, (node) => node.type === "textarea").length, 0, "there is no intermediate profile or ABC editor");
});

test("ACC-VAC-UI-005: created state opens in the standard Vacancies view", async (t) => {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const vacancy = { ...structuredClone(createdVacancy), short: createdVacancy.title, avatar: "БИ", color: "#58dfc4" };
  const tree = runtime.create("Vacancies", {
    candidates: [], vacancyState: { vacancies: [vacancy], operationBindings: { "save-1": { vacancyId: vacancy.id, folderId: vacancy.driveFolderId } } },
    onState() {}, onOpen() {}, onNotify() {},
  }).render();
  assert.equal(findAll(tree, (node) => node.props?.role === "dialog").length, 0, "the creation modal is no longer shown");
  assert.ok(findAll(tree, (node) => node.type === "section" && /vacancy-main/.test(node.props?.className ?? "")).length > 0, "the standard vacancy detail interface is rendered");
  assert.match(textContent(tree), /Бизнес-ассистент/);
  assert.match(textContent(tree), /Активна/);
  assert.match(textContent(tree), /Кандидаты/);
  assert.match(textContent(tree), /Параметры оценки/);
  assert.match(textContent(tree), /Активность/);
});
