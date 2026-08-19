import assert from "node:assert/strict";
import test from "node:test";
import { findAll, findButton, loadProductUiHarness, readProductSource, textContent } from "./helpers/product-acceptance-harness.mjs";

const model = await import("../app/product-model.ts");
const resultsRoute = await import("../app/api/results/route.ts");

function candidate(version = 2) {
  return {
    id: 7, name: "Синтетический кандидат", initials: "СК", vacancyId: "vac-7", vacancy: "Тестовая вакансия",
    status: "READY", archived: false, stageStartedAt: "2026-08-19T08:00:00.000Z", elapsedMinutes: 10, etaMinutes: null,
    result: { version, completedAt: "2026-08-19T09:00:00.000Z", summary: "Сводка", recommendation: "Рекомендовать", documents: [
      { id: "result", type: "candidate-results", fileName: `Итоги_7_v${version}.pdf`, version, candidateId: 7, vacancyId: "vac-7", published: true, valid: true },
      { id: "abc", type: "abc-test", fileName: `ABC-тест_7_v${version}.pdf`, version, candidateId: 7, vacancyId: "vac-7", published: true, valid: true },
    ] },
  };
}

test("TST-077: READY card exposes exactly the current result pair and opens each in an in-app modal", async (t) => {
  const ready = candidate();
  assert.equal(model.validateResultPair(ready), true);
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const previews = [];
  const component = runtime.create("MaterialsPanel", { candidate: { ...ready, tone: "blue", updated: "сейчас" }, onPreview: (value) => previews.push(value) });
  let tree = component.render();
  const resultButtons = findAll(tree, (node) => node.type === "button" && ["Итоги", "ABC-тест"].includes(textContent(node).trim()));
  assert.deepEqual(resultButtons.map((node) => textContent(node).trim()).sort(), ["ABC-тест", "Итоги"]);
  findButton(tree, "Итоги").props.onClick();
  assert.deepEqual(previews, [{ candidateId: 7, type: "candidate-results", version: 2, title: "Итоги" }]);
  let closed = false;
  const modalComponent = runtime.create("PdfPreview", { preview: previews[0], onClose: () => { closed = true; }, onAudit() {} });
  tree = modalComponent.render();
  const modal = findAll(tree, (node) => node.props?.role === "dialog" && String(node.props?.["aria-modal"]) === "true")[0];
  assert.ok(modal, "Preview opens as a modal over the candidate card");
  assert.match(textContent(modal), /Итоги/);
  assert.doesNotMatch(JSON.stringify(modal), /drive\.google\.com|docs\.google\.com/i);
  findAll(modal, (node) => node.type === "button" && /Закрыть/i.test(node.props?.["aria-label"] ?? textContent(node)))[0].props.onClick();
  assert.equal(closed, true);
  assert.match(textContent(component.render()), /Материалы/);
});

test("TST-077 negative: reprocess hides stale result, summary and all placeholders until a new valid pair is published", () => {
  const waiting = model.beginManualReprocess(candidate(), "2026-08-19T10:00:00.000Z");
  assert.equal(waiting.status, "WAITING_FOR_STABILITY");
  assert.equal(waiting.result, null);
  assert.equal(model.validateResultPair(waiting), false);
});

test("TST-078: viewer actions and selected-document export are unambiguous; generic report download is absent", async (t) => {
  const source = await readProductSource();
  assert.doesNotMatch(source, />[^<]*Скачать отчёт[^<]*</i);
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const tree = runtime.create("PdfPreview", { preview: { candidateId: 7, type: "abc-test", version: 2, title: "ABC-тест" }, onClose() {}, onAudit() {} }).render();
  const iframe = findAll(tree, (node) => node.type === "iframe")[0];
  const links = findAll(tree, (node) => node.type === "a");
  assert.ok(iframe, "A standard read-only browser PDF viewer provides scroll, zoom, search and print");
  assert.match(iframe.props.src, /type=abc-test/);
  assert.equal(links.length, 1);
  assert.match(textContent(links[0]), /Скачать ABC-тест/);
  assert.match(links[0].props.href, /type=abc-test[^]*download=1/);
});

test("TST-078 negative: mismatch, corrupt/unpublished pair, authorization and open failure cannot produce success/fallback", async () => {
  const badVersion = candidate();
  badVersion.result.documents[1].version = 1;
  assert.equal(model.validateResultPair(badVersion), false);
  const unpublished = candidate();
  unpublished.result.documents[0].published = false;
  assert.equal(model.validateResultPair(unpublished), false);
  const corrupt = candidate();
  corrupt.result.documents[1].valid = false;
  assert.equal(model.validateResultPair(corrupt), false);
  for (const url of [
    "http://app.local/api/results?candidate=7&type=abc-test&version=1",
    "http://app.local/api/results?candidate=999&type=abc-test&version=2",
    "http://app.local/api/results?candidate=7&type=unknown&version=2",
  ]) {
    const response = await resultsRoute.GET(new Request(url));
    assert.ok(response.status >= 400);
    assert.doesNotMatch(await response.text(), /drive\.google\.com|docs\.google\.com/i);
  }
  const unauthenticated = await resultsRoute.GET(new Request("http://app.local/api/results?candidate=1&type=abc-test&version=2"));
  assert.ok([401, 403].includes(unauthenticated.status), "Protected preview/export denies an unauthenticated request");
  const source = await readProductSource();
  assert.match(source, /role=["']alert["'][^]{0,400}(?:Закрыть|onClose)/i, "Open failure renders a close-only modal error state");
  assert.doesNotMatch(source, /(?:role=["']alert["'][^]{0,400})(?:Повторить|retry|Google Drive)/i);
});
