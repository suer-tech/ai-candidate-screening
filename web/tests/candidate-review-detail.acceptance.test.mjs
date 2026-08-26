import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findAll, loadProductUiHarness, textContent } from "./helpers/product-acceptance-harness.mjs";

const TECHNICAL_KEYS = [
  "personal_contribution_event_case",
  "resume_achievement_fact",
  "unregistered_pipeline_fact_kind",
];

function resultDocument(type, fileName) {
  return {
    id: type,
    type,
    fileName,
    version: 4,
    candidateId: 79,
    vacancyId: "vac-79",
    published: true,
    valid: true,
  };
}

function candidate(overrides = {}) {
  const base = {
    id: 79,
    name: "Мария Синтетическая",
    initials: "МС",
    vacancyId: "vac-79",
    vacancy: "Руководитель продукта",
    status: "READY",
    archived: false,
    stageStartedAt: "2026-08-24T08:00:00.000Z",
    elapsedMinutes: 19,
    etaMinutes: 0,
    tone: "blue",
    updated: "сейчас",
    materials: [
      { id: "resume", fileName: "Резюме Марии Синтетической.pdf", kind: "resume" },
      { id: "interview", fileName: "Интервью Марии Синтетической.mp4", kind: "interview" },
      { id: "notes", fileName: "Заметки интервьюера Мария.docx", kind: "notes" },
    ],
    result: {
      version: 4,
      completedAt: "2026-08-24T09:00:00.000Z",
      summary: "Кандидат соответствует ключевым требованиям с оговоркой по масштабу команды.",
      recommendation: "Рекомендовать с оговорками",
      documents: [
        resultDocument("candidate-results", "Итоги_Мария_v4.pdf"),
        resultDocument("abc-test", "ABC-тест_Мария_v4.pdf"),
      ],
      aiOverview: {
        recommendationBasis: "Подтверждены продуктовые результаты и личный вклад; требуется проверить опыт управления большой командой.",
        abc: [
          { direction: "Продуктивность", grade: "A", reason: "Запустила продукт и подтвердила рост выручки.", factIds: ["fact-1"] },
          { direction: "Инициатива", grade: "B", reason: "Предложила и самостоятельно проверила гипотезу.", factIds: ["fact-2"] },
          { direction: "Самообучаемость", grade: "C", reason: "Не привела проверяемого примера.", factIds: [] },
        ],
        stopFactors: [{ name: "Конфликт интересов не выявлен", state: "Не выявлено", reason: "Проверены ответы и резюме.", factIds: ["fact-3"] }],
        competencies: [{ name: "Продуктовая аналитика", state: "Подтверждено", reason: "Назвала метрики и исход эксперимента.", factIds: ["ev-competency"] }],
        risks: [{ name: "Масштаб управления", state: "Требует проверки", reason: "Подтверждена команда до пяти человек.", factIds: ["fact-4"] }],
        accessToKe: [{ name: "Допустить к КЕ", state: "Да, с оговоркой", reason: "Уточнить масштаб управления.", factIds: ["fact-4"] }],
        evidence: [
          { id: "ev-interview", technicalType: TECHNICAL_KEYS[0], label: TECHNICAL_KEYS[0], claim: "Лично сформулировала гипотезу и организовала эксперимент.", quote: "Я собрала команду и запустила проверку за две недели", source: "Интервью Марии Синтетической.mp4", timecode: "00:14:22", criterion: "Инициатива" },
          { id: "ev-resume", technicalType: TECHNICAL_KEYS[1], label: TECHNICAL_KEYS[1], claim: "Запуск увеличил конверсию на 18%.", quote: "Рост конверсии на 18%", source: "Резюме Марии Синтетической.pdf", page: 2, criterion: "Продуктивность" },
          { id: "ev-competency", technicalType: "competency:product_analytics", label: "competency:product_analytics", claim: "Выбрала конверсию и удержание как критерии успешности эксперимента.", quote: "Смотрели конверсию в активацию и удержание второй недели", source: "Интервью Марии Синтетической.mp4", timecode: "00:27:10", criterion: "Продуктовая аналитика" },
        ],
      },
    },
  };
  return { ...base, ...overrides };
}

async function renderDetail(t, value) {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const tree = runtime.create("CandidateDetail", {
    candidate: value,
    onBack() {}, onArchive() {}, onRestore() {}, onDelete() {}, onReprocess() {}, onPreview() {},
  }).render();
  return expandFunctionComponents(tree);
}

