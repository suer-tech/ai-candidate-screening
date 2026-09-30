import assert from "node:assert/strict";
import test from "node:test";
import { loadVacancyNavigationHarness } from "./helpers/react-component-harness.mjs";

function all(node, predicate, result = []) {
  if (Array.isArray(node)) node.forEach((child) => all(child, predicate, result));
  else if (node && typeof node === "object") {
    if (predicate(node)) result.push(node);
    all(node.props?.children, predicate, result);
  }
  return result;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
function button(tree, pattern) {
  const found = all(tree, (node) => node.type === "button" && [node.props["aria-label"], node.props.title, text(node).trim().replace(/›$/, "").trim()].some((label) => label && pattern.test(label)))[0];
  assert.ok(found, `button ${pattern} exists`);
  return found;
}
function dialog(tree) {
  const direct = all(tree, (node) => node.props?.role === "dialog")[0];
  if (direct) return direct;
  const component = all(tree, (node) => node.type?.name === "UnsavedChangesDialog")[0];
  return component ? component.type(component.props) : undefined;
}
function editorNode(tree) { return all(tree, (node) => node.type?.name === "VacancySettings")[0]; }
function field(tree) { return all(tree, (node) => node.type === "textarea" && node.props.id === "vacancy-description-field")[0]; }
const settle = () => new Promise((resolve) => setImmediate(resolve));

function vacancy(id, title, archived = false) {
  return { id, title, short: title, avatar: "СВ", color: "#123456", archived, version: 3,
    templateVersion: "vacancy-profile/v1", profile: { "Образ результата": "Сохранённый результат", "Компетенции": "Компетенции", "Стоп-факторы": "Стоп-фактор", "Допуск к КЕ": "Условия" },
    abcDirections: [{ id: "custom-delivery", name: "Результат", gradeA: "В срок", gradeB: "С помощью", gradeC: "Не завершает", origin: "custom" }],
    analysisPrompt: { text: "Синтетический промпт оценки", artifactId: "candidate-assessment/v1", hash: "test" } };
}

async function setup(t, application = false) {
  const runtime = await loadVacancyNavigationHarness();
  const previous = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const calls = []; let rejected = false; let loggedOut = 0;
  const records = [vacancy("synthetic-a", "Синтетическая первая"), vacancy("synthetic-b", "Синтетическая вторая"), vacancy("synthetic-archive", "Синтетическая архивная", true)];
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; },
    localStorage: { getItem() { return null; }, setItem() {} } };
  globalThis.document = { cookie: "", documentElement: { dataset: {}, style: {} }, addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined });
    if (String(url).startsWith("/api/vacancies/prompts")) return { ok: true, json: async () => ({ analysis: records[0].analysisPrompt, analysisDefault: records[0].analysisPrompt }) };
    if (url === "/api/workspace") return { ok: true, json: async () => ({ candidates: [], vacancies: records }) };
    if (url === "/api/vacancies/profile") {
      if (rejected) return { ok: false, status: 409, json: async () => ({ error: "Версия изменена другим редактором" }) };
      const submitted = JSON.parse(init.body);
      const source = records.find((item) => item.id === submitted.vacancyId);
      const saved = { ...source, version: source.version + 1, profile: submitted.profile, abcDirections: submitted.abcDirections,
        analysisPrompt: { ...source.analysisPrompt, text: submitted.analysisPrompt === undefined ? source.analysisPrompt.text : submitted.analysisPrompt.trim() } };
      records[records.indexOf(source)] = saved;
      return { ok: true, json: async () => ({ vacancy: saved }) };
    }
    return { ok: true, json: async () => ({ connected: false, state: "DISCONNECTED" }) };
  };
  t.after(async () => { await runtime.cleanup(); Object.assign(globalThis, previous); });
  let app; let host;
  if (application) {
    app = runtime.mount("ProductApp", { onLogout() { loggedOut++; } });
    app.render(); app.flushEffects(); await settle();
    button(app.render(), /Вакансии$/).props.onClick();
    app.render(); app.flushEffects(); await settle();
    const node = all(app.render(), (entry) => entry.type?.name === "Vacancies")[0];
    assert.ok(node, "application workspace mounted after its real fetch effect");
    host = runtime.mount(node.type, node.props);
  } else {
    host = runtime.mount("Vacancies", { candidates: [], vacancyState: { vacancies: records, operationBindings: {} },
      onState() {}, onOpen() {}, onNotify() {}, onCandidatesDeleted() {} });
  }
  button(host.render(), /^Параметры оценки$/).props.onClick();
  const node = editorNode(host.render());
  const editor = runtime.mount(node.type, node.props);
  editor.render(); editor.flushEffects(); await settle(); editor.render(); editor.flushEffects();
  field(editor.render()).props.onChange({ target: { value: "Несохранённый синтетический результат" } });
  editor.render(); editor.flushEffects(); host.render();
  return { runtime, host, editor, app, calls, records, rejectSave() { rejected = true; }, allowSave() { rejected = false; }, get loggedOut() { return loggedOut; } };
}

