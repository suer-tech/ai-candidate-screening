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
  return Number(textContent(tree).match(/Синтетическая вакансия · версия (\d+)/)?.[1]);
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
    save: () => { button(tree, "Сохранить новую версию").props.onClick(); tree = component.render(); },
  };
}

test("VacancySettings shows persistent accessible ABC validation feedback", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());

  await t.test("shows a collection alert when no direction exists", () => {
    const session = createSession(runtime, []);
    session.save();
    const alerts = findAll(session.tree(), (node) => node.props?.role === "alert");
    assert.equal(version(session.tree()), 7);
    assert.ok(alerts.some((node) => /хотя бы одно ABC-направление/i.test(textContent(node))));
  });

  await t.test("links a field error to the invalid textarea and clears it after correction", () => {
    const session = createSession(runtime, [VALID_DIRECTION]);
    let textarea = findAll(session.tree(), (node) => node.type === "textarea")[0];
    textarea.props.onChange({ target: { value: "  " } });
    session.render();
    session.save();

    textarea = findAll(session.tree(), (node) => node.type === "textarea")[0];
    assert.equal(version(session.tree()), 7);
    assert.equal(textarea.props["aria-invalid"], true);
    assert.ok(textarea.props["aria-describedby"]);
    const describedError = findAll(session.tree(), (node) => node.props?.id === textarea.props["aria-describedby"])[0];
    assert.match(textContent(describedError), /определение A/i);
    assert.ok(!session.notifications.some((message) => /сохранён как версия/i.test(message)));

    textarea.props.onChange({ target: { value: "Исправленное определение A" } });
    session.render();
    textarea = findAll(session.tree(), (node) => node.type === "textarea")[0];
    assert.equal(textarea.props["aria-invalid"], false);
    assert.equal(textarea.props["aria-describedby"], undefined);
    assert.equal(version(session.tree()), 7);
  });
});
