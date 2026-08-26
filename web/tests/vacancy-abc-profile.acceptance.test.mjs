import assert from "node:assert/strict";
import test from "node:test";
import { loadVacancySettingsHarness } from "./helpers/react-component-harness.mjs";

const ACCEPTANCE_CASE = Object.freeze({
  id: "ACC-VAC-ABC-001",
  requirements: ["VAC-017", "VAC-019"],
  author: "Independent Codex subagent /root/vacancy_abc_acceptance",
  implementationAuthor: false,
  dataClassification: "synthetic-no-pii-no-secrets",
});

const VALID_DIRECTIONS = [
  {
    id: "standard-productivity",
    name: "Продуктивность",
    gradeA: "Завершает приоритетные задачи с измеримым результатом",
    gradeB: "Завершает задачи после уточнения приоритетов",
    gradeC: "Не доводит согласованные задачи до результата",
    origin: "standard",
  },
  {
    id: "custom-collaboration",
    name: "Командная работа",
    gradeA: "Проактивно устраняет блокеры команды",
    gradeB: "Конструктивно участвует после запроса",
    gradeC: "Игнорирует зависимости команды",
    origin: "custom",
  },
];

function walk(node, visit) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
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
  walk(tree, (node) => {
    if (predicate(node)) matches.push(node);
  });
  return matches;
}

function findButton(tree, label) {
  const buttons = findAll(tree, (node) => node.type === "button");
  const visibleLabel = (node) => textContent(node).trim().replace(/›$/, "").trim();
  const button = buttons.find((node) => visibleLabel(node) === label);
  assert.ok(button, `Button ${JSON.stringify(label)} is present; observed: ${buttons.map((node) => JSON.stringify(textContent(node).trim())).join(", ")}`);
  return button;
}

function versionFrom(tree) {
  const settings = findAll(tree, (node) => node.props?.className === "settings-content")[0];
  assert.ok(settings, "Vacancy settings version state is observable");
  return Number(settings.props?.["data-profile-version"]);
}

function directionCards(tree) {
  return findAll(tree, (node) => node.type === "article" && node.props?.className === "abc-direction-card");
}

function readDraft(tree) {
  return directionCards(tree).map((card) => {
    const input = findAll(card, (node) => node.type === "input")[0];
    const textareas = findAll(card, (node) => node.type === "textarea");
    return {
      id: card.key,
      origin: /Стандартное/.test(textContent(card)) ? "standard" : "custom",
      name: input.props.value,
      gradeA: textareas[0].props.value,
      gradeB: textareas[1].props.value,
      gradeC: textareas[2].props.value,
    };
  });
}

function createSession(runtime, directions = VALID_DIRECTIONS) {
  const notifications = [];
  const vacancy = {
    id: "vacancy-synthetic",
    title: "Синтетическая вакансия",
    short: "СВ",
    avatar: "СВ",
    candidates: 0,
    ready: 0,
    progress: 0,
    color: "#000000",
    status: "Черновик",
    version: 7,
    templateVersion: "vacancy-profile/v1",
    profile: {},
    abcDirections: structuredClone(directions),
  };
  const component = runtime.create({ vacancy, onNotify: (message) => notifications.push(message) });
  let tree = component.render();
  findButton(tree, "ABC-критерии").props.onClick();
  tree = component.render();

  return {
    notifications,
    render() {
      tree = component.render();
      return tree;
    },
    tree() {
      return tree;
    },
    async save() {
      await findButton(tree, "Сохранить").props.onClick();
      tree = component.render();
      return tree;
    },
    clearNotifications() {
      notifications.length = 0;
    },
  };
}

function updateDirectionField(session, directionIndex, field, value) {
  const card = directionCards(session.tree())[directionIndex];
  assert.ok(card, `Direction ${directionIndex} is present`);
  const control = field === "name"
    ? findAll(card, (node) => node.type === "input")[0]
    : findAll(card, (node) => node.type === "textarea")[{ gradeA: 0, gradeB: 1, gradeC: 2 }[field]];
  control.props.onChange({ target: { value } });
  session.render();
}