test("unsaved result section guards internal section changes and Close keeps the actual draft", async (t) => {
  const { editor, calls } = await setup(t);
  button(editor.render(), /^Компетенции$/).props.onClick();
  let guard = dialog(editor.render());
  assert.ok(guard, "unsaved result blocks switching to Competencies");
  assert.match(text(guard), /несохран|сохранени/i);
  button(guard, /^Закрыть/).props.onClick();
  assert.equal(dialog(editor.render()), undefined);
  assert.equal(field(editor.render()).props.value, "Несохранённый синтетический результат");
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  button(editor.render(), /^Компетенции$/).props.onClick();
  guard = dialog(editor.render());
  button(guard, /^Не сохранять$/).props.onClick();
  assert.equal(dialog(editor.render()), undefined);
  assert.equal(field(editor.render()).props.value, "Компетенции", "discard resumes chosen destination");
  button(editor.render(), /^Образ результата$/).props.onClick();
  assert.equal(field(editor.render()).props.value, "Сохранённый результат", "discard restored persisted snapshot");
});

for (const [label, action] of [
  ["vacancy tab", (tree) => button(tree, /^Активность$/).props.onClick()],
  ["other vacancy", (tree) => button(tree, /Синтетическая вторая/).props.onClick()],
  ["archive scope", (tree) => button(tree, /^Архив$/).props.onClick()],
  ["search replacing selected vacancy", (tree) => all(tree, (node) => node.type === "input" && node.props["aria-label"] === "Найти вакансию")[0].props.onChange({ target: { value: "вторая" } })],
  ["new vacancy", (tree) => button(tree, /Новая вакансия$/).props.onClick()],
]) {
  test(`unsaved vacancy editor guards ${label} and Close preserves selected vacancy and draft`, async (t) => {
    const { host, editor, calls } = await setup(t);
    action(host.render());
    const guard = dialog(host.render());
    assert.ok(guard, `${label} opens Save/Discard/Close decision before navigation`);
    assert.equal(editorNode(host.render())?.props.vacancy.id, "synthetic-a", "original vacancy remains selected while decision is pending");
    button(guard, /^Закрыть/).props.onClick();
    assert.equal(dialog(host.render()), undefined);
    assert.equal(editorNode(host.render())?.props.vacancy.id, "synthetic-a");
    assert.equal(field(editor.render()).props.value, "Несохранённый синтетический результат");
    assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  });
}

test("failed real editor save retains draft and visible error; successful retry navigates once", async (t) => {
  const context = await setup(t); const { host, editor, calls } = context;
  context.rejectSave();
  button(host.render(), /Синтетическая вторая/).props.onClick();
  button(dialog(host.render()), /^Сохранить изменения$/).props.onClick();
  await settle();
  let guard = dialog(host.render());
  assert.ok(guard, "rejected save keeps decision open");
  assert.match(text(guard), /Версия изменена другим редактором/, "server rejection appears in modal");
  assert.equal(editorNode(host.render())?.props.vacancy.id, "synthetic-a");
  assert.equal(field(editor.render()).props.value, "Несохранённый синтетический результат");
  context.allowSave();
  // Render the actual editor after its failed request, as React does before retry.
  editor.render(); editor.flushEffects();
  button(guard, /^Сохранить изменения$/).props.onClick();
  await settle(); editor.render(); editor.flushEffects();
  assert.equal(dialog(host.render()), undefined, "successful save closes the guard");
  assert.equal(editorNode(host.render())?.props.vacancy.id, "synthetic-b", "requested vacancy selected exactly after save");
  assert.equal(calls.filter((call) => call.url === "/api/vacancies/profile").length, 2, "one request per explicit attempt");
});

