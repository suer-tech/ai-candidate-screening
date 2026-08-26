import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findAll, loadProductUiHarness, textContent } from "./helpers/product-acceptance-harness.mjs";

process.env.ROUTERAI_STRUCTURED_OUTPUTS = "true";

const profile = { "Образ результата": "Результат", "Компетенции": "Компетенции", "Стоп-факторы": "Стоп-факторы", "Допуск к КЕ": "Допуск" };
const abcDirections = [{ id: "abc-1", name: "Направление", gradeA: "A", gradeB: "B", gradeC: "C", origin: "standard" }];

function vacancy(id, archived) {
  return {
    id,
    title: archived ? "Архивная вакансия" : "Активная вакансия",
    normalizedTitle: archived ? "архивная вакансия" : "активная вакансия",
    active: !archived,
    archived,
    version: 1,
    templateVersion: "synthetic-v1",
    driveFolderId: `drive-${id}`,
    profile,
    abcDirections,
    short: archived ? "Архивная" : "Активная",
    avatar: archived ? "АР" : "АК",
    color: "#168cff",
  };
}

function candidate(id, vacancyId) {
  return {
    id,
    name: `Кандидат ${id}`,
    initials: "КТ",
    vacancyId,
    vacancy: "Активная вакансия",
    archived: false,
    status: "READY",
    stageStartedAt: "2026-08-21T00:00:00.000Z",
    elapsedMinutes: 1,
    etaMinutes: 0,
    result: null,
    tone: "blue",
    updated: "сегодня",
  };
}

function button(tree, label) {
  const found = findAll(tree, (node) => node.type === "button" && textContent(node).replace(/^\P{L}+/u, "").trim() === label)[0];
  assert.ok(found, `button ${JSON.stringify(label)} is present; rendered=${JSON.stringify(textContent(tree))}`);
  return found;
}

async function ui(t, { candidates = [], onState = () => {} } = {}) {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = { location: { reload() {} } };
  globalThis.fetch = async () => { throw new Error("Unexpected network call"); };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  });
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const view = runtime.create("Vacancies", {
    candidates,
    vacancyState: { vacancies: [vacancy("active", false), vacancy("archived", true)], operationBindings: {} },
    onState,
    onOpen() {},
    onNotify() {},
    onCandidatesDeleted() {},
  });
  return { view, tree: view.render() };
}

test("ACC-VAC-LIFECYCLE-001: vacancy model and UI distinguish active and archived vacancies", async (t) => {
  const modelSource = await import("../app/product-model.ts").then(() => import("node:fs/promises")).then(({ readFile }) => readFile(new URL("../app/product-model.ts", import.meta.url), "utf8"));
  assert.match(modelSource, /type VacancyRecord\s*=\s*\{[^}]*archived\s*:\s*boolean/s, "VacancyRecord must persist an explicit archived state");

  const { view, tree } = await ui(t);
  button(tree, "Активные");
  const archiveFilter = button(tree, "Архив");
  assert.match(textContent(tree), /Активная вакансия/);
  assert.doesNotMatch(textContent(tree), /Архивная вакансия/, "active filter excludes archived vacancies");
  assert.ok(findAll(tree, (node) => node.type === "button" && textContent(node).trim() === "В архив" && node.props?.className === "danger-button").length === 1, "an active vacancy exposes the red archive action");

  archiveFilter.props.onClick();
  const archivedTree = view.render();
  assert.match(textContent(archivedTree), /Архивная вакансия/);
  assert.doesNotMatch(textContent(archivedTree), /Активная вакансия/, "archive filter excludes active vacancies");
  button(archivedTree, "Восстановить");
  button(archivedTree, "Удалить");
  assert.equal(findAll(archivedTree, (node) => node.type === "button" && /В архив/.test(textContent(node))).length, 0, "archived vacancy cannot be archived again");
});

test("ACC-VAC-LIFECYCLE-002: styled confirmation allows deleting vacancies with or without candidates", async (t) => {
  const empty = await ui(t);
  button(empty.tree, "В архив").props.onClick();
  const archiveDialog = findAll(empty.view.render(), (node) => node.type?.name === "ConfirmationDialog")[0];
  assert.ok(archiveDialog, "archive action opens the site-styled confirmation dialog before any request");
  assert.equal(archiveDialog.props.confirmLabel, "В архив");
  assert.match(textContent(archiveDialog.props.description), /новые кандидаты.*не будут приниматься/i);
  button(empty.tree, "Архив").props.onClick();
  const archivedTree = empty.view.render();
  const deleteButton = button(archivedTree, "Удалить");
  assert.equal(deleteButton.props.disabled, false, "archived vacancy without candidates may be deleted");
  deleteButton.props.onClick();
  const emptyDialog = findAll(empty.view.render(), (node) => node.type?.name === "ConfirmationDialog")[0];
  assert.ok(emptyDialog, "site-styled confirmation dialog is shown");
  assert.match(textContent(emptyDialog.props.description), /Вакансия будет безвозвратно удалена/);
  assert.doesNotMatch(await readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), /Окончательно удалить вакансию[^]*window\.confirm/);

  const bound = await ui(t, { candidates: [candidate(1, "archived")] });
  button(bound.tree, "В архив").props.onClick();
  assert.ok(findAll(bound.view.render(), (node) => node.type?.name === "ConfirmationDialog")[0], "bound vacancy archive also requires confirmation");
  button(bound.tree, "Архив").props.onClick();
  const boundDelete = button(bound.view.render(), "Удалить");
  assert.equal(boundDelete.props.disabled, false, "archived vacancy with candidates may be deleted after confirmation");
  boundDelete.props.onClick();
  const boundDialog = findAll(bound.view.render(), (node) => node.type?.name === "ConfirmationDialog")[0];
  assert.match(textContent(boundDialog.props.description), /1 кандидат/);
  assert.match(textContent(boundDialog.props.description), /Вместе с вакансией.*удалены.*кандидат/s);
});

