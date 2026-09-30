import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { loadVacancyNavigationHarness } from "./helpers/react-component-harness.mjs";

let principal = "synthetic-hr";
let repositoryRead;
mock.module(new URL("../server/auth/request-principal.ts", import.meta.url), {
  namedExports: { requestPrincipal: async () => principal },
});
mock.module(new URL("../server/product/runtime-bindings.ts", import.meta.url), {
  namedExports: { productRepository: async () => ({ dashboardSource: (options) => repositoryRead(options) }) },
});
const { GET } = await import("../app/api/workspace/route.ts");

const fixtureVacancy = { id: "synthetic-summary-vacancy", title: "Синтетическая краткая вакансия", active: true, archived: false, version: 2,
  templateVersion: "vacancy-profile/v1", profile: { "Образ результата": "Синтетический результат" }, abcDirections: [] };
function payload(name = "Синтетический кандидат", detailed = false) {
  const candidate = { id: 701, revision: 2, name, initials: "СК", vacancyId: fixtureVacancy.id, vacancy: fixtureVacancy.title,
    status: "ANALYZING", archived: false, stageStartedAt: "2026-09-30T00:00:00Z", elapsedMinutes: 1, etaMinutes: 3,
    progressPercent: 50, abc: [], result: null };
  if (detailed) {
    candidate.transcript = { syntheticFullContent: "Полная синтетическая стенограмма", segments: [] };
    candidate.assessment = { syntheticFullContent: "Полная синтетическая оценка" };
  }
  return { candidates: [candidate], vacancies: [structuredClone(fixtureVacancy)] };
}
function nodes(tree, predicate, result = []) {
  if (Array.isArray(tree)) tree.forEach((child) => nodes(child, predicate, result));
  else if (tree && typeof tree === "object") {
    if (predicate(tree)) result.push(tree);
    nodes(tree.props?.children, predicate, result);
  }
  return result;
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}
function button(tree, suffix) {
  const item = nodes(tree, (node) => node.type === "button" && text(node).trim().endsWith(suffix))[0];
  assert.ok(item, `navigation button ${suffix} exists`); return item;
}
const component = (tree, name) => nodes(tree, (node) => node.type?.name === name)[0];
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t, { deferSummary = false, deferFull = false, sourcePayload } = {}) {
  const runtime = await loadVacancyNavigationHarness();
  const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const requests = []; const reads = []; const pending = []; const intervals = new Map(); let nextInterval = 1;
  principal = "synthetic-hr";
  repositoryRead = async (options) => {
    const summary = options?.summaryOnly === true;
    reads.push({ summary, options });
    if ((summary && deferSummary) || (!summary && deferFull)) {
      return await new Promise((resolve) => pending.push({ summary, resolve }));
    }
    return sourcePayload ? structuredClone(sourcePayload) : payload("Синтетический кандидат", !summary);
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval(callback, milliseconds) { const id = nextInterval++; intervals.set(id, { callback, milliseconds }); return id; }, clearInterval(id) { intervals.delete(id); }, setTimeout() { return 1; },
    localStorage: { getItem() { return null; }, setItem() {} } };
  globalThis.document = { cookie: "", documentElement: { dataset: {}, style: {} }, addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("/api/workspace")) {
      requests.push({ url: String(url), signal: init.signal });
      // Deliberately let an aborted response resolve: the application must reject
      // obsolete data even if the transport delivers it after cancellation.
      return await GET(new Request(`http://localhost${url}`));
    }
    return Response.json({ connected: false, state: "DISCONNECTED" });
  };
  t.after(async () => { await runtime.cleanup(); Object.assign(globalThis, originals); });
  const app = runtime.mount("ProductApp", { onLogout() {} });
  app.render(); app.flushEffects(); await settle();
  return {
    runtime, app, reads, requests,
    async navigate(label) { button(app.render(), label).props.onClick(); app.render(); app.flushEffects(); await settle(); },
    async pollWorkspace() { for (const timer of intervals.values()) if (timer.milliseconds === 3000) timer.callback(); await settle(); },
    async resolve(summary, body, last = false) {
      const index = last ? pending.findLastIndex((entry) => entry.summary === summary) : pending.findIndex((entry) => entry.summary === summary);
      assert.ok(index >= 0, `${summary ? "summary" : "full"} request is pending`);
      pending.splice(index, 1)[0].resolve(body); await settle();
    },
  };
}

