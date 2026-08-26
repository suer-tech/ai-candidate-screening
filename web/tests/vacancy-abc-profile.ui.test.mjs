import assert from "node:assert/strict";
import test from "node:test";
import { loadVacancySettingsHarness } from "./helpers/react-component-harness.mjs";

const VALID_DIRECTION = {
  id: "synthetic-productivity",
  name: "Продуктивность",
  gradeA: "Превосходит ожидаемый результат",
  gradeB: "Достигает ожидаемого результата",
  gradeC: "Не достигает ожидаемого результата",
  origin: "custom",
};

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (node === null || node === undefined || typeof node === "boolean" || typeof node !== "object") return;
  visit(node);
  walk(node.props?.children, visit);
}

function findAll(tree, predicate) {
  const result = [];
  walk(tree, (node) => { if (predicate(node)) result.push(node); });
  return result;
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return textContent(node.props?.children);
}

function button(tree, label) {
  const result = findAll(tree, (node) => node.type === "button" && textContent(node).replace(/›$/, "").trim() === label)[0];
  assert.ok(result, `Button ${label} is present`);
  return result;
}

function version(tree) {
  const settings = findAll(tree, (node) => node.props?.className === "settings-content")[0];
  return Number(settings?.props?.["data-profile-version"]);
}

function createSession(runtime, directions) {
  const notifications = [];
  const component = runtime.create({
    vacancy: {
      title: "Синтетическая вакансия",
      short: "СВ",
      avatar: "СВ",
      candidates: 0,
      ready: 0,
      progress: 0,
      color: "#000",
      status: "Черновик",
      version: 7,
      profile: {},
      abcDirections: structuredClone(directions),
    },
    onNotify: (message) => notifications.push(message),
  });
  let tree = component.render();
  button(tree, "ABC-критерии").props.onClick();
  tree = component.render();
  return {
    notifications,
    tree: () => tree,
    render: () => (tree = component.render()),
    save: () => { button(tree, "Сохранить").props.onClick(); tree = component.render(); },
  };
}

test("VacancySettings shows persistent accessible ABC validation feedback", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());

  await t.test("shows a non-blocking empty state when no direction exists", () => {
    const session = createSession(runtime, []);
    const alerts = findAll(session.tree(), (node) => node.props?.role === "alert");
    assert.equal(version(session.tree()), 7);
    assert.equal(alerts.length, 0);
    assert.match(textContent(session.tree()), /добавьте хотя бы одно направление/i);
  });

  await t.test("links a field error to the invalid direction name and clears it after correction", () => {
    const session = createSession(runtime, [VALID_DIRECTION]);
    let input = findAll(session.tree(), (node) => node.type === "input")[0];
    input.props.onChange({ target: { value: "  " } });
    session.render();
    session.save();

    input = findAll(session.tree(), (node) => node.type === "input")[0];
    assert.equal(version(session.tree()), 7);
    assert.equal(input.props["aria-invalid"], true);
    assert.ok(input.props["aria-describedby"]);
    const describedError = findAll(session.tree(), (node) => node.props?.id === input.props["aria-describedby"])[0];
    assert.match(textContent(describedError), /название/i);
    assert.ok(!session.notifications.some((message) => /сохранён как версия/i.test(message)));

    input.props.onChange({ target: { value: "Исправленное направление" } });
    session.render();
    input = findAll(session.tree(), (node) => node.type === "input")[0];
    assert.equal(input.props["aria-invalid"], false);
    assert.equal(input.props["aria-describedby"], undefined);
    assert.equal(version(session.tree()), 7);
  });
});