test("ACC-VAC-LIFECYCLE-003: server lifecycle is authorized, audited, and cascades candidates", async () => {
  const route = await import("../app/api/vacancies/lifecycle/route.ts").catch(() => ({}));
  assert.equal(typeof route.POST, "function", "POST /api/vacancies/lifecycle must exist");
  const unauthorized = await route.POST(new Request("http://localhost/api/vacancies/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vacancyId: "active", action: "archive" }),
  }));
  assert.equal(unauthorized.status, 401, "anonymous vacancy lifecycle commands are rejected");

  const application = await import("../server/product/application.ts");
  const conformance = application.runVacancyLifecycleConformanceScenario ?? application.runVacancyLifecycleScenario;
  assert.equal(typeof conformance, "function", "vacancy lifecycle needs an executable server/domain conformance boundary");
  const result = await conformance({
    actor: "synthetic-hr",
    activeVacancyId: "vacancy-active",
    emptyArchivedVacancyId: "vacancy-empty-archived",
    occupiedArchivedVacancyId: "vacancy-occupied-archived",
  });
  assert.deepEqual(result.archive, { status: "SUCCEEDED", archived: true, audit: { action: "archive", outcome: "success" } });
  assert.deepEqual(result.restore, { status: "SUCCEEDED", archived: false, audit: { action: "restore", outcome: "success" } });
  assert.deepEqual(result.deleteEmpty, { status: "SUCCEEDED", deleted: true, audit: { action: "delete", outcome: "success" } });
  assert.deepEqual(result.deleteOccupied, { status: "SUCCEEDED", deleted: true, candidatesDeleted: true, audit: { action: "delete", outcome: "success" } });
});

test("ACC-VAC-LIFECYCLE-005: postgres vacancy deletion scopes history cleanup and deletes bound candidates in one transaction", async () => {
  const source = await readFile(new URL("../server/product/postgres-repository.ts", import.meta.url), "utf8");
  const lifecycle = source.slice(source.indexOf("async commitVacancyLifecycle("), source.indexOf("async appendVacancyLifecycleAudit("));
  assert.match(lifecycle, /record_json::jsonb->>'vacancyId'/);
  assert.match(lifecycle, /set_config\('hh\.cleanup_run_ids'/);
  assert.match(lifecycle, /candidate_tombstones/);
  assert.match(lifecycle, /candidate_drive_folder_tombstones/);
  assert.match(lifecycle, /DELETE FROM candidates WHERE id IN/);
  assert.ok(lifecycle.indexOf("DELETE FROM candidates WHERE id IN") < lifecycle.indexOf("DELETE FROM vacancies WHERE id="));
  assert.doesNotMatch(lifecycle, /VACANCY_HAS_CANDIDATES/);
});

test("ACC-VAC-LIFECYCLE-004: archived vacancy folders are excluded before automatic discovery/intake", async () => {
  const model = await import("../app/product-model.ts");
  const filter = model.filterDiscoverableCandidateFolders ?? model.selectDiscoverableCandidateFolders;
  assert.equal(typeof filter, "function", "discovery must expose an executable active-vacancy eligibility boundary");
  const folders = [
    { folderId: "candidate-active", vacancyFolderId: "drive-active", displayName: "Активный кандидат", parentPath: "Найм/Активная" },
    { folderId: "candidate-archived", vacancyFolderId: "drive-archived", displayName: "Архивный кандидат", parentPath: "Найм/Архивная" },
  ];
  const eligible = filter(folders, [vacancy("active", false), vacancy("archived", true)]);
  assert.deepEqual(eligible.map((item) => item.folderId), ["candidate-active"], "archived vacancy never enters automatic discovery/intake");
  const workerSource = await readFile(new URL("../server/candidate-pipeline/discovery-worker.ts", import.meta.url), "utf8");
  assert.match(workerSource, /filterDiscoverableCandidateFolders|selectDiscoverableCandidateFolders/, "production discovery worker must apply vacancy eligibility before registration and intake");
});