function expandFunctionComponents(node) {
  if (Array.isArray(node)) return node.map(expandFunctionComponents);
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (typeof node.type === "function") return expandFunctionComponents(node.type(node.props ?? {}));
  return { ...node, props: { ...node.props, children: expandFunctionComponents(node.props?.children) } };
}

function articleWithHeading(tree, heading) {
  return findAll(tree, (node) => node.type === "article" && findAll(node, (child) => /^h[1-6]$/.test(String(child.type)) && textContent(child).trim() === heading).length > 0)[0];
}

function regionWithHeading(tree, heading) {
  return findAll(tree, (node) => ["article", "aside", "section"].includes(String(node.type)) && findAll(node, (child) => /^h[1-6]$/.test(String(child.type)) && textContent(child).trim() === heading).length > 0).at(-1);
}

test("TST-079 full: candidate review preserves the complete semantic result and current PDF pair", async (t) => {
  const tree = await renderDetail(t, candidate());
  const text = textContent(tree);
  const headings = findAll(tree, (node) => /^h[1-6]$/.test(String(node.type))).map((node) => textContent(node).trim());
  const expectedOrder = ["Резюме для принятия решения", "Сильные стороны", "Риски и пробелы", "Стоп-факторы", "Компетенции", "Детальная оценка", "ABC-профиль", "Допуск к КЕ", "Материалы"];
  let cursor = -1;
  for (const heading of expectedOrder) {
    const next = headings.indexOf(heading, cursor + 1);
    assert.ok(next > cursor, `${heading} follows the preceding normative section`);
    cursor = next;
  }
  for (const [heading, ownFact] of [
    ["Стоп-факторы", "Конфликт интересов не выявлен"],
    ["Компетенции", "Продуктовая аналитика"],
    ["Риски и пробелы", "Масштаб управления"],
    ["Допуск к КЕ", "Допустить к КЕ"],
  ]) assert.match(textContent(articleWithHeading(tree, heading)), new RegExp(ownFact));
  for (const direction of ["Продуктивность", "Инициатива", "Самообучаемость"]) assert.match(text, new RegExp(direction));
  for (const grade of ["A", "B", "C"]) assert.ok(findAll(tree, (node) => textContent(node).trim() === grade).length, `grade ${grade} is rendered`);
  assert.match(text, /Личный вклад/);
  assert.match(text, /Результат из резюме/);
  assert.match(text, /00:14:22/);
  assert.match(text, /страница 2|стр\. 2/i);
  assert.match(text, /Резюме Марии Синтетической\.pdf/);
  assert.match(text, /Интервью Марии Синтетической\.mp4/);
  assert.match(text, /Заметки интервьюера Мария\.docx/);
  assert.ok(articleWithHeading(tree, "Материалы"), "source materials have their own section");
  assert.match(text, /Результаты/);
  assert.equal(findAll(tree, (node) => node.type === "button" && ["Итоги", "ABC-тест"].includes(textContent(node).trim())).length, 2);
  for (const key of TECHNICAL_KEYS) assert.doesNotMatch(text, new RegExp(key));
  assert.doesNotMatch(text, /\b(?:null|undefined)\b/);
});