test("workspace GET summary boundary keeps vacancy profiles and candidate metadata without full candidate content", async () => {
  principal = "synthetic-hr";
  const reads = [];
  repositoryRead = async (options) => { reads.push(options); return payload("Синтетический кандидат", options?.summaryOnly !== true); };
  const summary = await GET(new Request("http://localhost/api/workspace?summary=1"));
  assert.equal(summary.status, 200);
  assert.match(summary.headers.get("cache-control"), /no-store/);
  const body = await summary.json();
  assert.deepEqual(body.vacancies[0].profile, fixtureVacancy.profile, "settings can open without a full candidate projection");
  assert.equal(body.candidates[0].vacancyId, fixtureVacancy.id);
  assert.equal(body.candidates[0].transcript, undefined, "summary excludes full transcript");
  assert.equal(body.candidates[0].assessment, undefined, "summary excludes full assessment");
  assert.equal(reads[0]?.summaryOnly, true, "HTTP query selects repository summary projection");
  const full = await (await GET(new Request("http://localhost/api/workspace"))).json();
  assert.equal(full.candidates[0].transcript.syntheticFullContent, "Полная синтетическая стенограмма");
  principal = null;
  const denied = await GET(new Request("http://localhost/api/workspace?summary=1"));
  assert.equal(denied.status, 401, "summary preserves authorization boundary");
  principal = "synthetic-hr";
});

test("vacancies mount from real summary route and candidate detail waits for its full workspace response", async (t) => {
  const context = await setup(t, { deferFull: true }); const { app, runtime, requests } = context;
  await context.navigate("Вакансии");
  assert.equal(requests[0].url, "/api/workspace?summary=1", "opening vacancies uses only the compact endpoint");
  const vacancyNode = component(app.render(), "Vacancies");
  assert.ok(vacancyNode, "vacancies mount as soon as summary arrives");
  const vacancies = runtime.mount(vacancyNode.type, vacancyNode.props);
  const vacancyTree = vacancies.render();
  assert.match(text(vacancyTree), /Синтетическая краткая вакансия/);
  const candidateNode = component(vacancyTree, "VacancyCandidates");
  assert.equal(candidateNode.props.candidates[0].id, 701, "summary links candidate to its vacancy");
  const candidateList = runtime.mount(candidateNode.type, candidateNode.props);
  assert.match(text(candidateList.render()), /Синтетический кандидат/, "actual vacancy candidate list displays summary metadata");
  vacancyNode.props.onOpen(701);
  assert.equal(component(app.render(), "CandidateDetail"), undefined, "loaded summary cannot unlock candidate detail before full fetch effect");
  app.flushEffects(); await settle();
  assert.equal(requests[1].url, "/api/workspace", "opening candidate starts full endpoint");
  assert.equal(component(app.render(), "CandidateDetail"), undefined, "detail remains hidden while full response is pending");
  assert.ok(nodes(app.render(), (node) => node.props?.role === "status").length, "pending detail displays loading status");
  await context.resolve(false, payload("Синтетический кандидат с полными данными", true));
  const detail = component(app.render(), "CandidateDetail");
  assert.ok(detail, "detail mounts after full response");
  assert.equal(detail.props.candidate.transcript.syntheticFullContent, "Полная синтетическая стенограмма");
  assert.equal(detail.props.candidate.assessment.syntheticFullContent, "Полная синтетическая оценка");
});