async function assertRejectedWithoutMutation(session, expectedDraft, messagePattern) {
  const beforeVersion = versionFrom(session.tree());
  await session.save();
  assert.deepEqual(readDraft(session.tree()), expectedDraft, "Rejected save preserves values, ids, origin and order");
  assert.equal(versionFrom(session.tree()), beforeVersion, "Rejected save must not change version");
  assert.ok(session.notifications.some((message) => messagePattern.test(message)), "HR receives a relevant rejection reason");
  assert.ok(!session.notifications.some((message) => /сохранён как версия/i.test(message)), "Rejected save has no success confirmation");
}

test(`${ACCEPTANCE_CASE.id}: VAC-017/VAC-019 save boundary`, async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());

  await t.test("environment control: component renders and exposes the real save action", () => {
    const session = createSession(runtime);
    assert.equal(versionFrom(session.tree()), 7);
    assert.equal(directionCards(session.tree()).length, 2);
    assert.equal(typeof findButton(session.tree(), "Сохранить").props.onClick, "function");
  });

  await t.test("accepts a profile with no ABC directions", () => {
    const previousFetch = globalThis.fetch;
    const previousDocument = globalThis.document;
    globalThis.document = { cookie: "csrf_token=synthetic" };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ vacancy: {
      id: "vacancy-synthetic", title: "Синтетическая вакансия", version: 8, templateVersion: "vacancy-profile/v1", profile: {}, abcDirections: [],
    } }) });
    const session = createSession(runtime, []);
    return session.save().then(() => {
      assert.equal(session.notifications.filter((message) => /^Профиль вакансии сохранён$/i.test(message)).length, 1);
    }).finally(() => { globalThis.fetch = previousFetch; globalThis.document = previousDocument; });
  });

  for (const blankName of ["", " \t "]) {
    await t.test(`rejects ${JSON.stringify(blankName)} direction name after trim`, async () => {
      const session = createSession(runtime);
      updateDirectionField(session, 0, "name", blankName);
      const expectedDraft = readDraft(session.tree());
      await assertRejectedWithoutMutation(session, expectedDraft, /назван/i);
    });
  }

  await t.test("accepts directions with empty A, B and C descriptions", () => {
    const directions = VALID_DIRECTIONS.map((direction) => ({ ...direction, gradeA: "", gradeB: "", gradeC: "" }));
    const previousFetch = globalThis.fetch;
    const previousDocument = globalThis.document;
    globalThis.document = { cookie: "csrf_token=synthetic" };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ vacancy: {
      id: "vacancy-synthetic", title: "Синтетическая вакансия", version: 8, templateVersion: "vacancy-profile/v1", profile: {}, abcDirections: directions,
    } }) });
    const session = createSession(runtime, directions);
    return session.save().then(() => {
      assert.equal(session.notifications.filter((message) => /^Профиль вакансии сохранён$/i.test(message)).length, 1);
    }).finally(() => { globalThis.fetch = previousFetch; globalThis.document = previousDocument; });
  });

  await t.test("rejects names equal after trim and case-insensitive comparison", async () => {
    const session = createSession(runtime);
    updateDirectionField(session, 0, "name", "Инициатива");
    updateDirectionField(session, 1, "name", "  иНиЦиАтИвА  ");
    const expectedDraft = readDraft(session.tree());
    await assertRejectedWithoutMutation(session, expectedDraft, /повтор|уникаль/i);
  });

  await t.test("one valid save increments the internal version exactly once without exposing it", () => {
    const previousFetch = globalThis.fetch;
    const previousDocument = globalThis.document;
    globalThis.document = { cookie: "csrf_token=synthetic" };
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ vacancy: {
        id: "vacancy-synthetic", title: "Синтетическая вакансия", version: 8, templateVersion: "vacancy-profile/v1", profile: {}, abcDirections: structuredClone(VALID_DIRECTIONS),
      } }),
    });
    const session = createSession(runtime);
    const beforeDraft = readDraft(session.tree());
    return session.save().then(() => {
      assert.deepEqual(readDraft(session.tree()), beforeDraft);
      assert.equal(session.notifications.filter((message) => /^Профиль вакансии сохранён$/i.test(message)).length, 1);
    }).finally(() => { globalThis.fetch = previousFetch; globalThis.document = previousDocument; });
  });
});