test("TST-079 demo IA: decision summary, detailed facts and matching profile remain separate semantic regions", async (t) => {
  const value = candidate();
  value.result.aiOverview.strengths = [
    { name: "Измеримый продуктовый результат", reason: "Запуск увеличил конверсию на 18%.", factIds: ["fact-1"] },
  ];
  const tree = await renderDetail(t, value);
  const text = textContent(tree);

  const decisionSummary = regionWithHeading(tree, "Резюме для принятия решения");
  assert.ok(decisionSummary, "decision summary is a dedicated region");
  const summaryText = textContent(decisionSummary);
  assert.match(summaryText, /Итог AI/);
  assert.doesNotMatch(summaryText, /Рекомендация AI/);
  assert.match(summaryText, /Рекомендовать с оговорками/);
  assert.doesNotMatch(summaryText, /Сильные стороны|Риски и пробелы/, "decision extract does not absorb outcomes");
  const outcomes = findAll(tree, (node) => String(node.props?.className ?? "").includes("decision-outcomes-grid"))[0];
  assert.ok(outcomes, "demo outcomes are a sibling region");
  const outcomesText = textContent(outcomes);
  assert.match(outcomesText, /Сильные стороны/);
  assert.match(outcomesText, /Измеримый продуктовый результат/);
  assert.match(outcomesText, /Риски и пробелы/);
  assert.match(outcomesText, /Масштаб управления/);

  const detailedAssessment = regionWithHeading(tree, "Детальная оценка");
  assert.ok(detailedAssessment, "detailed assessment is separate from the short decision summary");
  const detailedText = textContent(detailedAssessment);
  assert.match(detailedText, /Продуктовая аналитика/);
  assert.match(detailedText, /Лично сформулировала гипотезу и организовала эксперимент/);
  assert.match(detailedText, /Интервью Марии Синтетической\.mp4/);
  assert.match(detailedText, /00:14:22/);

  const matching = regionWithHeading(tree, "Оценка соответствия");
  assert.ok(matching, "matching profile is a dedicated secondary region");
  const matchingText = textContent(matching);
  assert.match(matchingText, /ABC-профиль/);
  for (const direction of ["Продуктивность", "Инициатива", "Самообучаемость"]) assert.match(matchingText, new RegExp(direction));
  const indicators = findAll(matching, (node) =>
    node.props?.role === "meter" || node.type === "meter" || node.type === "progress" || node.props?.["data-grade"] !== undefined,
  );
  assert.ok(indicators.length >= 3, "each ABC direction exposes a semantic visual grade indicator");
  assert.match(matchingText, /70%/, "A/B/C is converted to the rounded ASM-055 index");
  for (const percent of ["100%", "70%", "40%"]) assert.match(matchingText, new RegExp(percent.replace("%", "\\%")));
  assert.doesNotMatch(matchingText, /(?:92|68|38)%/, "legacy decorative percentages are not presented as data");

  const materials = regionWithHeading(tree, "Материалы");
  assert.ok(materials, "materials remain a dedicated region");
  assert.ok(materials !== matching && materials !== detailedAssessment && materials !== decisionSummary);
  assert.match(textContent(materials), /Резюме Марии Синтетической\.pdf/);
  assert.doesNotMatch(text, /общий балл|рейтинг кандидата/i);
});

test("ready candidate hero contains no ABC percentage, circular score or AI outcome", async (t) => {
  const tree = await renderDetail(t, candidate());
  const hero = findAll(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("candidate-hero"))[0];
  assert.ok(hero);
  assert.doesNotMatch(textContent(hero), /Итог AI|Расч[её]тный индекс ABC|(?:\d{1,2}|100)\s*%/i);
  assert.equal(findAll(hero, (node) => node.props?.role === "meter" || String(node.props?.className ?? "").includes("candidate-score-ring")).length, 0);
  const summary = findAll(tree, (node) => String(node.props?.className ?? "").includes("candidate-decision-region"))[0];
  assert.match(textContent(summary), /Итог AI.*Рекомендовать с оговорками/s);
});

test("AI outcome centers one SVG icon contract for every deterministic recommendation", async (t) => {
  const cases = [
    ["Рекомендовать", "recommend"],
    ["Рекомендовать с оговорками", "caution"],
    ["Не рекомендовать", "reject"],
    ["Недостаточно данных", "insufficient"],
  ];
  const failures = [];
  const viewBoxes = new Set();
  for (const [recommendation, tone] of cases) {
    const value = candidate();
    value.result.recommendation = recommendation;
    const tree = await renderDetail(t, value);
    const callout = findAll(tree, (node) => String(node.props?.className ?? "").includes("ai-recommendation-callout"))[0];
    if (!callout) {
      failures.push(`${recommendation}: отсутствует блок результата`);
      continue;
    }
    if (!String(callout.props.className).includes(`recommendation-${tone}`)) failures.push(`${recommendation}: отсутствует semantic tone ${tone}`);
    const renderedIcon = findAll(callout, (node) => String(node.props?.className ?? "").includes("recommendation-icon"))[0];
    if (!renderedIcon || renderedIcon.type !== "svg") {
      failures.push(`${recommendation}: recommendation-icon должен быть SVG, а не текстовым глифом (получен ${renderedIcon?.type ?? "missing"})`);
      continue;
    }
    const viewBox = String(renderedIcon.props.viewBox ?? "").trim();
    viewBoxes.add(viewBox);
    const viewBoxParts = viewBox.split(/[ ,]+/).map(Number);
    if (viewBoxParts.length !== 4 || viewBoxParts.some((part) => !Number.isFinite(part)) || viewBoxParts[2] <= 0 || viewBoxParts[2] !== viewBoxParts[3]) {
      failures.push(`${recommendation}: SVG viewBox должен быть валидным и квадратным`);
    }
    if (renderedIcon.props.preserveAspectRatio !== "xMidYMid meet") failures.push(`${recommendation}: SVG должен явно центрироваться через preserveAspectRatio="xMidYMid meet"`);
    if (textContent(renderedIcon).trim()) failures.push(`${recommendation}: SVG не должен содержать текстовый глиф`);
    const geometry = findAll(renderedIcon, (node) => ["path", "line", "polyline", "polygon", "circle", "rect"].includes(node.type));
    if (!geometry.length) failures.push(`${recommendation}: SVG не содержит векторной геометрии иконки`);
  }
  if (viewBoxes.size !== 1) failures.push(`все четыре иконки должны использовать единый viewBox (получено: ${[...viewBoxes].join(", ") || "нет SVG"})`);

  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const iconRule = css.match(/\.recommendation-icon\s*\{([^}]*)\}/s)?.[1] ?? "";
  if (!/display\s*:\s*block/.test(iconRule)) failures.push("recommendation-icon должен быть block, чтобы исключить смещение SVG по текстовой baseline");
  if (!/width\s*:\s*28px/.test(iconRule) || !/height\s*:\s*28px/.test(iconRule) || !/border-radius\s*:\s*50%/.test(iconRule)) failures.push("recommendation-icon должен задавать единый квадрат 28×28 и круг через border-radius:50%");

  assert.deepEqual(failures, [], failures.join("\n"));
});