test("section save rejection is visible; successful save resumes section once and clears dirty guard", async (t) => {
  const context = await setup(t); const { editor, calls } = context;
  context.rejectSave();
  button(editor.render(), /^Компетенции$/).props.onClick();
  button(dialog(editor.render()), /^Сохранить изменения$/).props.onClick(); await settle();
  assert.match(text(dialog(editor.render())), /Версия изменена другим редактором/);
  assert.equal(field(editor.render()).props.value, "Несохранённый синтетический результат", "failed save keeps the original section and draft");
  context.allowSave();
  button(dialog(editor.render()), /^Сохранить изменения$/).props.onClick(); await settle(); editor.render(); editor.flushEffects();
  assert.equal(dialog(editor.render()), undefined);
  assert.equal(field(editor.render()).props.value, "Компетенции", "save resumes the pending section");
  button(editor.render(), /^Образ результата$/).props.onClick();
  assert.equal(dialog(editor.render()), undefined, "navigation after successful save does not ask to save again");
  assert.equal(field(editor.render()).props.value, "Несохранённый синтетический результат", "saved value persists across section navigation");
  assert.equal(calls.filter((call) => call.url === "/api/vacancies/profile").length, 2);
});

  test("rapid direct Save then vacancy guard Save shares the pending request and resumes navigation", async (t) => {
    const { host, editor, calls } = await setup(t);
    const fixtureFetch = globalThis.fetch;
    let finishSave;
    const saveGate = new Promise((resolve) => { finishSave = resolve; });
    globalThis.fetch = async (url, init) => {
      const response = await fixtureFetch(url, init);
      if (url === "/api/vacancies/profile") await saveGate;
      return response;
    };
    button(editor.render(), /^Сохранить$/).props.onClick();
    editor.render(); editor.flushEffects();
    button(host.render(), /Синтетическая вторая/).props.onClick();
    assert.ok(dialog(host.render()), "pending write still protects unsaved navigation");
    button(dialog(host.render()), /^Сохранить изменения$/).props.onClick(); await settle();
    assert.ok(dialog(host.render()), "navigation waits for the first write response");
    assert.equal(field(editor.render()).props.value, "Несохранённый синтетический результат", "the original editor remains visible until save completes");
    assert.equal(editorNode(host.render()).props.vacancy.id, "synthetic-a");
    assert.equal(calls.filter((call) => call.url === "/api/vacancies/profile").length, 1, "rapid clicks issue exactly one API write");
    finishSave(); await settle(); editor.render(); editor.flushEffects();
    assert.equal(dialog(host.render()), undefined, "shared successful result closes pending navigation guard");
    assert.equal(editorNode(host.render()).props.vacancy.id, "synthetic-b");
    button(host.render(), /^Активность$/).props.onClick();
    assert.equal(dialog(host.render()), undefined, "next navigation does not reuse a dirty pending controller");
    assert.equal(calls.filter((call) => call.url === "/api/vacancies/profile").length, 1);
  });

test("changing vacancy replaces editor controller and returning restores the saved vacancy without stale dirty state", async (t) => {
  const { runtime, host, editor, calls } = await setup(t);
  button(host.render(), /Синтетическая вторая/).props.onClick();
  button(dialog(host.render()), /^Сохранить изменения$/).props.onClick(); await settle(); editor.render(); editor.flushEffects();
  assert.equal(dialog(host.render()), undefined);
  const nextNode = editorNode(host.render());
  const nextEditor = runtime.mount(nextNode.type, nextNode.props);
  nextEditor.render(); nextEditor.flushEffects(); await settle(); nextEditor.render(); nextEditor.flushEffects();
  editor.dispose(); // Cleanup of the first editor must not clear its successor's ref.
  field(nextEditor.render()).props.onChange({ target: { value: "Черновик второй вакансии" } });
  nextEditor.render(); nextEditor.flushEffects();
  button(host.render(), /Синтетическая первая/).props.onClick();
  assert.ok(dialog(host.render()), "the new editor owns navigation protection after prior editor cleanup");
  assert.equal(editorNode(host.render()).props.vacancy.id, "synthetic-b");
  button(dialog(host.render()), /^Не сохранять$/).props.onClick(); nextEditor.dispose();
  const restoredNode = editorNode(host.render());
  assert.equal(restoredNode.props.vacancy.id, "synthetic-a");
  const restored = runtime.mount(restoredNode.type, restoredNode.props);
  restored.render(); restored.flushEffects(); await settle(); restored.render(); restored.flushEffects();
  assert.equal(field(restored.render()).props.value, "Несохранённый синтетический результат");
  button(host.render(), /^Активность$/).props.onClick();
  assert.equal(dialog(host.render()), undefined, "returning to saved first vacancy has no stale dirty state from second vacancy");
  assert.equal(calls.filter((call) => call.url === "/api/vacancies/profile").length, 1);
});

for (const destination of ["main view", "logout"]) {
  test(`application ${destination} respects the actual unsaved vacancy editor controller`, async (t) => {
    const context = await setup(t, true); const { app, editor, calls } = context;
    const navigate = () => destination === "logout"
      ? button(app.render(), /^Выйти$/).props.onClick()
      : button(app.render(), /Дашборд$/).props.onClick();
    navigate(); await settle();
    let guard = dialog(app.render());
    assert.ok(guard, `${destination} waits for unsaved changes decision`);
    assert.ok(all(app.render(), (node) => node.type?.name === "Vacancies").length, "vacancy view remains mounted");
    assert.equal(context.loggedOut, 0);
    assert.equal(calls.filter((call) => call.url === "/api/auth/logout").length, 0, "no premature logout request");
    button(guard, /^Закрыть/).props.onClick();
    assert.equal(dialog(app.render()), undefined);
    assert.equal(field(editor.render()).props.value, "Несохранённый синтетический результат");
    navigate(); await settle(); guard = dialog(app.render());
    button(guard, /^Сохранить изменения$/).props.onClick(); await settle(); editor.render(); editor.flushEffects();
    assert.equal(dialog(app.render()), undefined);
    assert.equal(calls.filter((call) => call.url === "/api/vacancies/profile").length, 1);
    if (destination === "logout") assert.equal(context.loggedOut, 1, "logout runs exactly once after save");
    else assert.ok(all(app.render(), (node) => node.type?.name === "Dashboard").length, "main destination resumes after save");
  });
}
