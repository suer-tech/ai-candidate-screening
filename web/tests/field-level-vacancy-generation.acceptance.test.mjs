import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cases } from "./fixtures/field-level-vacancy-generation/synthetic-conformance.mjs";
import { runFieldLevelVacancyGenerationScenario, verifyFieldLevelVacancyGenerationOracle } from "./helpers/field-level-vacancy-generation-conformance-harness.mjs";
import { loadVacanciesHarness, loadVacancySettingsHarness } from "./helpers/react-component-harness.mjs";

for (const item of cases) {
  test(`${item.requirements.join("/")}: ${item.title}`, async () => {
    const actual = await runFieldLevelVacancyGenerationScenario(item.fixture);
    const mismatches = verifyFieldLevelVacancyGenerationOracle(actual, item.oracle);
    assert.equal(mismatches.length, 0, mismatches.join("\n"));
  });
}

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node !== "object") return;
  visit(node);
  walk(node.props?.children, visit);
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return textContent(node.props?.children);
}

function findAll(tree, predicate) {
  const matches = [];
  walk(tree, (node) => { if (predicate(node)) matches.push(node); });
  return matches;
}

function hasClass(node, className) {
  return String(node?.props?.className ?? "").split(/\s+/).includes(className);
}

function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";
}

function button(tree, pattern) {
  return findAll(tree, (node) => node.type === "button" && pattern.test(`${node.props?.["aria-label"] ?? ""} ${textContent(node).trim().replace(/›$/, "").trim()}`.trim()))[0];
}

function vacancy(profile = {}, abcDirections = []) {
  return { id: "vacancy-field-ui-001", title: "Синтетическая вакансия поля", short: "СП", avatar: "СП", candidates: 0, ready: 0, progress: 0,
    color: "#000", status: "Черновик", version: 3, templateVersion: "vacancy-profile/v1", profile, abcDirections, archived: false };
}

test("VAC-042/VAC-043 real VacancySettings offers generate and editable prompt controls only for each empty supported field", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());
  const fields = ["Образ результата", "Компетенции", "Стоп-факторы", "Допуск к КЕ"];
  const empty = runtime.create({ vacancy: vacancy(Object.fromEntries(fields.map((field) => [field, ""]))), onNotify() {} });
  let tree = empty.render();
  for (const field of fields) {
    await t.test(field, () => {
      const navigation = button(tree, new RegExp(`^${field}$`));
      assert.ok(navigation, `settings navigation contains ${field}`);
      navigation.props.onClick();
      tree = empty.render();
      const section = findAll(tree, (node) => node.type === "section")[0];
      assert.ok(button(section, /сгенерировать/i), `${field} exposes a compact generation action while empty`);
      assert.ok(button(section, /промпт/i), `${field} exposes its prompt editor action while empty`);
    });
  }

  const filled = runtime.create({ vacancy: vacancy({ "Компетенции": "Уже заполнено" }), onNotify() {} });
  let filledTree = filled.render();
  button(filledTree, /^Компетенции$/).props.onClick();
  filledTree = filled.render();
  const filledSection = findAll(filledTree, (node) => node.type === "section")[0];
  assert.equal(Boolean(button(filledSection, /сгенерировать/i)), false, "generation action is hidden for a non-empty field");
  assert.equal(Boolean(button(filledSection, /промпт/i)), false, "prompt action is hidden together with generation for a non-empty field");

  const filledTextarea = findAll(filledSection, (node) => node.type === "textarea" && node.props?.id === "vacancy-description-field")[0];
  filledTextarea.props.onChange({ target: { value: "" } });
  filledTree = filled.render();
  const clearedSection = findAll(filledTree, (node) => node.type === "section")[0];
  assert.ok(button(clearedSection, /сгенерировать/i), "clearing the field restores generation action");
  assert.ok(button(clearedSection, /промпт/i), "clearing the field restores prompt action together with generation");
});

test("VAC-044 real VacancySettings exposes one ABC generation action only for the actual non-empty composition", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());
  const directions = [{ id: "standard-productivity", name: "Продуктивность", gradeA: "", gradeB: "", gradeC: "", origin: "standard" },
    { id: "custom-care", name: "Забота о клиенте", gradeA: "", gradeB: "", gradeC: "", origin: "custom" }];
  const component = runtime.create({ vacancy: vacancy({}, directions), onNotify() {} });
  let tree = component.render();
  button(tree, /^ABC-критерии$/).props.onClick();
  tree = component.render();
  const section = findAll(tree, (node) => node.type === "section")[0];
  assert.equal(findAll(section, (node) => node.type === "button" && /сгенерировать/i.test(`${node.props?.["aria-label"] ?? ""} ${textContent(node)}`)).length, 1,
    "actual standard/custom composition has one ABC generation action");
  assert.ok(button(section, /промпт/i), "ABC generation exposes its own prompt editor");

  const zero = runtime.create({ vacancy: vacancy({}, []), onNotify() {} });
  let zeroTree = zero.render();
  button(zeroTree, /^ABC-критерии$/).props.onClick();
  zeroTree = zero.render();
  const zeroSection = findAll(zeroTree, (node) => node.type === "section")[0];
  assert.equal(Boolean(button(zeroSection, /сгенерировать/i)), false, "zero directions cannot launch an empty LLM request");
  assert.equal(Boolean(button(zeroSection, /промпт/i)), false, "ABC prompt is hidden whenever its generation action is unavailable");
  assert.match(textContent(zeroSection), /добав.*направлен/i, "zero state explains that a direction must be added first");
});