test("ready candidate header uses the available width and pins lifecycle actions to the right", async (t) => {
  const tree = await renderDetail(t, candidate());
  const hero = findAll(tree, (node) => String(node.props?.className ?? "").includes("candidate-hero"))[0];
  assert.match(String(hero.props.className), /candidate-hero-ready/);
  const identity = findAll(hero, (node) => String(node.props?.className ?? "").split(/\s+/).includes("candidate-identity-content"))[0];
  const primary = findAll(identity, (node) => String(node.props?.className ?? "").split(/\s+/).includes("candidate-identity-primary"))[0];
  assert.ok(primary, "candidate name and processing status form the primary identity row");
  assert.equal(findAll(primary, (node) => node.type === "h1").length, 1);
  assert.equal(findAll(primary, (node) => String(node.props?.className ?? "").includes("status")).length, 1);
  const vacancy = findAll(identity, (node) => String(node.props?.className ?? "").split(/\s+/).includes("candidate-vacancy"))[0];
  assert.ok(vacancy, "vacancy is a separate secondary identity row");
  assert.equal(textContent(vacancy).trim(), "Руководитель продукта");
  const actions = findAll(hero, (node) => String(node.props?.className ?? "").includes("hero-actions"))[0];
  assert.deepEqual(findAll(actions, (node) => node.type === "button").map((node) => textContent(node).trim()), ["↻ Повторная обработка", "В архив"]);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.candidate-hero-ready\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /\.candidate-identity-content\s*\{[^}]*display:grid/);
  assert.match(css, /\.candidate-identity-primary\s*\{[^}]*display:flex/);
  assert.doesNotMatch(css, /\.candidate-vacancy:before\s*\{[^}]*content\s*:\s*["']·["']/);
  assert.match(css, /\.hero-actions\s*\{[^}]*justify-self:end/);
});

test("TST-079 demo IA: detailed assessment reveals claims and source locators instead of a collapsed summary", async (t) => {
  const tree = await renderDetail(t, candidate());
  const detailedAssessment = regionWithHeading(tree, "Детальная оценка");
  assert.ok(detailedAssessment, "detailed assessment is a dedicated region");
  const text = textContent(detailedAssessment);
  assert.match(text, /Лично сформулировала гипотезу и организовала эксперимент/);
  assert.match(text, /Интервью Марии Синтетической\.mp4/);
  assert.match(text, /00:14:22/);
});

test("TST-079 demo IA: matching profile is a separate secondary region with semantic ABC indicators and KE access", async (t) => {
  const tree = await renderDetail(t, candidate());
  const matching = regionWithHeading(tree, "Оценка соответствия");
  assert.ok(matching, "matching profile is a dedicated secondary region");
  const text = textContent(matching);
  assert.match(text, /ABC-профиль/);
  const indicators = findAll(matching, (node) => node.props?.role === "meter" || node.type === "meter" || node.type === "progress" || node.props?.["data-grade"] !== undefined);
  assert.ok(indicators.length >= 3, "ABC grades have semantic visual indicators");
  assert.match(text, /70%/);
  for (const [grade, percent] of [["Продуктивность", "100%"], ["Инициатива", "70%"], ["Самообучаемость", "40%"]]) {
    const meter = indicators.find((node) => String(node.props?.["aria-label"] ?? "").includes(grade));
    assert.ok(meter, `${grade} has an accessible index indicator`);
    assert.match(String(meter.props["aria-label"]), new RegExp(percent.replace("%", "\\%")));
  }

  const aside = findAll(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("candidate-review-aside"))[0];
  assert.ok(aside, "secondary assessment content has a semantic layout region");
  const scoreCard = findAll(aside, (node) => String(node.props?.className ?? "").includes("candidate-matching-score-region"))[0];
  const keCard = findAll(aside, (node) => String(node.props?.className ?? "").includes("candidate-ke-region"))[0];
  assert.ok(scoreCard && keCard && scoreCard !== keCard, "KE access is a sibling score-card, not content merged into ABC");
  assert.equal(findAll(scoreCard, (node) => node === keCard).length, 0);
});

test("TST-079 ASM-055 negative: no valid ABC direction means no borrowed percentage", async (t) => {
  const value = candidate();
  value.result.aiOverview.abc = [{ direction: "Невалидное направление", grade: "pending", factIds: [] }];
  const tree = await renderDetail(t, value);
  const matching = regionWithHeading(tree, "Оценка соответствия");
  assert.ok(matching);
  const text = textContent(matching);
  assert.match(text, /Оценка ещё не готова/);
  assert.doesNotMatch(text, /\b\d+%\b/);
});

test("TST-079 REP-020: decision summary, outcomes and criterion-bound evidence are separate", async (t) => {
  const tree = await renderDetail(t, candidate());
  const summary = findAll(tree, (node) => String(node.props?.className ?? "").includes("candidate-decision-region"))[0];
  const outcomes = findAll(tree, (node) => String(node.props?.className ?? "").includes("decision-outcomes-grid"))[0];
  assert.ok(summary && outcomes && summary !== outcomes, "decision extract and outcomes are separate demo regions");
  assert.equal(findAll(summary, (node) => node === outcomes).length, 0);
  assert.match(textContent(summary), /Итог AI.*Рекомендовать с оговорками/s);
  assert.match(textContent(outcomes), /Сильные стороны.*Риски и пробелы.*Стоп-факторы/s);

  const detailed = regionWithHeading(tree, "Детальная оценка");
  const initiative = findAll(detailed, (node) => String(node.props?.className ?? "").includes("criterion-detail-row") && /Инициатива/.test(textContent(node)))[0];
  assert.ok(initiative, "criterion row exists");
  const initiativeText = textContent(initiative);
  assert.match(initiativeText, /Лично сформулировала гипотезу и организовала эксперимент/);
  assert.match(initiativeText, /Интервью Марии Синтетической\.mp4.*00:14:22/s);
  assert.doesNotMatch(initiativeText, /Продуктивность.*Рост конверсии на 18%/s, "evidence is not attached to an unrelated criterion");

  const competency = findAll(detailed, (node) => String(node.props?.className ?? "").includes("competency-detail-row") && /Продуктовая аналитика/.test(textContent(node)))[0];
  assert.ok(competency, "resolved additional criterion is rendered");
  const competencyText = textContent(competency);
  const trigger = findAll(competency, (node) => node.type === "button" && String(node.props?.className ?? "").split(/\s+/).includes("criterion-row-trigger"))[0];
  assert.ok(trigger, "the whole criterion row exposes a native button trigger");
  assert.equal(trigger.props["aria-expanded"], false);
  const evidenceArea = findAll(competency, (node) => String(node.props?.className ?? "").split(/\s+/).includes("criterion-evidence-area"))[0];
  assert.ok(evidenceArea, "the evidence area is directly contained by the same criterion row");
  assert.equal(trigger.props["aria-controls"], evidenceArea.props.id, "trigger is explicitly linked to its evidence area");
  assert.match(competencyText, /Выбрала конверсию и удержание как критерии успешности эксперимента/);
  assert.match(competencyText, /Интервью Марии Синтетической\.mp4.*00:27:10/s);
  assert.doesNotMatch(competencyText, /Открыть факты/);
  assert.equal((textContent(detailed).match(/00:27:10/g) ?? []).length, 1, "competency locator is shown once in its bound fact");
});

test("TST-079 demo IA: source materials remain outside decision, assessment and matching regions", async (t) => {
  const tree = await renderDetail(t, candidate());
  const materials = regionWithHeading(tree, "Материалы");
  assert.ok(materials, "materials are a dedicated region");
  assert.match(textContent(materials), /Резюме Марии Синтетической\.pdf/);
  for (const heading of ["Резюме для принятия решения", "Детальная оценка", "Оценка соответствия"]) {
    const region = regionWithHeading(tree, heading);
    if (region) assert.equal(findAll(region, (node) => node === materials).length, 0, `materials are outside ${heading}`);
  }
});

test("TST-079 negative: unknown evidence keys use a neutral label and missing locator metadata is not invented", async (t) => {
  const value = candidate();
  value.result.aiOverview.evidence = [{
    id: "ev-unknown",
    technicalType: TECHNICAL_KEYS[2],
    label: TECHNICAL_KEYS[2],
    claim: "Есть проверяемое утверждение без точного локатора.",
    source: "Заметки интервьюера Мария.docx",
    page: null,
    timecode: undefined,
    criterion: "Продуктовая аналитика",
  }];
  const text = textContent(await renderDetail(t, value));
  assert.match(text, /Доказательство/);
  assert.match(text, /Есть проверяемое утверждение без точного локатора/);
  assert.match(text, /Заметки интервьюера Мария\.docx/);
  assert.doesNotMatch(text, new RegExp(TECHNICAL_KEYS[2]));
  assert.doesNotMatch(text, /\b(?:null|undefined)\b|00:00|страница 0|стр\. 0/i);
});

test("TST-079 state: completed sections without applicable facts say none found", async (t) => {
  const noneFound = candidate();
  for (const key of ["stopFactors", "competencies", "risks", "accessToKe"]) noneFound.result.aiOverview[key] = [];
  const noneText = textContent(await renderDetail(t, noneFound));
  assert.ok((noneText.match(/Не выявлено/g) ?? []).length >= 4, "completed empty sections say that no applicable facts were found");
  assert.doesNotMatch(noneText, /Не подтверждено/);
});

test("TST-079 state: processing retains the normative sections without a false empty result", async (t) => {
  const processingText = textContent(await renderDetail(t, candidate({ status: "ANALYZING", etaMinutes: 7, result: null })));
  for (const heading of ["ABC-профиль", "Стоп-факторы", "Компетенции", "Риски и пробелы", "Допуск к КЕ", "Ключевые доказательства"]) assert.match(processingText, new RegExp(heading));
  assert.match(processingText, /обрабатыва|формиру|анализ выполняется/i);
  assert.doesNotMatch(processingText, /Не выявлено|Не подтверждено/);
});

test("TST-079 state: projection error is user-facing and distinct from processing and none-found", async (t) => {
  const projectionError = candidate();
  projectionError.result.aiOverview = { state: "error", message: "projection_transport_error" };
  const errorText = textContent(await renderDetail(t, projectionError));
  assert.match(errorText, /Данные.+недоступны|Не удалось.+данные/i);
  assert.doesNotMatch(errorText, /projection_transport_error|Не выявлено|Не подтверждено/);
  assert.doesNotMatch(errorText, /Текущий запуск отображается как основной/);
});

test("TST-079 responsive: desktop grid becomes a complete narrow flow without horizontal overflow", async (t) => {
  const tree = await renderDetail(t, candidate());
  const overview = findAll(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("candidate-overview"))[0];
  assert.ok(overview, "desktop candidate review grid is rendered");
  assert.equal(findAll(overview, (node) => String(node.props?.className ?? "").includes("sources-panel")).length, 1, "materials stay in the same observable flow");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.candidate-overview\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,/s, "desktop main column can shrink");
  assert.match(css, /@media\s*\(max-width:\s*820px\)\{(?:(?!@media).)*?\.candidate-overview\s*\{[^}]*grid-template-columns\s*:\s*1fr/s, "narrow viewport linearizes the layout");
  assert.match(css, /(?:\.candidate-overview|\.overview-main|\.sources-panel|\.assessment-[^{,]+)[^{]*\{[^}]*min-width\s*:\s*0/s, "grid children cannot force page overflow");
  assert.match(css, /(?:overflow-wrap\s*:\s*anywhere|word-break\s*:\s*break-word)/, "long evidence and file names wrap");
  assert.doesNotMatch(css, /\.candidate-(?:overview|detail-page)[^{]*\{[^}]*overflow-x\s*:\s*(?:auto|scroll)/s, "the candidate page does not hide overflow behind horizontal scrolling");
});