test("aborted late summary cannot overwrite a newer full workspace response", async (t) => {
  const context = await setup(t, { deferSummary: true, deferFull: true }); const { app, requests } = context;
  await context.navigate("Вакансии");
  assert.equal(requests[0].url, "/api/workspace?summary=1");
  await context.resolve(true, payload());
  await context.pollWorkspace();
  component(app.render(), "Vacancies").props.onOpen(701); app.render(); app.flushEffects(); await settle();
  assert.equal(requests[1].signal.aborted, true, "opening detail aborts the pending summary poll transport");
  await context.resolve(false, payload("Актуальный полный кандидат", true));
  await context.resolve(true, payload("Устаревший краткий кандидат"));
  const detail = component(app.render(), "CandidateDetail");
  assert.equal(detail.props.candidate.name, "Актуальный полный кандидат", "late summary cannot replace the active full detail projection");
  assert.equal(detail.props.candidate.transcript.syntheticFullContent, "Полная синтетическая стенограмма");
});

test("aborted late full detail response cannot overwrite current vacancy summary", async (t) => {
  const context = await setup(t, { deferSummary: true, deferFull: true }); const { app, requests } = context;
  await context.navigate("Вакансии"); await context.resolve(true, payload());
  component(app.render(), "Vacancies").props.onOpen(701); app.render(); app.flushEffects(); await settle();
  await context.navigate("Вакансии");
  assert.equal(requests[1].signal.aborted, true, "leaving a pending detail aborts its full request");
  await context.resolve(true, payload("Актуальный краткий кандидат"));
  await context.resolve(false, payload("Устаревший полный кандидат", true));
  const vacancies = component(app.render(), "Vacancies");
  assert.ok(vacancies);
  assert.equal(vacancies.props.candidates[0].name, "Актуальный краткий кандидат");
  assert.equal(vacancies.props.candidates[0].transcript, undefined, "late full detail does not leak into summary projection");
});

function candidateListPayload() {
  const base = payload().candidates[0];
  const secondVacancy = { ...structuredClone(fixtureVacancy), id: "synthetic-second-vacancy", title: "Синтетическая вторая вакансия" };
  return { vacancies: [structuredClone(fixtureVacancy), secondVacancy], candidates: [
    { ...base, id: 701, name: "Альфа готовый кандидат", status: "READY", elapsedMinutes: 13, result: { version: 1, completedAt: "2026-09-30T00:10:00Z", recommendation: "Рекомендовать", summary: "Синтетическое решение", documents: [
      { id: "synthetic-report", type: "candidate-report", fileName: "Синтетический отчёт.pdf", candidateId: 701, vacancyId: fixtureVacancy.id, version: 1, valid: true, published: true },
    ] } },
    { ...base, id: 702, name: "Бета анализируемый кандидат" },
    { ...base, id: 703, name: "Гамма архивный кандидат", archived: true, status: "FAILED" },
    { ...base, id: 704, name: "Дельта кандидат второй вакансии", vacancyId: secondVacancy.id, vacancy: secondVacancy.title, status: "FAILED" },
  ] };
}
const cardNames = (tree) => nodes(tree, (node) => node.type === "article" && node.props.className === "candidate-card")
  .map((card) => text(nodes(card, (node) => node.type === "h3")[0]));

