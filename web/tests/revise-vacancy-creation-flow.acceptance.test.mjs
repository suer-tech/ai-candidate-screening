import assert from "node:assert/strict";
import test from "node:test";
import { loadProductUiHarness, findAll, readProductSource, textContent } from "./helpers/product-acceptance-harness.mjs";

const model = await import("../app/product-model.ts");
const profile = { "Образ результата": "Измеримый результат", "Компетенции": "Наблюдаемые признаки", "Стоп-факторы": "Проверяемые условия", "Допуск к КЕ": "Обязательные условия" };
const abcDirections = [{ id: "standard-1", name: "Продуктивность", gradeA: "A", gradeB: "B", gradeC: "C", origin: "standard" }];
const input = { operationId: "acceptance-op-086", title: "  Бизнес   ассистент ", profile, abcDirections, templateVersion: "standard-v1" };
const visibleVacancy = { ...model.createVacancyAtomically({ vacancies: [], operationBindings: {} }, input).vacancy, short: "БА", avatar: "БА", color: "#123456" };
const vacancyState = { vacancies: [visibleVacancy], operationBindings: {} };

test("TST-086: manual create-vacancy flow produces one active v1 vacancy without generation/preview/activation", async (t) => {
  const created = model.createVacancyAtomically({ vacancies: [], operationBindings: {} }, input);
  assert.equal(created.vacancy.title, "Бизнес ассистент");
  assert.equal(created.vacancy.normalizedTitle, "бизнес ассистент");
  assert.equal(created.vacancy.active, true);
  assert.equal(created.vacancy.version, 1);
  assert.ok(created.vacancy.id);
  assert.ok(created.vacancy.driveFolderId);

  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const view = runtime.create("CreateVacancy", { existing: vacancyState, onClose() {}, onCreated() {} });
  const tree = view.render();
  assert.match(textContent(tree), /Название вакансии/);
  assert.doesNotMatch(textContent(tree), /Сформировать черновик|Предпросмотр|Активировать/);
  assert.ok(findAll(tree, (node) => node.type === "input").length === 1, "First screen contains only the mandatory title input");
});

test("TST-087: invalid, duplicate and abandoned forms create no persisted vacancy/version", async (t) => {
  assert.match(model.validateVacancyTitle("   ", []), /обязательно/i);
  const first = model.createVacancyAtomically({ vacancies: [], operationBindings: {} }, input);
  assert.match(model.validateVacancyTitle(" бизнес АССИСТЕНТ ", first.state.vacancies), /существует/i);
  for (const key of Object.keys(profile)) {
    const missing = model.validateFullVacancyProfile({ ...input, profile: { ...profile, [key]: " " } });
    assert.ok(missing.includes(key), `Mandatory field ${key} is rejected`);
  }
  assert.ok(model.validateFullVacancyProfile({ ...input, abcDirections: [...abcDirections, { ...abcDirections[0], id: "duplicate", name: "  продуктивность  " }] }).some((item) => /уникаль/i.test(item)));

  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const tree = runtime.create("CreateVacancy", { existing: vacancyState, onClose() {}, onCreated() {} }).render();
  const source = await readProductSource();
  assert.match(source, /(?:window\.)?confirm\([^\n]{0,100}(?:несохран|стандартн|сброс|вернуть)/i, "Changed form has a discard/reset confirmation contract");
  assert.match(source, /standard-v\d|templateVersion/i, "Standard ABC template is explicitly versioned");
  assert.equal(findAll(tree, (node) => /Сохранить как черновик/i.test(textContent(node))).length, 0);
});

test("TST-088: Drive provisioning exposes injectable timeout/failure recovery and idempotent binding", () => {
  const first = model.createVacancyAtomically({ vacancies: [], operationBindings: {} }, input);
  const retried = model.createVacancyAtomically(first.state, input);
  assert.equal(retried.state.vacancies.length, 1);
  assert.equal(retried.vacancy.id, first.vacancy.id);
  assert.equal(retried.vacancy.driveFolderId, first.vacancy.driveFolderId);
  const driveCreate = model.createVacancyWithDrive ?? model.provisionAndCreateVacancy ?? model.createVacancyOperation;
  assert.ok(
    typeof driveCreate === "function" || model.createVacancyAtomically.length >= 3,
    "Acceptance requires an injectable Drive provisioner to verify timeout-after-create and terminal failure without publishing partial vacancy state",
  );
});