test("VAC-045 real all-generation cancellation warns about overwriting all populated sections and sends no generation API request", async (t) => {
  const runtime = await loadVacanciesHarness();
  t.after(() => runtime.cleanup());
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return { ok: true, json: async () => ({ generation: { text: "Полный русский промпт", artifactId: "vacancy-profile/v1", hash: "sha256:test" } }) };
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const populated = vacancy({ "Образ результата": "Есть", "Компетенции": "Есть", "Стоп-факторы": "Есть", "Допуск к КЕ": "Есть" },
    [{ id: "standard-productivity", name: "Продуктивность", gradeA: "Есть", gradeB: "Есть", gradeC: "Есть", origin: "standard" }]);
  const component = runtime.create({ candidates: [], vacancyState: { vacancies: [populated] }, onState() {}, onOpen() {}, onNotify() {}, onCandidatesDeleted() {} });
  let tree = component.render();
  button(tree, /Сгенерировать описание/).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  tree = component.render();
  const modalNode = findAll(tree, (node) => typeof node.type === "function" && node.type.name === "VacancyGenerationPromptModal")[0];
  assert.ok(modalNode, "real all-generation modal opens before confirmation");
  const modalTree = modalNode.type(modalNode.props);
  button(modalTree, /^Сгенерировать$/).props.onClick();
  tree = component.render();
  const confirmationNode = findAll(tree, (node) => typeof node.type === "function" && node.type.name === "ConfirmationDialog")[0];
  assert.ok(confirmationNode, "all-generation uses the site's application confirmation dialog");
  const confirmationText = `${confirmationNode.props.title} ${textContent(confirmationNode.props.description)}`;
  assert.match(confirmationText, /все.*раздел/i, "warning explicitly covers all vacancy sections");
  assert.match(confirmationText, /перезапис/i, "warning explicitly says existing values will be overwritten");
  button(confirmationNode.type(confirmationNode.props), /^Отмена$/).props.onClick();
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "cancelling confirmation sends no generation API request");
});

test("VAC-046 real VacancySettings opens the three-action dirty guard before changing settings section", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());
  const component = runtime.create({ vacancy: vacancy({ "Образ результата": "Сохранённое значение", "Компетенции": "" }), onNotify() {} });
  let tree = component.render();
  const textarea = findAll(tree, (node) => node.type === "textarea")[0];
  textarea.props.onChange({ target: { value: "Несохранённое изменение" } });
  tree = component.render();
  button(tree, /^Компетенции$/).props.onClick();
  tree = component.render();
  const dialog = findAll(tree, (node) => node.props?.role === "dialog")[0];
  assert.ok(dialog, "dirty settings transition opens an application dialog");
  const discard = button(dialog, /^Не сохранять$/);
  const save = button(dialog, /^Сохранить изменения$/);
  const close = button(dialog, /закрыть|×|✕/i);
  assert.ok(discard && /danger|red/i.test(String(discard.props?.className ?? "")), "discard is the red action");
  assert.ok(save && /primary|save|blue/i.test(String(save.props?.className ?? "")), "save is the blue action");
  assert.ok(close, "dialog has a close control that cancels navigation");
});

test("unsaved-changes confirmation copy uses the full modal width instead of the empty icon column", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(cssRule(css, ".confirmation-modal.unsaved-changes-modal"), /grid-template-columns\s*:\s*minmax\(0\s*,\s*1fr\)/i,
    "the iconless dialog has one full-width content column");
  assert.match(cssRule(css, ".confirmation-modal.unsaved-changes-modal .confirmation-copy"), /grid-column\s*:\s*1\s*\/\s*-1/i,
    "confirmation text spans the full modal content width");
});

test("field-level generation uses only the AI button spinner without a separate status block", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const settingsSource = source.slice(source.indexOf("export function VacancySettings"), source.indexOf("function UnsavedChangesDialog"));
  assert.match(settingsSource, /className="button-spinner"/, "AI controls retain their inline loading spinner");
  assert.doesNotMatch(settingsSource, /generation-status compact/, "field and ABC generation render no separate loading panel");
  assert.doesNotMatch(settingsSource, /Заполняем только выбранное поле|Генерируем ABC-описания/, "redundant loading copy is absent");
});

