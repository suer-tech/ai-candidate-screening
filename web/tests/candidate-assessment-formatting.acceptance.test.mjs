import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Compile the real UI, adding test-only exports; use actual React SSR and hooks.
// No application replacement, browser globals, provider or repository I/O.
const root = path.resolve(import.meta.dirname, "..");
const output = await mkdtemp(path.join(root, ".assessment-formatting-acceptance-"));
after(async () => {
  assert.equal(path.dirname(path.resolve(output)), root);
  assert.ok(path.basename(output).startsWith(".assessment-formatting-acceptance-"));
  await rm(output, { recursive: true, force: true });
});
const uiSource = await readFile(path.join(root, "app/page.tsx"), "utf8");
const compiled = await build({ stdin: { contents: `${uiSource}\nexport { CandidateDetail, CriterionDisclosureRow };`, loader: "tsx", resolveDir: path.join(root, "app") },
  bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic", write: false, logLevel: "silent" });
const entry = path.join(output, "ui.mjs");
await writeFile(entry, compiled.outputFiles[0].text);
const { CandidateDetail, CriterionDisclosureRow } = await import(pathToFileURL(entry).href);
const projected = await build({ stdin: { contents: 'export { projectAssessment } from "../server/product/postgres-repository.ts"; export { PROMPT_ARTIFACTS, RESPONSE_SCHEMA_ARTIFACTS } from "../server/llm/artifacts.ts"; export { environmentProjection } from "../server/configuration/runtime.ts";',
  loader: "ts", resolveDir: path.join(root, "tests") }, bundle: true, platform: "node", format: "esm", packages: "external", write: false, logLevel: "silent" });
const projectionEntry = path.join(output, "projection.mjs");
await writeFile(projectionEntry, projected.outputFiles[0].text);
const { projectAssessment, PROMPT_ARTIFACTS, RESPONSE_SCHEMA_ARTIFACTS, environmentProjection } = await import(pathToFileURL(projectionEntry).href);

function decode(value) {
  return value.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, entity) => {
    if (entity[0] === "#") return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity.toLowerCase()];
  });
}