test("candidate list uses real summary route and preserves search, status, vacancy and archive filters with result metadata", async (t) => {
  const context = await setup(t, { sourcePayload: candidateListPayload() }); const { app, runtime, requests } = context;
  await context.navigate("Кандидаты");
  assert.equal(requests[0].url, "/api/workspace?summary=1", "opening candidates uses summary projection");
  let node = component(app.render(), "Candidates");
  assert.ok(node, "candidate list mounts from compact response");
  const list = runtime.mount(node.type, node.props);
  let tree = list.render();
  assert.deepEqual(cardNames(tree), ["Альфа готовый кандидат", "Бета анализируемый кандидат", "Дельта кандидат второй вакансии"]);
  const readyCard = nodes(tree, (entry) => entry.type === "article" && text(entry).includes("Альфа готовый кандидат"))[0];
  assert.match(text(readyCard), /Рекомендовать/);
  assert.match(text(readyCard), /13 мин/, "ready summary displays observed processing duration");
  const search = nodes(app.render(), (entry) => entry.type === "input" && entry.props.placeholder === "Поиск")[0];
  search.props.onChange({ target: { value: "Бета" } });
  node = component(app.render(), "Candidates"); tree = list.render(node.props);
  assert.deepEqual(cardNames(tree), ["Бета анализируемый кандидат"], "top-level search works on summary names");
  search.props.onChange({ target: { value: "" } }); tree = list.render(component(app.render(), "Candidates").props);
  button(tree, "Готово").props.onClick(); tree = list.render();
  assert.deepEqual(cardNames(tree), ["Альфа готовый кандидат"], "status filter works with compact candidate status");
  button(tree, "Все").props.onClick(); tree = list.render();
  nodes(tree, (entry) => entry.type === "select")[0].props.onChange({ target: { value: "synthetic-second-vacancy" } }); tree = list.render();
  assert.deepEqual(cardNames(tree), ["Дельта кандидат второй вакансии"], "vacancy filter uses retained candidate vacancy identity");
  nodes(tree, (entry) => entry.type === "select")[0].props.onChange({ target: { value: "ALL" } }); tree = list.render();
  button(tree, "Архив").props.onClick(); tree = list.render();
  assert.deepEqual(cardNames(tree), ["Гамма архивный кандидат"], "archive filter retains compact lifecycle metadata");
  await context.pollWorkspace();
  assert.equal(requests.length, 2, "real workspace interval refreshes the list");
  assert.ok(requests.every((entry) => entry.url === "/api/workspace?summary=1"), "regular list poll uses compact endpoint");
});

test("opening a candidate from compact Candidates render fetches full workspace and waits before mounting detail", async (t) => {
  const context = await setup(t, { deferFull: true }); const { app, runtime, requests } = context;
  await context.navigate("Кандидаты");
  assert.equal(requests[0].url, "/api/workspace?summary=1");
  const node = component(app.render(), "Candidates");
  const list = runtime.mount(node.type, node.props);
  const open = nodes(list.render(), (entry) => entry.type === "button" && entry.props["aria-label"] === "Открыть карточку Синтетический кандидат")[0];
  assert.ok(open); open.props.onClick();
  assert.equal(component(app.render(), "CandidateDetail"), undefined, "summary never unlocks detail in the navigation render");
  app.flushEffects(); await settle();
  assert.equal(requests[1].url, "/api/workspace");
  assert.equal(component(app.render(), "CandidateDetail"), undefined, "detail remains blocked while full response is pending");
  await context.resolve(false, payload("Полный кандидат из списка", true));
  const detail = component(app.render(), "CandidateDetail");
  assert.equal(detail.props.candidate.name, "Полный кандидат из списка");
  assert.equal(detail.props.candidate.transcript.syntheticFullContent, "Полная синтетическая стенограмма");
});

test("switching compact vacancy and candidate lists aborts obsolete reads and late responses keep the latest list", async (t) => {
  const context = await setup(t, { deferSummary: true }); const { app, requests } = context;
  await context.navigate("Вакансии");
  await context.navigate("Кандидаты");
  assert.equal(requests[0].signal.aborted, true);
  assert.ok(requests.every((entry) => entry.url === "/api/workspace?summary=1"), "both list views select compact reads");
  await context.resolve(true, payload("Актуальный кандидат списка"), true);
  await context.resolve(true, payload("Устаревший кандидат вакансии"));
  assert.equal(component(app.render(), "Candidates").props.items[0].name, "Актуальный кандидат списка");
});