test("active field generation requires confirmation before navigation and cancelled work cannot fill the field", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());
  const previousFetch = globalThis.fetch;
  let resolveGeneration;
  let observedSignal;
  globalThis.fetch = async (_url, init = {}) => {
    observedSignal = init.signal;
    return await new Promise((resolve) => { resolveGeneration = resolve; });
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const navigationRef = { current: null };
  const component = runtime.create({ vacancy: vacancy({ "Образ результата": "", "Компетенции": "" }), navigationRef, onNotify() {} });

  let tree = component.render();
  button(tree, /Сгенерировать описание раздела/).props.onClick();
  tree = component.render();
  let dialogNode = findAll(tree, (node) => typeof node.type === "function" && node.type.name === "ConfirmationDialog")[0];
  button(dialogNode.type(dialogNode.props), /^Сгенерировать$/).props.onClick();
  assert.equal(navigationRef.current?.isGenerating(), true, "navigation boundary sees generation synchronously");

  tree = component.render();
  button(tree, /^Компетенции$/).props.onClick();
  tree = component.render();
  dialogNode = findAll(tree, (node) => typeof node.type === "function" && node.type.name === "ConfirmationDialog"
    && /генерац/i.test(String(node.props?.title)))[0];
  assert.ok(dialogNode, "section navigation opens a generation cancellation confirmation");
  assert.match(String(dialogNode.props?.description?.props?.children ?? ""), /генерация.*завершена|поле не будет заполнено/i);
  button(dialogNode.type(dialogNode.props), /^Отмена$/).props.onClick();
  assert.equal(navigationRef.current?.isGenerating(), true, "cancelling navigation leaves generation running");
  assert.equal(observedSignal?.aborted, false, "cancelling navigation does not abort the request");

  button(component.render(), /^Компетенции$/).props.onClick();
  tree = component.render();
  dialogNode = findAll(tree, (node) => typeof node.type === "function" && node.type.name === "ConfirmationDialog"
    && /генерац/i.test(String(node.props?.title)))[0];
  button(dialogNode.type(dialogNode.props), /Прервать и перейти/).props.onClick();
  assert.equal(observedSignal?.aborted, true, "confirmed navigation aborts the active model request");
  assert.equal(navigationRef.current?.isGenerating(), false, "generation lock is released after confirmed cancellation");

  resolveGeneration({ ok: true, json: async () => ({ operation: { state: "SUCCEEDED", result: { field: "Образ результата", text: "Запоздалый результат" } } }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  button(component.render(), /^Образ результата$/).props.onClick();
  const originalField = findAll(component.render(), (node) => node.type === "textarea" && node.props?.id === "vacancy-description-field")[0];
  assert.equal(originalField.props.value, "", "a late successful response cannot populate the cancelled field");
});

test("active field generation guards vacancy tabs and application pages", async (t) => {
  const runtime = await loadVacanciesHarness();
  t.after(() => runtime.cleanup());
  let active = false;
  let cancellations = 0;
  const settingsNavigationRef = { current: {
    async save() { return true; }, discard() {}, isGenerating() { return active; }, cancelGeneration() { active = false; cancellations += 1; },
  } };
  const component = runtime.create({
    candidates: [], vacancyState: { vacancies: [vacancy()], operationBindings: {} }, settingsNavigationRef,
    onState() {}, onOpen() {}, onNotify() {}, onCandidatesDeleted() {},
  });
  button(component.render(), /^Параметры оценки$/).props.onClick();
  active = true;
  button(component.render(), /^Активность$/).props.onClick();
  let tree = component.render();
  let dialogNode = findAll(tree, (node) => typeof node.type === "function" && node.type.name === "ConfirmationDialog"
    && /генерац/i.test(String(node.props?.title)))[0];
  assert.ok(dialogNode, "vacancy tab transition is guarded while generation runs");
  button(dialogNode.type(dialogNode.props), /^Отмена$/).props.onClick();
  assert.equal(active, true, "cancel keeps the request active on the current vacancy tab");
  assert.equal(button(component.render(), /^Параметры оценки$/).props.className, "active");

  button(component.render(), /^Активность$/).props.onClick();
  tree = component.render();
  dialogNode = findAll(tree, (node) => typeof node.type === "function" && node.type.name === "ConfirmationDialog"
    && /генерац/i.test(String(node.props?.title)))[0];
  button(dialogNode.type(dialogNode.props), /Прервать и перейти/).props.onClick();
  assert.equal(cancellations, 1, "confirmed tab transition cancels generation exactly once");
  assert.equal(button(component.render(), /^Активность$/).props.className, "active", "navigation continues after confirmation");

  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /view === "vacancies"\s*&&\s*vacancySettingsNavigation\.current\?\.isGenerating\(\)/,
    "global application navigation uses the same active-generation boundary");
  assert.match(source, /pendingViewAfterGeneration[\s\S]*cancelGenerationAndNavigate/,
    "global page transition is deferred until explicit cancellation confirmation");
});

test("vacancy description settings place compact generation tools inside their actual fields and keep the version note beside Save", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());
  const component = runtime.create({
    vacancy: vacancy({}, [{ id: "standard-productivity", name: "Продуктивность", gradeA: "", gradeB: "", gradeC: "", origin: "standard" }]),
    onNotify() {},
  });

  for (const field of ["Образ результата", "Компетенции", "Стоп-факторы", "Допуск к КЕ"]) {
    button(component.render(), new RegExp(`^${field}$`)).props.onClick();
    const tree = component.render();
    const intro = findAll(tree, (node) => hasClass(node, "settings-intro"))[0];
    const fieldBlock = findAll(tree, (node) => hasClass(node, "settings-field"))[0];
    const fieldHead = findAll(fieldBlock, (node) => hasClass(node, "settings-field-head"))[0];
    const actions = findAll(tree, (node) => hasClass(node, "settings-actions"))[0];
    assert.ok(intro, `${field}: title row exists`);
    assert.match(textContent(intro), new RegExp(field), `${field}: field title stays in the title row`);
    assert.equal(findAll(intro, (node) => node.type === "button").length, 0, `${field}: vacancy/section title row has no field tools`);
    assert.match(textContent(fieldHead), /Правила и наблюдаемые признаки/, `${field}: actual field name stays beside its tools`);
    const prompt = button(fieldHead, /Промпт генерации/);
    const generate = button(fieldHead, /Сгенерировать описание/);
    assert.ok(prompt && textContent(prompt).trim() === "Prompt", `${field}: compact Prompt tool is inside the field`);
    assert.ok(generate && /AI/i.test(textContent(generate)), `${field}: compact AI generation tool is inside the field`);
    assert.ok(String(generate.props?.className ?? "").split(/\s+/).includes("generate-description-button"), `${field}: AI uses the same visual style as the vacancy-wide generation button`);
    assert.doesNotMatch(textContent(generate), /Сгенерировать описание/i, `${field}: the field tool does not duplicate the global action label`);
    assert.doesNotMatch(textContent(intro), /Изменения применяются только/, `${field}: version note is removed from the title row`);
    assert.match(textContent(actions), /Изменения применяются только к новым запускам после сохранения/, `${field}: launch-scope note is beside Save`);
    assert.doesNotMatch(textContent(actions), /верси/i, `${field}: launch-scope note does not expose vacancy versioning`);
    const actionChildren = Array.isArray(actions.props.children) ? actions.props.children.flat(Infinity).filter(Boolean) : [actions.props.children];
    const noteIndex = actionChildren.findIndex((node) => /Изменения применяются только/.test(textContent(node)));
    const saveIndex = actionChildren.findIndex((node) => node?.type === "button" && /^Сохранить$/.test(textContent(node).trim()));
    assert.ok(noteIndex >= 0 && saveIndex > noteIndex, `${field}: note appears to the left of Save`);
  }

  button(component.render(), /^ABC-критерии$/).props.onClick();
  const abcTree = component.render();
  const abcIntro = findAll(abcTree, (node) => hasClass(node, "settings-intro"))[0];
  const abcEditor = findAll(abcTree, (node) => hasClass(node, "abc-direction-editor"))[0];
  const abcTools = findAll(abcEditor, (node) => hasClass(node, "abc-field-tools"))[0];
  assert.equal(findAll(abcIntro, (node) => node.type === "button").length, 0, "ABC title row has no generation tools");
  assert.ok(button(abcTools, /Промпт генерации/) && textContent(button(abcTools, /Промпт генерации/)).trim() === "Prompt", "ABC uses the same compact Prompt tool");
  assert.ok(button(abcTools, /Сгенерировать описания A, B и C/) && /AI/i.test(textContent(button(abcTools, /Сгенерировать описания A, B и C/))), "ABC uses the same compact AI tool immediately above its fields");
  assert.ok(String(button(abcTools, /Сгенерировать описания A, B и C/).props?.className ?? "").split(/\s+/).includes("generate-description-button"), "ABC AI uses the vacancy-wide generation button style");
  assert.equal(findAll(abcTree, (node) => hasClass(node, "abc-direction-summary")).length, 0, "ABC summary field is removed");
  assert.doesNotMatch(textContent(abcTree), /Направления оценки|Наблюдаемые определения A, B и C\./, "obsolete ABC field copy is absent");
});