// A small read-only tree of the actual SSR HTML, sufficient for semantic tags
// and text equality. HTML-looking source text is decoded only after tokenizing.
function htmlTree(html) {
  const document = { tag: "root", attributes: {}, children: [] };
  const stack = [document];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)\b[^>]*>|([^<]+)/g)) {
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    if (match[2] !== undefined) { stack.at(-1).children.push(decode(match[2])); continue; }
    const tag = match[1].toLowerCase();
    if (token.startsWith("</")) {
      const index = stack.findLastIndex((node) => node.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const attributes = {};
    for (const attr of token.slice(1 + match[1].length, -1).matchAll(/([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[attr[1]] = decode(attr[2] ?? attr[3] ?? attr[4] ?? "");
    const node = { tag, attributes, children: [] };
    stack.at(-1).children.push(node);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
  return document;
}

const text = (node) => typeof node === "string" ? node : node.children.map(text).join("");
const compact = (value) => value.replace(/\s/gu, "");
function find(node, predicate) {
  if (typeof node === "string") return [];
  return [...(predicate(node) ? [node] : []), ...node.children.flatMap((child) => find(child, predicate))];
}
function abcRegion(tree) {
  const region = find(tree, (node) => ["section", "article"].includes(node.tag)
    && find(node, (child) => /^h[1-6]$/.test(child.tag) && text(child) === "Расшифровка ABC-оценки").length > 0).at(-1);
  assert.ok(region, "Detailed assessment retains its ABC section");
  return region;
}
function bodyFor(node, source) {
  const result = find(node, (candidate) => compact(text(candidate)) === compact(source)).at(-1);
  assert.ok(result, "Rendered prose must preserve every non-whitespace character and its original order");
  return result;
}

function evidenceLayout(row, title, reason, hasScale) {
  const trigger = find(row, (node) => node.tag === "button" && node.attributes["aria-controls"])[0];
  assert.ok(trigger, "Evidence retains a dedicated accessible toggle");
  const panel = find(row, (node) => node.attributes.id === trigger.attributes["aria-controls"])[0];
  assert.ok(panel, "aria-controls resolves to the evidence panel in the same card");
  assert.equal(trigger.attributes["aria-expanded"], "false");
  assert.equal(panel.attributes["aria-hidden"], "true");
  assert.match(text(trigger), /доказательств/iu);
  assert.equal(text(trigger).includes(title), false, "The title is not part of the evidence toggle");
  const elements = find(row, () => true);
  const heading = find(row, (node) => /^(?:b|h[1-6])$/.test(node.tag) && text(node) === title)[0];
  assert.ok(heading, "The criterion title remains visible before its content");
  assert.ok(elements.indexOf(heading) < elements.indexOf(trigger), "Title precedes the evidence toggle");
  if (reason) {
    assert.ok(elements.indexOf(bodyFor(row, reason)) < elements.indexOf(trigger), "Reason precedes the evidence toggle");
  }
  if (hasScale) {
    const scale = find(row, (node) => node.tag === "details")[0];
    assert.ok(scale, "The supplied scale remains available");
    assert.ok(elements.indexOf(scale) < elements.indexOf(trigger), "Scale precedes the evidence toggle");
  }
  const parent = find(row, (node) => node.children.includes(trigger)).at(-1);
  const siblings = parent.children.filter((child) => typeof child !== "string");
  assert.equal(siblings[siblings.indexOf(trigger) + 1], panel,
    "The panel immediately follows its toggle, opening downward after the card content");
  assert.equal(siblings.at(-1), panel, "No card content is placed after the evidence panel");
  assert.equal(find(trigger, (node) => ["details", "summary", "ul", "ol"].includes(node.tag)).length, 0);
  return { trigger, panel };
}

function candidate(basis, summary = "Отдельная синтетическая выжимка.", abc = []) {
  return { id: 7001, name: "Синтетический кандидат Формат", initials: "СФ", vacancyId: "synthetic-format-vacancy", vacancy: "Синтетическая роль",
    status: "READY", archived: false, stageStartedAt: "2026-10-14T01:00:00.000Z", elapsedMinutes: 12, etaMinutes: null, tone: "blue", updated: "сейчас",
    result: { version: 1, completedAt: "2026-10-14T01:12:00.000Z", recommendation: "Рекомендовать с оговорками", summary,
      documents: [{ id: "synthetic-report", type: "candidate-report", fileName: "synthetic.pdf", version: 1, candidateId: 7001,
        vacancyId: "synthetic-format-vacancy", published: true, valid: true }],
      aiOverview: { recommendationBasis: basis, abc, competencies: [], stopFactors: [], risks: [], accessToKe: [], evidence: [] } } };
}

function render(value) {
  const html = renderToStaticMarkup(createElement(CandidateDetail, { candidate: value,
    onBack() {}, onArchive() {}, onRestore() {}, onDelete() {}, onReprocess() {}, onPreview() {} }));
  return { html, tree: htmlTree(html) };
}

test("REP-050/051: multiline AI recommendation preserves content and produces separate semantic paragraphs", () => {
  const source = "Подтверждены два самостоятельных результата.\n\nОграничение не снято; требуется уточнение масштаба.";
  const { tree } = render(candidate(source));
  const body = bodyFor(tree, source);
  assert.equal(find(body, (node) => node.tag === "p").length, 2,
    "Two explicit paragraphs must not be presented as one dense inline block");
});

test("REP-050 clarification: ABC hides defining conditions while preserving reasoning, scale and the input data", () => {
  const reason = "Самостоятельный пример не подтверждён. Условие уровня не является доказанным фактом.";
  const conditions = ["Не менее двух отдельных эпизодов", "Роль кандидата должна быть описана явно"];
  const value = candidate("Краткое синтетическое обоснование.", undefined,
    [{ direction: "Синтетическая автономность", grade: "B", reason, definingConditions: conditions,
      gradeA: "Два эпизода без подсказок", gradeB: "Один эпизод с уточнением", gradeC: "Нет проверяемого эпизода", factIds: [] }]);
  const before = JSON.stringify(value);
  const { tree } = render(value);
  const row = abcRegion(tree);
  assert.ok(row);
  bodyFor(row, reason);
  assert.doesNotMatch(text(row), /Учтённые признаки/u);
  for (const condition of conditions) assert.equal(text(row).includes(condition), false, "Defining conditions are not rendered");
  assert.equal(JSON.stringify(value), before, "Hiding conditions must not remove them from the stored/projection input");
  const scale = find(row, (node) => node.tag === "details")[0];
  assert.ok(scale, "Scale is a separate native disclosure");
  assert.equal(find(row, (node) => node.tag === "button" && find(node, (child) => ["details", "summary", "ul"].includes(child.tag)).length > 0).length, 0,
    "Independent scale controls must not be nested inside an evidence button");
});

for (const [label, fields] of [
  ["reason and full scale", { reason: "Обоснование до доказательств.", gradeA: "Самостоятельно", gradeB: "С уточнением", gradeC: "Не подтверждено" }],
  ["reason only", { reason: "Краткое основание без шкалы." }],
  ["partial scale only", { gradeB: "Один синтетический эпизод." }],
  ["no optional content or evidence", {}],
]) {
  test(`REP-050 clarification: evidence toggle follows content and immediately precedes its panel (${label})`, () => {
    const title = `Синтетический критерий: ${label}`;
    const { tree } = render(candidate("Отдельное основание.", undefined,
      [{ direction: title, grade: "B", factIds: [], ...fields }]));
    const row = abcRegion(tree);
    evidenceLayout(row, title, fields.reason, Boolean(fields.gradeA || fields.gradeB || fields.gradeC));
    assert.doesNotMatch(text(row), /Учтённые признаки|undefined|null/u);
  });
}

test("REP-050 clarification: actual evidence toggle binding preserves downward panel expansion and collapse", () => {
  let open = false;
  const toggle = () => { open = !open; };
  const reactNodes = (node) => Array.isArray(node) ? node.flatMap(reactNodes)
    : node && typeof node === "object" ? [node, ...reactNodes(node.props?.children)] : [];
  const component = () => CriterionDisclosureRow({ badge: "B", badgeClass: "grade-b", title: "Синтетическая строка",
    reason: "Обоснование не меняется при раскрытии.", facts: [], factCount: 0,
    evidenceId: "synthetic-evidence-binding-panel", open, onToggle: toggle });
  const inspect = () => {
    const nodes = reactNodes(component());
    const trigger = nodes.find((node) => node.type === "button" && node.props["aria-controls"]);
    const panel = nodes.find((node) => node.props?.id === trigger.props["aria-controls"]);
    assert.ok(panel);
    assert.equal(trigger.props.onClick, toggle, "The actual toggle button binds the provided handler");
    assert.equal(trigger.props["aria-expanded"], open);
    assert.equal(panel.props["aria-hidden"], !open);
    return trigger;
  };
  inspect().props.onClick();
  assert.equal(open, true);
  inspect().props.onClick();
  assert.equal(open, false);
  inspect();
});

for (const [label, source] of [
  ["short explanation", "Требуется уточнить один рабочий эпизод."],
  ["unknown inline heading", "Необычная заметка: контекст не опровергнут. Дополнительное уточнение не меняет вывода."],
  ["decimal numbers and abbreviations", "Опыт 2.5 года, напр. работа с п. 1.2 и т.д. Это не отказ, а оговорка; версия 3.14 не является оценкой."],
  ["connected negation", "Не отсутствие результата, а отсутствие проверяемого исхода ограничивает вывод. Это не означает, что опыт не был получен."],
  ["long ambiguous prose", "Один пример не подтверждает самостоятельность, а оговорка не отменяет проверенный результат. ".repeat(18).trim()],
]) {
  test(`REP-051: ${label} preserves exact content and stays conservative`, () => {
    const { tree } = render(candidate(source));
    const body = bodyFor(tree, source);
    assert.equal(find(body, (node) => node.tag === "p").length, 1);
    assert.equal(find(body, (node) => ["ol", "ul", "h1", "h2", "h3", "h4", "h5", "h6"].includes(node.tag)).length, 0,
      "Ambiguous prose must not acquire invented lists, headings or sentence-count chunks");
  });
}

for (const source of [
  "1) Проверить ровно 2,5 года опыта. 2) Не подменять результат предположением.",
  "1) Проверить ровно 2,5 года опыта.\n2) Не подменять результат предположением.",
  "- Первый эпизод не подтверждён.\n- Второй эпизод требует уточнения.",
]) {
  test(`REP-050/051: explicit enumeration ${JSON.stringify(source.slice(0, 28))} becomes a list without losing numbering`, () => {
    const { tree } = render(candidate(source));
    const body = bodyFor(tree, source);
    const lists = find(body, (node) => ["ul", "ol"].includes(node.tag));
    assert.equal(lists.length, 1);
    assert.equal(find(lists[0], (node) => node.tag === "li").length, 2);
    assert.equal(compact(text(body)), compact(source));
  });
}

test("REP-051: literal HTML, quotes and ampersands are preserved as text and cannot become executable elements", () => {
  const source = '<img src=x onerror="globalThis.syntheticExecuted=true"> <script>synthetic()</script> & «не доказано»; 3 < 4.';
  const { tree, html } = render(candidate(source));
  const body = bodyFor(tree, source);
  assert.equal(find(body, (node) => ["script", "img", "iframe", "object", "style"].includes(node.tag)).length, 0);
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal(globalThis.syntheticExecuted, undefined);
});

test("REP-052: summary and recommendation retain distinct explicit paragraph boundaries through actual UI rendering", () => {
  const summary = "Проверенный результат сохранён.\n\nНовая область опыта требует уточнения.";
  const basis = "Обоснование рекомендации не совпадает с краткой выжимкой.\n\nПодтверждённый факт не отменяет оговорку.";
  const { tree } = render(candidate(basis, summary));
  assert.equal(find(bodyFor(tree, summary), (node) => node.tag === "p").length, 2);
  assert.equal(find(bodyFor(tree, basis), (node) => node.tag === "p").length, 2);
});

test("REP-051: ordinary single line breaks keep every phrase and the original sequence", () => {
  const source = "Первое наблюдение не отрицается.\nВторое требует проверки.\nТретье остаётся неопределённым.";
  const { tree } = render(candidate(source));
  const body = bodyFor(tree, source);
  assert.ok(find(body, (node) => node.tag === "p" || node.tag === "br").length > 0);
  assert.equal(compact(text(body)), compact(source));
});

test("REP-050/051: explicit known section labels produce separate paragraphs without losing labels or punctuation", () => {
  const source = "Сильные стороны: два измеримых результата. Риски и пробелы: масштаб не подтверждён. Допуск к КЕ: требуется решение HR.";
  const body = bodyFor(render(candidate(source)).tree, source);
  assert.equal(find(body, (node) => node.tag === "p").length, 3);
  assert.deepEqual(find(body, (node) => ["b", "strong"].includes(node.tag)).map(text),
    ["Сильные стороны:", "Риски и пробелы:", "Допуск к КЕ:"]);
});

for (const source of [
  "Цитата: «Первый эпизод. Риск: второй эпизод не подтверждён». Это не разрешает удалять оговорку.",
  "Он ответил: «1) Не отказ. 2) Не согласие». Это цитата, а не новый перечень.",
  "Контекст (Первый эпизод. Риски и пробелы: не проверены) не является самостоятельным разделом.",
]) {
  test(`REP-051: quoted/bracketed markers remain inside their original statement ${JSON.stringify(source.slice(0, 22))}`, () => {
    const body = bodyFor(render(candidate(source)).tree, source);
    assert.equal(find(body, (node) => node.tag === "p").length, 1);
    assert.equal(find(body, (node) => ["ul", "ol"].includes(node.tag)).length, 0);
  });
}

test("REP-050: absent ABC optional fields do not invent a reason, defining conditions or default scale", () => {
  const { tree } = render(candidate("Нейтральное синтетическое основание.", undefined,
    [{ direction: "Синтетический критерий без дополнений", grade: "Недостаточно данных", factIds: [] }]));
  const row = abcRegion(tree);
  assert.ok(row);
  assert.equal(find(row, (node) => ["details", "ul", "ol"].includes(node.tag)).length, 0);
  assert.doesNotMatch(text(row), /Учтённые признаки|Критерии уровней|Использована стандартная шкала|undefined|null/u);
});

test("REP-050: a partial ABC scale preserves the supplied level and does not invent missing levels", () => {
  const definition = "Один синтетический эпизод с оговоркой, не два.";
  const { tree } = render(candidate("Самостоятельное обоснование.", undefined,
    [{ direction: "Частично заданная синтетическая шкала", grade: "B", gradeB: definition, factIds: [] }]));
  const row = abcRegion(tree);
  const scale = find(row, (node) => node.tag === "details")[0];
  assert.ok(scale);
  assert.ok(text(scale).includes(definition));
  assert.doesNotMatch(text(scale), /выше ожиданий роли|ниже ожиданий|стандартная шкала/u);
  assert.equal(find(scale, (node) => node.tag === "summary").length, 1);
});

test("REP-050: ABC evidence remains a separate controlled disclosure rather than part of the prose/list/scale", () => {
  const quote = "SYNTHETIC: лично согласовал два независимых решения.";
  const value = candidate("Необходима дополнительная проверка.", undefined,
    [{ direction: "Синтетическое доказуемое действие", grade: "A", reason: "Два результата названы явно.", definingConditions: ["Число эпизодов не менее двух"],
      gradeA: "Оба эпизода самостоятельны", factIds: ["synthetic-evidence"] }]);
  value.result.aiOverview.evidence = [{ id: "synthetic-evidence", criterion: "Синтетическое доказуемое действие", claim: quote, quote, source: "synthetic.txt", page: 1 }];
  const { tree } = render(value);
  const row = abcRegion(tree);
  const trigger = find(row, (node) => node.tag === "button" && node.attributes["aria-controls"])[0];
  assert.ok(trigger);
  const panel = find(row, (node) => node.attributes.id === trigger.attributes["aria-controls"])[0];
  assert.ok(panel && text(panel).includes(quote));
  assert.ok(!find(trigger, (node) => node === panel).length);
  assert.ok(!find(panel, (node) => node.tag === "details").length);
});

test("REP-052: actual assessment projection preserves multiline prose and inputs remain immutable before SSR", () => {
  const basis = "Сводный вывод не является решением HR.\n\n1) Сохранить результат.\n2) Уточнить ограничение.";
  const reason = "Конкретный эпизод описан.\n\nСамостоятельность не подтверждена.";
  const matrixReason = "Первая часть попунктного основания.\n\nВторая часть не опровергает первую.";
  const gradeB = "Один самостоятельный результат.\n\nОговорки не исключаются.";
  const snapshot = { recommendation: "Рекомендовать с оговорками", recommendationReason: basis, structuredAssessment: {
    observations: [], competencies: [], risks: [], stopFactors: [], accessToKe: [], abcStates: { productivity: "B" },
    abcEvidence: { productivity: { reason, definingConditions: ["Два независимых эпизода"], factIds: ["synthetic-fact"] } },
    matrixCriteria: { "synthetic-row": { sourceText: "Синтетический дополнительный пункт", category: "additional" } },
    matrixRows: [{ criterionId: "synthetic-row", state: "Соответствует", conclusion: matrixReason, supportingClaimIds: ["synthetic-fact"] }],
  } };
  const evidence = { facts: [{ id: "synthetic-fact", predicate: "synthetic_fact", value: "Синтетическое наблюдение", locator: {
    kind: "document", fileName: "synthetic.txt", page: 1, exactText: "Только синтетическая цитата." } }] };
  const vacancy = { abcDirections: [{ id: "productivity", name: "Синтетическая продуктивность", gradeB }] };
  const before = JSON.stringify({ snapshot, evidence, vacancy });
  const overview = projectAssessment(snapshot, evidence, undefined, vacancy);
  assert.equal(overview.recommendationBasis, basis, "Projection must not collapse paragraphs into spaces");
  assert.equal(overview.abc[0].reason, reason);
  assert.deepEqual(overview.abc[0].definingConditions, ["Два независимых эпизода"], "Hidden conditions remain available in the projected data");
  assert.equal(overview.criteria[0].reason, matrixReason);
  assert.equal(overview.abc[0].gradeB, gradeB);
  assert.equal(JSON.stringify({ snapshot, evidence, vacancy }), before);
  const value = candidate(basis);
  value.result.aiOverview = overview;
  const { tree } = render(value);
  const body = bodyFor(tree, basis);
  assert.ok(find(body, (node) => node.tag === "p").length >= 1);
  assert.equal(find(body, (node) => node.tag === "li").length, 2);
  assert.equal(find(bodyFor(abcRegion(tree), reason), (node) => node.tag === "p").length, 2);
});

test("REP-052: versioned presentation instructions retain existing decision policy and string schemas", () => {
  for (const [previous, next] of [["fill-matrix-rows/v2", "fill-matrix-rows/v3"], ["assess-abc-direction/v2", "assess-abc-direction/v3"],
    ["summarize-matrix-assessment/v1", "summarize-matrix-assessment/v2"]]) {
    const oldPrompt = PROMPT_ARTIFACTS[previous];
    const newPrompt = PROMPT_ARTIFACTS[next];
    assert.ok(oldPrompt && newPrompt, "Old prompt remains addressable and the presentation change has a new version");
    assert.ok(newPrompt.template.startsWith(oldPrompt.template), "Existing policy/evidence instructions cannot be silently rewritten");
    const appended = newPrompt.template.slice(oldPrompt.template.length);
    assert.match(appended, /абзац/iu);
    assert.match(appended, /строк/iu);
    assert.notEqual(newPrompt.hash, oldPrompt.hash);
  }
  const summarySchema = RESPONSE_SCHEMA_ARTIFACTS["candidate-assessment-summary/v1"].schema;
  assert.equal(summarySchema.properties.recommendationReason.type, "string");
});

test("REP-052: actual new-run environment projection selects new prompts with unchanged response-schema identities", () => {
  const environment = environmentProjection({ values: { APP_ORIGIN: "https://synthetic.invalid", ROUTERAI_MODEL: "synthetic-model",
    ROUTERAI_STRUCTURED_OUTPUTS: "true", CANDIDATE_PIPELINE_BUILD_ID: "synthetic-presentation-build",
    MEDIA_PROCESSOR_URL: "http://127.0.0.1:4311/v1/extract-audio", MEDIA_PROCESSOR_HOST: "127.0.0.1", MEDIA_PROCESSOR_PORT: "4311",
    DOCUMENT_PROCESSOR_URL: "http://127.0.0.1:4312/v1/extract-document", DOCUMENT_PROCESSOR_HOST: "127.0.0.1", DOCUMENT_PROCESSOR_PORT: "4312" },
    credentials: { "internal-service-tokens.json": "{}", "rabbitmq-password": "synthetic-only" } });
  const configuration = JSON.parse(environment.LLM_RUNTIME_CONFIG_JSON);
  for (const [capability, promptArtifact, responseSchemaArtifact] of [
    ["matrix_row_evaluation", "fill-matrix-rows/v3", "candidate-matrix-rows/v2"],
    ["abc_matrix_assessment", "assess-abc-direction/v3", "candidate-abc-matrix/v1"],
    ["matrix_assessment_summary", "summarize-matrix-assessment/v2", "candidate-assessment-summary/v1"],
  ]) {
    assert.equal(configuration.capabilities[capability].promptArtifact, promptArtifact);
    assert.equal(configuration.capabilities[capability].responseSchemaArtifact, responseSchemaArtifact);
  }
});
