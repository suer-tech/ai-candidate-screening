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

async function setup(t, { deferSummary = false, deferFull = false } = {}) {
  const runtime = await loadVacancyNavigationHarness();
  const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const requests = []; const reads = []; const pending = [];
  principal = "synthetic-hr";
  repositoryRead = async (options) => {
    const summary = options?.summaryOnly === true;
    reads.push({ summary, options });
    if ((summary && deferSummary) || (!summary && deferFull)) {
      return await new Promise((resolve) => pending.push({ summary, resolve }));
    }
    return payload("Синтетический кандидат", !summary);
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; },
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
    async resolve(summary, body) {
      const index = pending.findIndex((entry) => entry.summary === summary);
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
  await context.navigate("Кандидаты");
  assert.equal(requests[0].signal.aborted, true, "switching views aborts the pending summary transport");
  await context.resolve(false, payload("Актуальный полный кандидат", true));
  await context.resolve(true, payload("Устаревший краткий кандидат"));
  const candidates = component(app.render(), "Candidates");
  assert.equal(candidates.props.items[0].name, "Актуальный полный кандидат", "late summary cannot replace the active full view projection");
  assert.equal(candidates.props.items[0].transcript.syntheticFullContent, "Полная синтетическая стенограмма");
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
