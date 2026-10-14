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
const detailUrl = (candidateId) => `/api/workspace?candidateId=${encodeURIComponent(JSON.stringify(candidateId))}`;

async function setup(t, { deferSummary = false, deferFull = false, sourcePayload } = {}) {
  const runtime = await loadVacancyNavigationHarness();
  const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const requests = []; const reads = []; const pending = []; const intervals = new Map(); let nextInterval = 1;
  principal = "synthetic-hr";
  repositoryRead = async (options) => {
    const summary = options?.summaryOnly === true;
    reads.push({ summary, options });
    if ((summary && deferSummary) || (!summary && deferFull)) {
      return await new Promise((resolve, reject) => pending.push({ summary, options, resolve, reject }));
    }
    const body = sourcePayload ? structuredClone(sourcePayload) : payload("Синтетический кандидат", !summary);
    if (options?.candidateId !== undefined) body.candidates = body.candidates.filter((candidate) => candidate.id === options.candidateId);
    return body;
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
    async resolveCandidate(candidateId, body) {
      const index = pending.findIndex((entry) => entry.options?.candidateId === candidateId);
      assert.ok(index >= 0, `candidate-scoped request ${JSON.stringify(candidateId)} is pending`);
      pending.splice(index, 1)[0].resolve(body); await settle();
    },
    async rejectCandidate(candidateId) {
      const index = pending.findIndex((entry) => entry.options?.candidateId === candidateId);
      assert.ok(index >= 0, "selected candidate request is pending");
      pending.splice(index, 1)[0].reject(new Error("synthetic scoped repository outage")); await settle();
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

for (const candidateId of [701, "701", "synthetic/public id + русский", "x".repeat(200)]) {
  test(`workspace GET selected detail preserves typed ID ${JSON.stringify(candidateId).slice(0, 45)}`, async () => {
    principal = "synthetic-hr";
    const reads = [];
    repositoryRead = async (options) => {
      reads.push(options);
      const body = payload("Только выбранный кандидат", true);
      body.candidates[0].id = candidateId;
      return body;
    };
    const response = await GET(new Request(`http://localhost${detailUrl(candidateId)}`));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(reads, [{ summaryOnly: false, candidateId }], "Repository receives the exact typed selection, never a broad full read");
    const body = await response.json();
    assert.equal(body.candidates.length, 1);
    assert.equal(body.candidates[0].id, candidateId);
    assert.equal(typeof body.candidates[0].id, typeof candidateId);
    assert.deepEqual(body.vacancies[0].profile, fixtureVacancy.profile, "Workspace envelope is backward compatible");
  });
}

for (const encoded of ["", "not-json", '""', '"   "', JSON.stringify("x".repeat(201)), "0", "-1", "1.5", "9007199254740992", "null", "true", "[]", "{}"] ) {
  test(`workspace GET rejects invalid selected ID ${encoded.slice(0, 30)}`, async () => {
    principal = "synthetic-hr";
    let reads = 0;
    repositoryRead = async () => { reads += 1; return payload(); };
    const response = await GET(new Request(`http://localhost/api/workspace?candidateId=${encodeURIComponent(encoded)}`));
    assert.equal(response.status, 400);
    assert.equal(reads, 0, "Invalid selection cannot trigger a broad repository read");
  });
}

test("workspace selected detail preserves authorization and reports a missing candidate without fallback", async () => {
  let reads = 0;
  repositoryRead = async () => { reads += 1; return { candidates: [], vacancies: [fixtureVacancy] }; };
  principal = null;
  const denied = await GET(new Request(`http://localhost${detailUrl(999)}`));
  assert.equal(denied.status, 401);
  assert.equal(reads, 0);
  principal = "synthetic-hr";
  const missing = await GET(new Request(`http://localhost${detailUrl(999)}`));
  assert.equal(missing.status, 404, "A missing selection must not fall back to another candidate or return broad data");
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
  assert.equal(requests[1].url, detailUrl(701), "opening candidate requests only the selected full projection");
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
  assert.equal(requests[1].url, detailUrl(701));
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

function selectedPayload(candidateId, name = "Выбранный полный кандидат") {
  const body = payload(name, true);
  body.candidates[0].id = candidateId;
  return body;
}

test("candidate detail and its polls use only selected projection and merge without dropping other list candidates", async (t) => {
  const initial = candidateListPayload();
  const context = await setup(t, { deferFull: true, sourcePayload: initial });
  await context.navigate("Кандидаты");
  component(context.app.render(), "Candidates").props.onOpen(701);
  context.app.render(); context.app.flushEffects(); await settle();
  assert.equal(context.requests.at(-1).url, detailUrl(701));
  await context.resolveCandidate(701, selectedPayload(701));
  assert.equal(component(context.app.render(), "CandidateDetail").props.candidate.id, 701);
  await context.pollWorkspace();
  assert.equal(context.requests.at(-1).url, detailUrl(701), "Detail poll never loads every candidate's private content");
  assert.ok(context.requests.every((request) => request.url !== "/api/workspace"), "No broad workspace fetch for detail or polls");
  await context.resolveCandidate(701, selectedPayload(701, "Обновлённый выбранный кандидат"));
  component(context.app.render(), "CandidateDetail").props.onBack();
  const list = component(context.app.render(), "Candidates");
  assert.deepEqual(list.props.items.map((item) => item.id).sort(), initial.candidates.map((item) => item.id).sort());
  for (const expected of initial.candidates.filter((item) => item.id !== 701)) {
    assert.equal(list.props.items.find((item) => item.id === expected.id).name, expected.name);
  }
});

for (const secondId of [702, "701"]) {
  test(`changing selected candidate to ${JSON.stringify(secondId)} cancels old request and ignores a late old response`, async (t) => {
    const initial = candidateListPayload();
    initial.candidates.push({ ...payload().candidates[0], id: "701", name: "Строковый ID, другой кандидат" });
    const context = await setup(t, { deferFull: true, sourcePayload: initial });
    await context.navigate("Кандидаты");
    const open = component(context.app.render(), "Candidates").props.onOpen;
    open(701); context.app.render(); context.app.flushEffects(); await settle();
    const first = context.requests.at(-1);
    assert.equal(first.url, detailUrl(701));
    open(secondId);
    assert.equal(component(context.app.render(), "CandidateDetail"), undefined, "No summary or previous candidate may flash for the new selection");
    context.app.flushEffects(); await settle();
    assert.equal(first.signal.aborted, true);
    assert.equal(context.requests.at(-1).url, detailUrl(secondId), "Same-view selection change starts a new typed scoped request");
    await context.resolveCandidate(secondId, selectedPayload(secondId, "Актуальный второй кандидат"));
    await context.resolveCandidate(701, selectedPayload(701, "Устаревший первый кандидат"));
    const detail = component(context.app.render(), "CandidateDetail");
    assert.equal(detail.props.candidate.id, secondId);
    assert.equal(detail.props.candidate.name, "Актуальный второй кандидат");
  });
}

for (const outcome of ["empty", "error", "wrong candidate"]) {
  test(`new candidate ${outcome} response cannot expose a previously loaded candidate or fallback`, async (t) => {
    const context = await setup(t, { deferFull: true, sourcePayload: candidateListPayload() });
    await context.navigate("Кандидаты");
    const open = component(context.app.render(), "Candidates").props.onOpen;
    open(701); context.app.render(); context.app.flushEffects(); await settle();
    assert.equal(context.requests.at(-1).url, detailUrl(701));
    await context.resolveCandidate(701, selectedPayload(701));
    assert.equal(component(context.app.render(), "CandidateDetail").props.candidate.id, 701);
    open(702);
    assert.equal(component(context.app.render(), "CandidateDetail"), undefined, "Previously loaded full data does not authorize another selection");
    context.app.flushEffects(); await settle();
    assert.equal(context.requests.at(-1).url, detailUrl(702));
    if (outcome === "error") await context.rejectCandidate(702);
    else await context.resolveCandidate(702, outcome === "empty" ? { candidates: [], vacancies: [fixtureVacancy] } : selectedPayload(701));
    assert.equal(component(context.app.render(), "CandidateDetail"), undefined, "Missing/error/mismatched response must not show a different candidate");
  });
}
