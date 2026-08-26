import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findAll,
  loadDashboardProjectionHarness,
  loadPostgresAssessmentProjectionHarness,
  loadProductUiHarness,
  textContent,
} from "./helpers/product-acceptance-harness.mjs";

const RAW_KEYS = [
  "personal_contribution_event_case",
  "resume_achievement_fact",
  "recommendationBasis",
  "factIds",
  "technicalType",
];

const noops = {
  onBack() {},
  onArchive() {},
  onRestore() {},
  onDelete() {},
  onReprocess() {},
  onPreview() {},
};

function classTokens(node) {
  return String(node?.props?.className ?? "").split(/\s+/).filter(Boolean);
}

function hasClass(node, token) {
  return classTokens(node).includes(token);
}

function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props ?? {}));
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
}

function findByClass(tree, token) {
  return findAll(tree, (node) => hasClass(node, token));
}

function readyCandidate(overrides = {}) {
  return {
    id: 501,
    name: "Мария Орлова",
    initials: "МО",
    vacancyId: "vac-visual",
    vacancy: "Руководитель продукта",
    status: "READY",
    archived: false,
    stageStartedAt: "2026-08-24T07:00:00.000Z",
    elapsedMinutes: 18,
    etaMinutes: 0,
    tone: "blue",
    updated: "сейчас",
    materials: [
      { id: "resume", fileName: "Резюме Мария Орлова.pdf", kind: "resume" },
      { id: "interview", fileName: "Интервью Мария Орлова.mp4", kind: "interview" },
    ],
    result: {
      version: 7,
      completedAt: "2026-08-24T07:18:00.000Z",
      summary: "Сильный продуктовый опыт с проверяемым личным вкладом.",
      recommendation: "Рекомендовать с оговорками",
      documents: [
        { id: "result", type: "candidate-results", fileName: "Итоги_v0007.pdf", version: 7, candidateId: 501, vacancyId: "vac-visual", published: true, valid: true },
        { id: "abc", type: "abc-test", fileName: "ABC_v0007.pdf", version: 7, candidateId: 501, vacancyId: "vac-visual", published: true, valid: true },
      ],
      aiOverview: {
        recommendationBasis: "Подтверждены результаты и личный вклад.",
        abc: [
          { direction: "Продуктивность", grade: "A", reason: "Есть измеримый результат.", factIds: ["ev-1"] },
          { direction: "Инициатива", grade: "B", reason: "Есть самостоятельный запуск.", factIds: ["ev-2"] },
        ],
        stopFactors: [],
        competencies: [{ name: "Продуктовая аналитика", state: "Подтверждено", reason: "Названы метрики.", factIds: ["ev-1"] }],
        risks: [{ name: "Масштаб команды", state: "Требует проверки", reason: "Подтверждено до пяти человек.", factIds: ["ev-2"] }],
        accessToKe: [{ name: "Допустить к КЕ", state: "Да, с оговоркой", reason: "Уточнить масштаб.", factIds: ["ev-2"] }],
        evidence: [
          {
            id: "ev-1",
            technicalType: "resume_achievement_fact",
            label: "resume_achievement_fact",
            claim: "Увеличила конверсию на 18%.",
            source: "Резюме Мария Орлова.pdf",
            page: 2,
            criterion: "Продуктивность",
          },
          {
            id: "ev-2",
            technicalType: "personal_contribution_event_case",
            label: "personal_contribution_event_case",
            claim: "Самостоятельно запустила проверку гипотезы.",
            source: "Интервью Мария Орлова.mp4",
            timecode: "00:12:40",
            criterion: "Инициатива",
          },
        ],
      },
    },
    ...overrides,
  };
}

function processingCandidate(overrides = {}) {
  return {
    ...readyCandidate(),
    status: "ANALYZING",
    result: null,
    elapsedMinutes: 11,
    etaMinutes: 7,
    progressMilestone: "AI-анализ · сопоставление фактов",
    progressPercent: 63,
    materials: [
      { id: "resume", fileName: "Резюме Мария Орлова.pdf", kind: "resume", state: "Обработано" },
      { id: "interview", fileName: "Интервью Мария Орлова.mp4", kind: "interview", state: "Обработано" },
    ],
    ...overrides,
  };
}

function vacancyState() {
  return {
    vacancies: [{
      id: "vac-visual",
      title: "Руководитель продукта",
      short: "Руководитель продукта",
      normalizedTitle: "руководитель продукта",
      active: true,
      archived: false,
      version: 3,
      templateVersion: "1.0",
      driveFolderId: "drive-vac-visual",
      avatar: "РП",
      color: "#168cff",
      profile: {},
      abcDirections: [],
    }],
    operationBindings: {},
  };
}

async function renderComponent(t, name, props) {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  return expand(runtime.create(name, props).render());
}

async function openCandidateTranscript(t, candidate) {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const component = runtime.create("TranscriptTab", { transcript: candidate.transcript });
  const tree = expand(component.render());
  return { component, tree };
}

function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";
}

test("VIS-DEMO vacancy columns finish at the same vertical edge", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const sidebarRule = cssRule(css, ".vacancy-sidebar");
  const mainRule = cssRule(css, ".vacancy-main");

  assert.match(sidebarRule, /min-height\s*:\s*calc\(100vh\s*-\s*150px\)/);
  assert.doesNotMatch(sidebarRule, /(?:^|;)\s*height\s*:\s*calc\(100vh\s*-\s*150px\)/);
  assert.match(mainRule, /min-height\s*:\s*calc\(100vh\s*-\s*150px\)/);
});

function cssVariable(rule, name) {
  return rule.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;}]+)`))?.[1]?.trim() ?? "";
}

function isTranslucentWarningSurface(value) {
  const functionalAlpha = value.match(/(?:rgba|hsla)\([^)]*,\s*(0?\.\d+|1(?:\.0+)?)\s*\)$/i);
  if (functionalAlpha) return Number(functionalAlpha[1]) > 0 && Number(functionalAlpha[1]) < 1;
  const mix = value.match(/color-mix\([^)]*(?:var\(--warning-(?:ink|amber)\)|(?:amber|yellow))\s+(\d+(?:\.\d+)?)%[^)]*transparent/i);
  return Boolean(mix && Number(mix[1]) >= 12 && Number(mix[1]) <= 25);
}

function marginBottomPx(rule) {
  const explicit = rule.match(/margin-bottom\s*:\s*(\d+(?:\.\d+)?)px/i);
  if (explicit) return Number(explicit[1]);
  const shorthand = rule.match(/(?:^|;)\s*margin\s*:\s*([^;]+)/i)?.[1]?.trim().split(/\s+/) ?? [];
  const values = shorthand.map((value) => Number(value.match(/^(\d+(?:\.\d+)?)px$/)?.[1] ?? Number.NaN));
  if (values.length === 1) return values[0];
  if (values.length === 2) return values[0];
  if (values.length >= 3) return values[2];
  return Number.NaN;
}

function rankingRow(tree, candidateName) {
  return findAll(tree, (node) => hasClass(node, "ranking-row") && textContent(node).includes(candidateName))[0];
}

test("VIS-DEMO archived READY candidate keeps AI outcome, completed progress and detail content", async (t) => {
  const archived = readyCandidate({ archived: true });
  const ranking = await renderComponent(t, "VacancyCandidates", { candidates: [archived], onOpen() {} });
  const row = rankingRow(ranking, archived.name);
  assert.ok(row);
  assert.match(textContent(row), /В архиве/);
  assert.match(textContent(row), /Рекомендовать с оговорками/);
  assert.match(textContent(row), /100%/);
  assert.doesNotMatch(textContent(row), /85%/);
  assert.doesNotMatch(textContent(row), /Анализ|Прогноз формируется/);

  const detail = await renderComponent(t, "CandidateDetail", { candidate: archived, ...noops });
  assert.equal(findByClass(detail, "candidate-detail-ready").length, 1);
  assert.equal(findByClass(detail, "candidate-detail-processing").length, 0);
  assert.equal(findByClass(detail, "candidate-decision-region").length, 1);
  assert.match(textContent(detail), /В архиве/);
  assert.match(textContent(detail), /Рекомендовать с оговорками/);
  assert.equal(findAll(detail, (node) => node.type === "button" && textContent(node).trim() === "Удалить").length, 1);
  assert.doesNotMatch(textContent(detail), /Удалить окончательно/);
});

function outcomeRegion(tree, heading) {
  return findAll(tree, (node) => hasClass(node, "decision-outcome-card") && findAll(node, (child) => child.type === "h2" && textContent(child).trim() === heading).length === 1)[0];
}

function keStateRow(region, criterion) {
  return findAll(region, (node) => node.type === "p" && textContent(node).includes(criterion))[0];
}

function readyCandidateWithLongOutcomes() {
  const value = readyCandidate();
  value.result.aiOverview.strengths = Array.from({ length: 5 }, (_, index) => ({ name: `Сильная сторона ${index + 1}`, reason: `Основание сильной стороны ${index + 1}`, factIds: [] }));
  value.result.aiOverview.risks = Array.from({ length: 5 }, (_, index) => ({ name: `Риск ${index + 1}`, state: "Требует проверки", reason: `Основание риска ${index + 1}`, factIds: [] }));
  value.result.aiOverview.competencies = Array.from({ length: 5 }, (_, index) => ({ name: `Компетенция ${index + 1}`, state: "Подтверждено", reason: `Основание компетенции ${index + 1}`, factIds: [] }));
  return value;
}

function readyCandidateForDetailedCriteria() {
  const value = readyCandidate();
  value.result.aiOverview.abc = [
    { direction: "ABC с фактом A", grade: "A", reason: "Есть факт A", factIds: ["ev-a"] },
    { direction: "ABC без факта B", grade: "B", reason: "Нет связанного факта", factIds: [] },
    { direction: "ABC с фактом C", grade: "C", reason: "Есть факт C", factIds: ["ev-c"] },
  ];
  value.result.aiOverview.competencies = [
    { name: "Дополнительный критерий с фактом", state: "Подтверждено", reason: "Есть связанный факт", factIds: ["ev-comp"] },
    { name: "Дополнительный критерий без факта", state: "Недостаточно данных", reason: "Нет связанного факта", factIds: [] },
  ];
  value.result.aiOverview.evidence = [
    { id: "ev-a", technicalType: "abc:productivity", claim: "Связанный факт A", source: "Интервью.mp4", timecode: "00:01:00", criterion: "ABC с фактом A" },
    { id: "ev-c", technicalType: "abc:autonomy", claim: "Связанный факт C", source: "Резюме.pdf", page: 2, criterion: "ABC с фактом C" },
    { id: "ev-comp", technicalType: "competency:evidence", claim: "Связанный факт компетенции", source: "Интервью.mp4", timecode: "00:03:00", criterion: "Дополнительный критерий с фактом" },
    { id: "ev-unbound", technicalType: "unregistered_pipeline_fact_kind", claim: "Несвязанное доказательство", source: "Заметки.docx" },
  ];
  return value;
}

function readyCandidateForGradeColors() {
  const value = readyCandidateForDetailedCriteria();
  const gradeB = value.result.aiOverview.abc.find((item) => item.grade === "B");
  gradeB.factIds = ["ev-b"];
  value.result.aiOverview.evidence.push({
    id: "ev-b",
    technicalType: "abc:initiative",
    claim: "Связанный факт B",
    source: "Интервью.mp4",
    timecode: "00:02:00",
    criterion: gradeB.direction,
  });
  return value;
}

function readyCandidateForResolvedEvidenceCounts() {
  const value = readyCandidate();
  const criteria = [
    { direction: "Критерий с одним фактом", grade: "A", count: 1 },
    { direction: "Критерий с двумя фактами", grade: "B", count: 2 },
    { direction: "Критерий с пятью фактами", grade: "C", count: 5 },
  ];
  value.result.aiOverview.abc = criteria.map(({ direction, grade, count }) => ({
    direction,
    grade,
    reason: "Проверяемый набор доказательств",
    factIds: Array.from({ length: count }, (_, index) => `resolved-${count}-${index + 1}`),
  }));
  value.result.aiOverview.abc[1].factIds.push("missing-3", "missing-4", "missing-5");
  value.result.aiOverview.competencies = [];
  value.result.aiOverview.evidence = criteria.flatMap(({ direction, count }) => Array.from({ length: count }, (_, index) => ({
    id: `resolved-${count}-${index + 1}`,
    technicalType: "criterion:evidence",
    claim: `Разрешённый факт ${index + 1}`,
    source: "Интервью.mp4",
    timecode: `00:0${count}:${String(index + 1).padStart(2, "0")}`,
    criterion: direction,
  })));
  return value;
}

function publishedTranscriptFixture(count = 67) {
  return {
    runId: "published-run-65-plus",
    utterances: Array.from({ length: count }, (_, index) => ({
      id: `utterance-${index + 1}`,
      start: index * 10_000,
      end: index * 10_000 + 8_000,
      speaker: index % 2 === 0 ? "A" : "B",
      text: `Полная реплика ${String(index + 1).padStart(3, "0")} ${index === 33 ? "Уникальная середина интервью" : "без сокращения"}`,
      confidence: 0.96,
    })),
  };
}

function storageAssessmentWithKeCriteria() {
  return {
    structuredAssessment: {
      observations: [{ observation: "Кандидат проверен по критериям допуска к КЕ." }],
      abcStates: {},
      abcEvidence: {},
      stopFactors: [],
      risks: [],
      competencies: [],
      accessToKe: Array.from({ length: 8 }, (_, index) => ({
        criterion: `Критерий допуска ${index + 1}`,
        conclusion: `Вывод по критерию ${index + 1}`,
        state: index < 6 ? "Подтверждено" : "Требует уточнения",
        factIds: [`ke-fact-${index + 1}`],
      })),
    },
  };
}

test("VIS-DEMO vacancies keeps scope tabs and header actions, with a separate vacancy search below tabs", async (t) => {
  const tree = await renderComponent(t, "Vacancies", {
    candidates: [readyCandidate()],
    vacancyState: vacancyState(),
    onState() {},
    onOpen() {},
    onNotify() {},
  });
  const scope = findByClass(tree, "vacancy-scope")[0];
  assert.ok(scope, "active/archive vacancy scope remains visible");
  for (const label of ["Активные", "Архив"]) assert.equal(findAll(scope, (node) => node.type === "button" && textContent(node).trim() === label).length, 1);
  assert.ok(findAll(tree, (node) => node.type === "button" && textContent(node).includes("Новая вакансия")).length, "new vacancy header action remains available");
  const headerActions = findByClass(tree, "vacancy-header-actions")[0];
  assert.ok(headerActions);
  for (const label of ["Сгенерировать описание", "Настройки", "В архив"]) assert.equal(findAll(headerActions, (node) => node.type === "button" && textContent(node).includes(label)).length, 1, `${label} selected-vacancy header action remains available`);
  const vacancySearch = findAll(tree, (node) => node.type === "input" && node.props?.["aria-label"] === "Найти вакансию");
  assert.equal(vacancySearch.length, 1, "vacancy search is distinct from candidate search");
  assert.ok(findAll(scope, (node) => node === vacancySearch[0]).length === 0, "vacancy search follows the scope tabs instead of replacing them");
  assert.equal(findAll(tree, (node) => node.type === "input" && node.props?.["aria-label"] === "Найти кандидата").length, 1, "candidate search remains in the candidate ranking");
});

test("VIS-DEMO candidate vacancy filter keeps its chevron away from the right edge", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = cssRule(css, ".vacancy-filter select");
  const rightInset = Number(rule.match(/background-position\s*:\s*right\s+(\d+)px\s+center/i)?.[1] ?? 0);
  const rightPadding = Number(rule.match(/padding\s*:\s*[^;]*?\s+(\d+)px\s+[^;]*?\s+[^;]*/i)?.[1] ?? 0);

  assert.match(rule, /appearance\s*:\s*none/i, "native edge-aligned select chevron is replaced");
  assert.match(rule, /background-image\s*:/i, "the vacancy filter exposes a stable custom chevron");
  assert.ok(rightInset >= 10, "chevron has a comfortable right inset");
  assert.ok(rightPadding >= 32, "selected vacancy text cannot overlap the inset chevron");
});

test("VIS-DEMO vacancy workspace uses semantic ranking regions and accessible table headers", async (t) => {
  const tree = await renderComponent(t, "VacancyCandidates", {
    candidates: [readyCandidate(), processingCandidate({ id: 502, name: "Иван Петров", initials: "ИП" })],
    onOpen() {},
  });

  assert.equal(tree.type, "section", "vacancy ranking is a semantic section, not a generic layout div");
  assert.ok(hasClass(tree, "vacancy-ranking-region"), "ranking section exposes its stable semantic layout class");
  assert.equal(findByClass(tree, "ranking-toolbar").length, 1, "search and actions have a dedicated ranking toolbar");
  const table = findAll(tree, (node) => node.props?.role === "table" || node.type === "table")[0];
  assert.ok(table, "candidate ranking exposes table semantics");
  for (const heading of ["#", "Кандидат", "Статус", "Итог AI", "Этап / время"]) {
    assert.ok(findAll(table, (node) => ["columnheader", "th"].includes(node.props?.role ?? node.type) && textContent(node).trim() === heading).length, `${heading} is an accessible column header`);
  }
});

test("VIS-DEMO vacancy ranking preserves candidate search and omits unimplemented filters/export", async (t) => {
  const tree = await renderComponent(t, "VacancyCandidates", { candidates: [readyCandidate()], onOpen() {} });
  assert.equal(findAll(tree, (node) => node.type === "input" && node.props?.["aria-label"] === "Найти кандидата").length, 1);
  for (const label of ["Фильтры", "Экспорт"]) {
    const controls = findAll(tree, (node) => node.type === "button" && textContent(node).trim() === label);
    assert.equal(controls.length, 0, `${label} is not shown before the action is implemented`);
  }
});

test("VIS-DEMO vacancy ranking shows the published AI outcome instead of an ABC match score", async (t) => {
  const ready = readyCandidate({ progressPercent: 63, confidencePercent: 99 });
  const processing = processingCandidate({ id: 502, name: "Иван Петров", initials: "ИП" });
  const tree = await renderComponent(t, "VacancyCandidates", { candidates: [ready, processing], onOpen() {} });
  const readyResult = findByClass(rankingRow(tree, "Мария Орлова"), "ai-result-cell")[0];
  const pendingResult = findByClass(rankingRow(tree, "Иван Петров"), "ai-result-cell")[0];
  assert.equal(textContent(readyResult).trim(), ready.result.recommendation);
  assert.equal(textContent(pendingResult).trim(), "Ожидается");
  assert.equal(findByClass(rankingRow(tree, "Мария Орлова"), "score-cell").length, 0);
});

test("VIS-DEMO ranking preserves projection order instead of sorting by derived match percent", async (t) => {
  const low = readyCandidate({ id: 505, name: "Первый кандидат", initials: "ПК" });
  low.result.aiOverview.abc = [{ direction: "Продуктивность", grade: "C", reason: "C", factIds: [] }];
  const high = readyCandidate({ id: 506, name: "Второй кандидат", initials: "ВК" });
  high.result.aiOverview.abc = [{ direction: "Продуктивность", grade: "A", reason: "A", factIds: [] }];
  const tree = await renderComponent(t, "VacancyCandidates", { candidates: [low, high], onOpen() {} });
  const rows = findAll(tree, (node) => node.type === "button" && hasClass(node, "ranking-row"));
  assert.deepEqual(rows.map((row) => textContent(row).includes("Первый кандидат") ? "Первый кандидат" : "Второй кандидат"), ["Первый кандидат", "Второй кандидат"]);
});

test("VIS-DEMO READY status has semantic status-ready and tokenized green styling", async (t) => {
  const tree = await renderComponent(t, "VacancyCandidates", { candidates: [readyCandidate({ etaMinutes: null })], onOpen() {} });
  const readyRow = rankingRow(tree, "Мария Орлова");
  assert.equal(findAll(readyRow, (node) => hasClass(node, "status-ready")).length, 1, "READY uses status-ready semantics");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const readyRule = cssRule(css, ".status-ready");
  assert.match(readyRule, /var\(--success-soft\)/);
  assert.match(readyRule, /var\(--success-ink\)/);
  assert.doesNotMatch(readyRule, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("VIS-DEMO READY stage/time contains only progress percent and bar", async (t) => {
  const tree = await renderComponent(t, "VacancyCandidates", { candidates: [readyCandidate({ etaMinutes: null })], onOpen() {} });
  const readyRow = rankingRow(tree, "Мария Орлова");
  const progress = findByClass(readyRow, "ranking-progress-cell")[0];
  assert.equal(textContent(progress).trim(), "100%");
  assert.equal(findAll(progress, (node) => node.props?.role === "progressbar" && node.props?.["aria-valuenow"] === 100).length, 1);
  assert.doesNotMatch(textContent(progress), /Готов|Завершено|мин|Результат опубликован/i);
});

test("VIS-DEMO processing stage/time contains only current progress percent and bar", async (t) => {
  const tree = await renderComponent(t, "VacancyCandidates", { candidates: [processingCandidate({ id: 502, name: "Иван Петров", initials: "ИП" })], onOpen() {} });
  const processingRow = rankingRow(tree, "Иван Петров");
  const progress = findByClass(processingRow, "ranking-progress-cell")[0];
  assert.equal(textContent(progress).trim(), "63%");
  assert.equal(findAll(progress, (node) => node.props?.role === "progressbar" && node.props?.["aria-valuenow"] === 63).length, 1);
  assert.doesNotMatch(textContent(progress), /AI-анализ|сопоставление|мин/i);
});

test("VIS-DEMO READY candidate card footer separates actual processing duration from recommendation", async (t) => {
  const completed = readyCandidate();
  const processing = processingCandidate({ id: 502, name: "Иван Петров", initials: "ИП" });
  const unknown = readyCandidate({ id: 503, name: "Анна Смирнова", initials: "АС", elapsedMinutes: undefined });
  const tree = await renderComponent(t, "Candidates", {
    items: [completed, processing, unknown],
    vacancies: vacancyState().vacancies,
    onOpen() {},
    dashboardFilter: null,
    onClearDashboardFilter() {},
  });
  const cards = findByClass(tree, "candidate-card");
  const completedCard = cards.find((card) => textContent(card).includes("Мария Орлова"));
  assert.ok(completedCard, "completed candidate card is rendered");
  const footer = findAll(completedCard, (node) => node.type === "footer" && hasClass(node, "candidate-card-footer"))[0];
  assert.ok(footer, "completed card exposes a semantic footer region");
  const duration = findByClass(footer, "candidate-processing-duration");
  const result = findByClass(footer, "candidate-card-result");
  assert.equal(duration.length, 1, "actual completed duration has its own left footer region");
  assert.equal(textContent(duration[0]).trim(), "18 мин");
  assert.equal(result.length, 1, "recommendation has its own right footer region");
  assert.equal(textContent(result[0]).trim(), "Рекомендовать с оговорками");

  for (const candidateName of ["Иван Петров", "Анна Смирнова"]) {
    const card = cards.find((item) => textContent(item).includes(candidateName));
    assert.ok(card, `${candidateName} card is rendered`);
    assert.equal(findByClass(card, "candidate-processing-duration").length, 0, `${candidateName} gets no invented completed duration`);
  }
});

test("VIS-DEMO candidate progress track keeps spacing before a borderless footer", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const progressRule = cssRule(css, ".candidate-card .candidate-progress");
  assert.ok(marginBottomPx(progressRule) >= 12, `progress-to-footer gap is at least 12px, received ${marginBottomPx(progressRule)}px`);
  const footerRule = cssRule(css, ".candidate-card footer");
  assert.doesNotMatch(footerRule, /(?:^|;)\s*border(?:-top|-right|-bottom|-left)?\s*:/, "candidate footer has no border separator");
  assert.match(footerRule, /display\s*:\s*(?:flex|grid)/, "footer lays out duration and result as separate regions");
  assert.match(footerRule, /justify-content\s*:\s*space-between/, "duration remains left and recommendation remains right");
  assert.match(cssRule(css, ".candidate-card-result"), /text-align\s*:\s*right/, "recommendation is visually anchored to the right");
  const pseudoRules = `${cssRule(css, ".candidate-card-footer::before")}\n${cssRule(css, ".candidate-card-footer::after")}`;
  assert.doesNotMatch(pseudoRules, /(?:content\s*:\s*["'][^"']*["']|border(?:-top|-bottom)?\s*:|background(?:-color)?\s*:)/, "candidate footer has no pseudo-element divider");
});

test("VIS-DEMO READY candidate card shows Готово only in its status badge while processing keeps its stage", async (t) => {
  const tree = await renderComponent(t, "Candidates", {
    items: [readyCandidate(), processingCandidate({ id: 502, name: "Иван Петров", initials: "ИП" })],
    vacancies: vacancyState().vacancies,
    onOpen() {},
    dashboardFilter: null,
    onClearDashboardFilter() {},
  });
  const cards = findByClass(tree, "candidate-card");
  const readyCard = cards.find((card) => textContent(card).includes("Мария Орлова"));
  const processingCard = cards.find((card) => textContent(card).includes("Иван Петров"));
  assert.ok(readyCard && processingCard, "READY and processing fixtures are rendered");

  const readyBadge = findByClass(readyCard, "status-ready");
  assert.equal(readyBadge.length, 1, "READY keeps one semantic green status badge");
  assert.equal(textContent(readyBadge[0]).trim(), "Готово");
  assert.equal((textContent(readyCard).match(/Готово/g) ?? []).length, 1, "Готово appears exactly once on the READY card");
  assert.equal(findByClass(readyCard, "candidate-score").length, 0, "READY card omits the duplicate current-stage block");
  assert.equal(textContent(findByClass(readyCard, "candidate-processing-duration")[0]).trim(), "18 мин", "left footer duration remains available");
  assert.equal(textContent(findByClass(readyCard, "candidate-card-result")[0]).trim(), "Рекомендовать с оговорками", "right footer recommendation remains available");

  const processingStage = findByClass(processingCard, "candidate-score");
  assert.equal(processingStage.length, 1, "processing card retains its current-stage region");
  assert.match(textContent(processingStage[0]), /Текущий этап/);
  const processingStageValue = findAll(processingStage[0], (node) => node.type === "b")[0];
  assert.equal(textContent(processingStageValue).trim(), "Анализ", "processing stage uses the existing normative WORKFLOW_LABELS value");
});

test("VIS-DEMO READY projection preserves the version-bound report duration", async (t) => {
  const runtime = await loadDashboardProjectionHarness();
  t.after(() => runtime.cleanup());
  const report = {
    analysisVersion: 8,
    completedAt: "2026-08-24T08:35:00.000Z",
    elapsedMinutes: 35,
    recommendation: "Рекомендовать с оговорками",
    documents: [
      { id: "result-v8", type: "candidate-results", fileName: "Итоги_v0008.pdf", driveFileId: "drive-result-v8" },
      { id: "abc-v8", type: "abc-test", fileName: "ABC_v0008.pdf", driveFileId: "drive-abc-v8" },
    ],
  };
  const projected = runtime.projectCandidate(processingCandidate({ elapsedMinutes: 7 }), [], report);
  assert.equal(projected.status, "READY");
  assert.equal(projected.result.version, 8);
  assert.equal(projected.elapsedMinutes, 35, "READY candidate receives duration from the exact published report version");

  const source = await readFile(new URL("../server/candidate-pipeline/dashboard-projection.ts", import.meta.url), "utf8");
  assert.match(source, /type\s+ReadyReportProjection\s*=\s*\{[^}]*elapsedMinutes\s*:\s*number/s, "report projection declares its version-bound duration");
  assert.match(source, /elapsedMinutes\s*:\s*report\.elapsedMinutes/, "READY projection copies report duration instead of retaining stale candidate runtime");
});

test("VIS-DEMO postgres READY report query derives duration from attempts of that report run without row multiplication", async () => {
  const source = await readFile(new URL("../server/product/postgres-repository.ts", import.meta.url), "utf8");
  const reportQuery = source.match(/this\.sql<Row\[\]>`SELECT\s+r\.candidate_id[\s\S]*?WHERE\s+r\.state='PUBLISHED'[\s\S]*?`,/)?.[0] ?? "";
  assert.ok(reportQuery, "published READY report query is observable");
  const versionBoundStart = reportQuery.match(/(?:JOIN\s+LATERAL|\(\s*SELECT)[\s\S]{0,700}?MIN\s*\(\s*\w+\.started_at\s*\)[\s\S]{0,700}?agent_attempts[\s\S]{0,700}?\.run_id\s*=\s*r\.run_id/is)?.[0] ?? "";
  assert.ok(versionBoundStart, "report query aggregates MIN(agent_attempts.started_at) in a correlated/lateral subquery bound to r.run_id");
  assert.match(reportQuery, /EXTRACT\s*\(\s*EPOCH\s+FROM[\s\S]*?(?:run\.last_progress_at|finished_at)[\s\S]*?started_at[\s\S]*?\/\s*60[\s\S]*?AS\s+elapsed_minutes/i, "duration runs from version-bound start to report/run completion");
  const queryWithoutTimingSubquery = reportQuery.replace(versionBoundStart, "");
  assert.doesNotMatch(queryWithoutTimingSubquery, /JOIN\s+agent_attempts\b/i, "agent attempts are not joined into the document rowset");
  assert.match(source, /elapsedMinutes\s*:\s*(?:Number\(row\.elapsed_minutes\)|Math\.(?:round|floor)\(Number\(row\.elapsed_minutes\)\))/, "repository maps the computed report duration into ReadyReportProjection");
});

test("VIS-DEMO CandidateDetail transcript tab renders every published utterance without truncation", async (t) => {
  const transcript = publishedTranscriptFixture();
  const { tree } = await openCandidateTranscript(t, readyCandidate({ transcript }));
  const region = findByClass(tree, "candidate-transcript-region")[0];
  assert.ok(region, "published candidate transcript has a semantic region");
  const rows = findByClass(region, "transcript-utterance");
  assert.equal(rows.length, 67, "all 67 utterances render without slice or truncation");
  for (const position of [0, 33, 66]) assert.match(textContent(rows[position]), new RegExp(transcript.utterances[position].text));
});

test("VIS-DEMO CandidateDetail passes the published candidate transcript into its transcript tab", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /<TranscriptTab\s+transcript=\{candidate\.transcript\}\s*\/>/, "CandidateDetail tab consumes the projected candidate transcript rather than demo rows");
  assert.doesNotMatch(source, /function\s+TranscriptTab\s*\(\s*\)\s*\{[\s\S]*?const\s+rows\s*=\s*\[/, "TranscriptTab has no hardcoded demo transcript");
  assert.doesNotMatch(source, /transcript[^;\n]*\.slice\s*\(/i, "transcript rendering never truncates the projected utterance list");
});

test("VIS-DEMO CandidateDetail transcript search filters the complete published set", async (t) => {
  const { component, tree } = await openCandidateTranscript(t, readyCandidate({ transcript: publishedTranscriptFixture() }));
  const input = findAll(tree, (node) => node.type === "input" && node.props?.placeholder === "Поиск по тексту")[0];
  assert.ok(input, "transcript search is available");
  input.props.onChange({ target: { value: "Уникальная середина интервью" } });
  const filtered = expand(component.render());
  const rows = findByClass(filtered, "transcript-utterance");
  assert.equal(rows.length, 1, "search finds the unique middle utterance from the full projection");
  assert.match(textContent(rows[0]), /Полная реплика 034.*Уникальная середина интервью/);
  assert.doesNotMatch(textContent(filtered), /Полная реплика 001|Полная реплика 067/);
});

test("VIS-DEMO CandidateDetail transcript has subject-specific empty states", async (t) => {
  const missing = await openCandidateTranscript(t, readyCandidate({ transcript: { runId: "published-empty-run", utterances: [] } }));
  let empty = findByClass(missing.tree, "transcript-empty-state")[0];
  assert.ok(empty, "published run without utterances has an explicit empty state");
  assert.equal(textContent(empty).trim(), "Транскрипция для опубликованной версии отсутствует.");

  const searchable = await openCandidateTranscript(t, readyCandidate({ id: 504, transcript: publishedTranscriptFixture() }));
  const input = findAll(searchable.tree, (node) => node.type === "input" && node.props?.placeholder === "Поиск по тексту")[0];
  input.props.onChange({ target: { value: "совпадений точно нет" } });
  const searchedTree = expand(searchable.component.render());
  empty = findByClass(searchedTree, "transcript-empty-state")[0];
  assert.ok(empty, "empty search result has an explicit state");
  assert.equal(textContent(empty).trim(), "По запросу ничего не найдено.");
});

test("VIS-DEMO READY projection and postgres query bind transcript bundle to the exact published report run", async (t) => {
  const runtime = await loadDashboardProjectionHarness();
  t.after(() => runtime.cleanup());
  const transcript = publishedTranscriptFixture();
  const report = {
    analysisVersion: 9,
    completedAt: "2026-08-24T09:35:00.000Z",
    elapsedMinutes: 35,
    recommendation: "Рекомендовать с оговорками",
    transcript,
    documents: [
      { id: "result-v9", type: "candidate-results", fileName: "Итоги_v0009.pdf", driveFileId: "drive-result-v9" },
      { id: "abc-v9", type: "abc-test", fileName: "ABC_v0009.pdf", driveFileId: "drive-abc-v9" },
    ],
  };
  const projected = runtime.projectCandidate(processingCandidate(), [], report);
  assert.equal(projected.transcript?.runId, "published-run-65-plus");
  assert.equal(projected.transcript?.utterances.length, 67, "full transcript bundle reaches CandidateRecord");

  const repository = await readFile(new URL("../server/product/postgres-repository.ts", import.meta.url), "utf8");
  const reportQuery = repository.match(/this\.sql<Row\[\]>`SELECT\s+r\.candidate_id[\s\S]*?WHERE\s+r\.state='PUBLISHED'[\s\S]*?`,/)?.[0] ?? "";
  assert.match(reportQuery, /transcript[\s\S]*?\.run_id\s*=\s*r\.run_id[\s\S]*?kind\s*=\s*'transcript-bundle'/i, "transcript artifact is constrained to the exact published report run");
  assert.match(reportQuery, /artifact_blobs[\s\S]*?transcript[\s\S]*?\.checksum/i, "version-bound transcript-bundle payload comes from artifact_blobs");
  assert.doesNotMatch(reportQuery, /ORDER\s+BY[\s\S]*?transcript[\s\S]*?created_at_utc\s+DESC(?![\s\S]*?\.run_id\s*=\s*r\.run_id)/i, "query never substitutes a stale/newer transcript from another run");
});

test("VIS-DEMO processing detail separates hero score from current stage and does not invent progress", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: processingCandidate(), ...noops });
  assert.ok(hasClass(tree, "candidate-detail-processing"), "processing page exposes a stable state/layout class");
  assert.equal(findByClass(tree, "hero-score-indicator").length, 1, "hero score has its own semantic class");
  const stage = findByClass(tree, "hero-stage")[0];
  assert.ok(stage, "current workflow stage has its own semantic class");
  assert.match(textContent(stage), /AI-анализ · сопоставление фактов/);
  assert.match(textContent(tree), /63\s*%/, "saved progressPercent is shown in processing hero");
  assert.equal(findAll(tree, (node) => node.props?.["aria-valuenow"] === 63).length, 1);
  assert.match(textContent(tree), /(?:≈\s*)?7 мин/);
});

test("VIS-DEMO processing hero does not invent progress when projection omits it", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: processingCandidate({ progressPercent: undefined }), ...noops });
  assert.doesNotMatch(textContent(tree), /(?:^|\s)(?:\d{1,2}|100)\s*%/);
  assert.equal(findAll(tree, (node) => node.props?.["aria-valuenow"] !== undefined).length, 0);
});

test("VIS-DEMO processing detail renders workflow timeline, observable metrics and materials", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: processingCandidate(), ...noops });
  const timeline = findByClass(tree, "processing-timeline")[0];
  assert.ok(timeline, "processing screen includes the demo workflow timeline");
  for (const stage of ["Обнаружен", "Проверка файлов", "Транскрибация", "AI-анализ", "Проверка результата", "Готово"]) assert.match(textContent(timeline), new RegExp(stage, "i"));
  const metrics = findByClass(tree, "processing-metrics")[0];
  assert.ok(metrics, "processing screen has a dedicated metrics region");
  assert.match(textContent(metrics), /Прошло.*11/i);
  assert.match(textContent(metrics), /Осталось|Прогноз/i);
  const materials = findByClass(tree, "processing-materials")[0];
  assert.ok(materials, "source files remain a named processing region");
  for (const fileName of ["Резюме Мария Орлова.pdf", "Интервью Мария Орлова.mp4"]) {
    assert.equal((textContent(materials).match(new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1, `${fileName} appears once in processing materials`);
  }
});

test("VIS-DEMO ready detail exposes semantic composition and separate hero score/stage", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidate(), ...noops });
  assert.ok(hasClass(tree, "candidate-detail-ready"), "ready page exposes its state/layout class");
  for (const token of ["candidate-decision-region", "candidate-assessment-region", "candidate-matching-region", "candidate-materials-region"]) {
    assert.equal(findByClass(tree, token).length, 1, `${token} is a unique semantic region`);
  }
  assert.equal(findByClass(tree, "hero-score-indicator").length, 1);
  assert.equal(findByClass(tree, "hero-stage").length, 1);
});

test("VIS-DEMO READY outcome blocks show every strength, risk and competency immediately", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidateWithLongOutcomes(), ...noops });
  for (const [heading, prefix] of [["Сильные стороны", "Сильная сторона"], ["Риски и пробелы", "Риск"], ["Компетенции", "Компетенция"]]) {
    const region = outcomeRegion(tree, heading);
    assert.ok(region, `${heading} is a dedicated outcome region`);
    assert.equal(findAll(region, (node) => node.type === "details" || node.type === "summary").length, 0, `${heading} has no collapsed details/summary`);
    assert.doesNotMatch(textContent(region), /Показать ещё/i);
    for (let index = 1; index <= 5; index += 1) assert.match(textContent(region), new RegExp(`${prefix} ${index}`), `${prefix} ${index} is immediately visible`);
  }
});

test("VIS-DEMO READY outcome item/icon classes and semantic colors stay stable without disclosure controls", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidateWithLongOutcomes(), ...noops });
  for (const [heading, tone, expectedItems] of [["Сильные стороны", "is-strength", 5], ["Риски и пробелы", "is-risk", 5], ["Компетенции", "is-strength", 5]]) {
    const region = outcomeRegion(tree, heading);
    assert.ok(hasClass(region, tone), `${heading} keeps ${tone}`);
    assert.equal(findByClass(region, "decision-outcome-item").length, expectedItems, `${heading} items expose stable classes`);
    assert.equal(findByClass(region, "decision-outcome-icon").length, expectedItems + 1, `${heading} header and item icons expose stable classes`);
  }
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(cssRule(css, ".is-strength header>span"), /var\(--success-soft\).*var\(--success-ink\)/);
  assert.match(cssRule(css, ".is-risk header>span"), /var\(--risk-soft\).*var\(--risk-ink\)/);
});

test("VIS-DEMO A/B/C badges use success, warning and risk semantics in detail and matching aside", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidateForGradeColors(), ...noops });
  const detail = findByClass(tree, "candidate-assessment-region")[0];
  const matching = findByClass(tree, "candidate-matching-score-region")[0];
  for (const [grade, token] of [["A", "grade-a"], ["B", "grade-b"], ["C", "grade-c"]]) {
    assert.ok(findAll(detail, (node) => hasClass(node, "assessment-grade") && hasClass(node, token) && textContent(node).trim() === grade).length, `${grade} detail badge keeps ${token}`);
    assert.ok(findAll(matching, (node) => hasClass(node, "assessment-grade") && hasClass(node, token) && textContent(node).trim() === grade).length, `${grade} aside badge keeps ${token}`);
  }
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const token of ["--success-soft", "--success-ink", "--warning-soft", "--warning-ink", "--risk-soft", "--risk-ink"]) assert.match(css, new RegExp(`${token}\\s*:`), `${token} is declared for both themes`);
  assert.match(cssRule(css, ".assessment-grade.grade-a"), /var\(--success-soft\).*var\(--success-ink\)/);
  assert.match(cssRule(css, ".assessment-grade.grade-b"), /var\(--warning-soft\).*var\(--warning-ink\)/);
  assert.match(cssRule(css, ".assessment-grade.grade-c"), /var\(--risk-soft\).*var\(--risk-ink\)/);
});

test("VIS-DEMO detailed assessment renders only criteria with genuinely linked evidence", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidateForDetailedCriteria(), ...noops });
  const detail = findByClass(tree, "candidate-assessment-region")[0];
  for (const visible of ["ABC с фактом A", "ABC с фактом C", "Дополнительный критерий с фактом"]) assert.match(textContent(detail), new RegExp(visible));
  for (const absent of ["ABC без факта B", "Дополнительный критерий без факта"]) assert.doesNotMatch(textContent(detail), new RegExp(absent));
});

test("VIS-DEMO ABC criterion with declared but unresolved factIds is not rendered as zero evidence", async (t) => {
  const value = readyCandidateForDetailedCriteria();
  value.result.aiOverview.abc.push({
    direction: "ABC только с отсутствующим factId",
    grade: "B",
    reason: "Заявленная связь не разрешилась в опубликованное доказательство",
    factIds: ["missing-abc-fact"],
  });
  const tree = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  const section = findByClass(tree, "abc-criteria-subsection")[0];
  assert.doesNotMatch(textContent(section), /ABC только с отсутствующим factId/);
  assert.doesNotMatch(textContent(section), /0 доказательств/);
  assert.ok(findByClass(section, "criterion-detail-row").every((row) => findByClass(row, "criterion-fact").length > 0), "every visible ABC row has at least one rendered evidence item");
});

test("VIS-DEMO criterion titles use a dedicated theme-safe accent token", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const [theme, rule] of [["light", cssRule(css, ":root")], ["dark", cssRule(css, 'html[data-theme="dark"]')]]) {
    const accent = cssVariable(rule, "--criterion-accent");
    assert.notEqual(accent, "", `${theme} theme declares --criterion-accent`);
    assert.notEqual(accent, "var(--ink)", `${theme} criterion accent is distinct from ordinary ink`);
    assert.doesNotMatch(accent, /^(?:#fff(?:fff)?|white)$/i, `${theme} criterion accent is not hardcoded white`);
  }
  const titleRule = cssRule(css, ".criterion-row-copy>b");
  assert.match(titleRule, /color\s*:\s*var\(--criterion-accent\)/, "criterion title consumes its dedicated semantic token");
  assert.doesNotMatch(titleRule, /color\s*:\s*(?:var\(--ink\)|#fff(?:fff)?|white)/i);
});

test("VIS-DEMO disclosed evidence headings use a dedicated verified color in both themes", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const [theme, rule] of [["light", cssRule(css, ":root")], ["dark", cssRule(css, 'html[data-theme="dark"]')]]) {
    const verified = cssVariable(rule, "--evidence-verified-ink");
    assert.notEqual(verified, "", `${theme} theme declares --evidence-verified-ink`);
    assert.notEqual(verified, "var(--ink)", `${theme} verified evidence is visually distinct from body ink`);
    assert.doesNotMatch(verified, /^(?:#fff(?:fff)?|white)$/i, `${theme} verified evidence is not hardcoded white`);
  }
  const evidenceTitleRule = cssRule(css, ".criterion-fact>b");
  assert.match(evidenceTitleRule, /color\s*:\s*var\(--evidence-verified-ink\)/, "evidence heading consumes its semantic verified token");
  assert.doesNotMatch(evidenceTitleRule, /color\s*:\s*(?:var\(--ink\)|#fff(?:fff)?|white)/i);
});

test("VIS-DEMO additional criteria require resolved evidence, not only declared factIds", async (t) => {
  const value = readyCandidateForDetailedCriteria();
  value.result.aiOverview.competencies = [
    { name: "Критерий с раскрываемым фактом", state: "Подтверждено", reason: "Факт разрешён", factIds: ["ev-comp"] },
    { name: "Критерий только с declared factId", state: "Подтверждено", reason: "Факт отсутствует в evidence", factIds: ["missing-fact"] },
  ];
  value.result.aiOverview.evidence = value.result.aiOverview.evidence.map((item) => item.id === "ev-comp" ? { ...item, criterion: "Критерий с раскрываемым фактом" } : item);
  const tree = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  const section = findByClass(tree, "additional-criteria-subsection")[0];
  assert.doesNotMatch(textContent(section), /Критерий только с declared factId/);
  const rows = findByClass(section, "competency-detail-row");
  assert.equal(rows.length, 1, "only the criterion with resolved evidence is rendered");
  assert.match(textContent(rows[0]), /Критерий с раскрываемым фактом/);
  assert.equal(findAll(rows[0], (node) => node.type === "summary" || /Открыть факты/.test(textContent(node))).length, 0, "resolved evidence does not add a separate disclosure label");
});

test("VIS-DEMO unclaimed evidence is grouped into expandable human criterion rows", async (t) => {
  const value = readyCandidate();
  value.result.aiOverview.abc = [];
  value.result.aiOverview.competencies = [];
  value.result.aiOverview.evidence = [
    { id: "unclaimed-ops-1", technicalType: "competency_evidence", claim: "Выстроил процесс планирования.", source: "Интервью.mp4", timecode: "00:21:00", criterion: "Операционное мышление" },
    { id: "unclaimed-ops-2", technicalType: "resume_achievement_fact", claim: "Сократил цикл поставки.", source: "Резюме.pdf", page: 3, criterion: "Операционное мышление" },
    { id: "unclaimed-comms-1", technicalType: "competency_evidence", claim: "Согласовал решение с командами.", source: "Интервью.mp4", timecode: "00:27:00", criterion: "Коммуникация" },
  ];
  const tree = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  const section = findByClass(tree, "additional-criteria-subsection")[0];
  assert.equal(findByClass(section, "unmatched-fact").length, 0, "additional section never renders evidence as direct unmatched cards");
  const rows = findByClass(section, "criterion-detail-row");
  assert.equal(rows.length, 2, "three evidence items are grouped into two human criterion rows");
  for (const [criterion, factCount] of [["Операционное мышление", 2], ["Коммуникация", 1]]) {
    const row = rows.find((candidateRow) => textContent(candidateRow).includes(criterion));
    assert.ok(row, `${criterion} has a grouped criterion row`);
    assert.equal(findByClass(row, "criterion-fact").length, factCount, `${criterion} contains all and only its grouped facts`);
  }
});

test("VIS-DEMO grouped evidence rows use an accessible document-check SVG and a specific purpose", async (t) => {
  const value = readyCandidateForDetailedCriteria();
  const tree = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  const section = findByClass(tree, "additional-criteria-subsection")[0];
  const rows = findByClass(section, "grouped-evidence-detail-row");
  assert.ok(rows.length >= 1, "unclaimed evidence is represented by grouped criterion rows");
  for (const row of rows) {
    const icons = findAll(row, (node) => node.type === "svg" && hasClass(node, "grouped-evidence-icon"));
    assert.equal(icons.length, 1, "grouped row has one stable inline document-check icon");
    const icon = icons[0];
    assert.equal(icon.props["aria-hidden"], true);
    assert.equal(icon.props["data-icon"], "document-check");
    assert.equal(icon.props.stroke, "currentColor");
    assert.equal(icon.props.fill, "none");
    assert.ok(findAll(icon, (node) => ["path", "polyline"].includes(String(node.type))).length >= 2, "icon contains document and check geometry");
    assert.doesNotMatch(textContent(row), /[+×✕✖]/, "grouped evidence never uses an ambiguous plus or cross glyph");
    assert.match(textContent(row), /Доказательства, связанные с этим критерием/, "row explains why these evidence items are grouped here");
    assert.doesNotMatch(textContent(row), /Дополнительные подтверждающие материалы/, "generic purpose copy is removed");
  }

  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const iconRule = cssRule(css, ".grouped-evidence-icon");
  assert.match(iconRule, /display\s*:\s*block/);
  assert.match(iconRule, /width\s*:\s*\d+(?:\.\d+)?px/);
  assert.match(iconRule, /height\s*:\s*\d+(?:\.\d+)?px/);
  assert.match(iconRule, /color\s*:\s*var\(--evidence-verified-ink\)/, "document-check icon shares the verified evidence semantic color");
});

test("VIS-DEMO whole criterion row toggles a directly adjacent full-width evidence area", async (t) => {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const component = runtime.create("CandidateDetail", { candidate: readyCandidateForDetailedCriteria(), ...noops });
  let tree = expand(component.render());
  let detail = findByClass(tree, "candidate-assessment-region")[0];
  assert.doesNotMatch(textContent(detail), /Открыть факты/, "there is no separate disclosure text or button");

  let triggers = findByClass(detail, "criterion-row-trigger");
  assert.ok(triggers.length >= 2, "each criterion exposes the whole row as a stable interactive trigger");
  for (const trigger of triggers) {
    assert.equal(trigger.type, "button", "native button semantics make the entire row keyboard accessible");
    assert.equal(trigger.props.type, "button");
    assert.equal(trigger.props["aria-expanded"], false);
    assert.equal(typeof trigger.props.onClick, "function");
  }

  triggers[0].props.onClick();
  tree = expand(component.render());
  detail = findByClass(tree, "candidate-assessment-region")[0];
  triggers = findByClass(detail, "criterion-row-trigger");
  const openItems = findByClass(detail, "is-open").filter((node) => hasClass(node, "criterion-detail-item"));
  assert.equal(openItems.length, 1, "only the disclosed criterion receives the explicit open visual state");
  assert.equal(triggers[0].props["aria-expanded"], true);
  assert.equal(triggers[1].props["aria-expanded"], false);
  const openChildren = Array.isArray(openItems[0].props.children) ? openItems[0].props.children : [openItems[0].props.children];
  const triggerIndex = openChildren.findIndex((node) => hasClass(node, "criterion-row-trigger"));
  const evidenceIndex = openChildren.findIndex((node) => hasClass(node, "criterion-evidence-area"));
  assert.equal(evidenceIndex, triggerIndex + 1, "evidence area is immediately below its main criterion row");
  assert.ok(findByClass(openItems[0], "criterion-fact").length > 0, "expanded evidence belongs to the selected criterion");

  triggers[0].props.onClick();
  tree = expand(component.render());
  detail = findByClass(tree, "candidate-assessment-region")[0];
  assert.equal(findByClass(detail, "is-open").filter((node) => hasClass(node, "criterion-detail-item")).length, 0, "second click collapses the row");
  assert.equal(findByClass(detail, "criterion-row-trigger")[0].props["aria-expanded"], false);
});

test("VIS-DEMO criterion evidence open state is full-width, separated and reduced-motion safe", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(cssRule(css, ".criterion-detail-item.is-open"), /(?:border|background|box-shadow)\s*:/, "open state is visually explicit and scoped to the selected item");
  assert.match(cssRule(css, ".criterion-evidence-area"), /(?:grid-column\s*:\s*1\s*\/\s*-1|width\s*:\s*100%)/, "evidence area spans the criterion width");
  assert.match(cssRule(css, ".criterion-evidence-area"), /(?:border(?:-top)?|background|padding|margin-top)\s*:/, "evidence is visually separated from the main row");
  const reducedMotion = css.match(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(reducedMotion, /criterion-(?:detail-item|evidence-area|row-trigger)[\s\S]*transition\s*:\s*none/, "reduced-motion disables criterion disclosure transitions without timing assertions");
});

test("VIS-DEMO criterion chevron uses a centered symmetric inline SVG without font-metric hacks", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidateForDetailedCriteria(), ...noops });
  const detail = findByClass(tree, "candidate-assessment-region")[0];
  const chevrons = findByClass(detail, "criterion-row-chevron");
  assert.ok(chevrons.length >= 2, "criterion rows expose stable chevron tiles");
  for (const chevron of chevrons) {
    const icons = findAll(chevron, (node) => node.type === "svg" && hasClass(node, "criterion-row-chevron-icon"));
    assert.equal(icons.length, 1, "chevron tile contains one semantic inline SVG icon");
    assert.equal(icons[0].props.viewBox, "0 0 16 16", "square viewBox gives the chevron a symmetric coordinate system");
    const paths = findAll(icons[0], (node) => node.type === "path");
    assert.equal(paths.length, 1, "inline SVG contains one stable chevron path");
    const path = String(paths[0].props.d ?? "").replaceAll(",", " ").replace(/\s+/g, " ").trim();
    assert.match(path, /^(?:M4 6L8 10L12 6|M4 6 L8 10 L12 6|M4 6l4 4 4-4)$/i, "path is horizontally symmetric around x=8");
    assert.doesNotMatch(textContent(chevron), /⌄/, "font glyph is not used as the visual oracle");
  }

  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const tileRule = cssRule(css, ".criterion-row-chevron");
  assert.match(tileRule, /width\s*:\s*26px/);
  assert.match(tileRule, /height\s*:\s*26px/);
  assert.match(tileRule, /display\s*:\s*grid[\s\S]*place-items\s*:\s*center/, "tile centers the SVG on both axes");
  const iconRule = cssRule(css, ".criterion-row-chevron-icon");
  const iconWidth = iconRule.match(/width\s*:\s*(\d+(?:\.\d+)?)px/)?.[1];
  const iconHeight = iconRule.match(/height\s*:\s*(\d+(?:\.\d+)?)px/)?.[1];
  assert.ok(iconWidth && iconHeight, "SVG icon has fixed pixel width and height");
  assert.equal(iconWidth, iconHeight, "SVG icon dimensions are square");
  assert.match(iconRule, /display\s*:\s*block/, "inline SVG does not inherit an inline text baseline");
  const openTileRule = cssRule(css, ".criterion-detail-item.is-open .criterion-row-chevron");
  const openIconRule = cssRule(css, ".criterion-detail-item.is-open .criterion-row-chevron-icon");
  assert.match(`${openTileRule}\n${openIconRule}`, /transform\s*:\s*rotate\(180deg\)/, "open-state rotation remains on the tile or SVG icon");
  const chevronRules = [...css.matchAll(/([^{}]*criterion-row-chevron(?:-icon)?[^{}]*)\{([^}]*)\}/g)].map(([, selector, declarations]) => `${selector}{${declarations}}`).join("\n");
  assert.doesNotMatch(chevronRules, /translateY\s*\(/, "SVG centering never relies on font-metric translateY hacks");
  assert.doesNotMatch(`${openTileRule}\n${openIconRule}`, /(?:top|bottom|margin(?:-top|-bottom)?)\s*:/, "open rotation introduces no positional offset");
});

test("VIS-DEMO criterion count equals resolved rendered facts rather than declared factIds", async (t) => {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const component = runtime.create("CandidateDetail", { candidate: readyCandidateForResolvedEvidenceCounts(), ...noops });
  let tree = expand(component.render());
  let detail = findByClass(tree, "candidate-assessment-region")[0];
  let row = findByClass(detail, "criterion-detail-item").find((item) => textContent(item).includes("Критерий с двумя фактами"));
  assert.ok(row, "criterion with five declared ids and two resolved evidence items is rendered");
  assert.match(textContent(row), /2 доказательства/, "counter is based on two resolved evidence items, not five declared ids");
  const trigger = findByClass(row, "criterion-row-trigger")[0];
  trigger.props.onClick();

  tree = expand(component.render());
  detail = findByClass(tree, "candidate-assessment-region")[0];
  row = findByClass(detail, "criterion-detail-item").find((item) => textContent(item).includes("Критерий с двумя фактами"));
  assert.equal(findByClass(row, "criterion-row-trigger")[0].props["aria-expanded"], true, "facts are measured in the disclosed row");
  assert.equal(findByClass(row, "criterion-fact").length, 2, "exactly the two resolved facts are rendered after disclosure");
  assert.match(textContent(row), /2 доказательства/);
  assert.doesNotMatch(textContent(row), /5 доказательств/);
});

test("VIS-DEMO resolved evidence counters use Russian singular, paucal and plural forms", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidateForResolvedEvidenceCounts(), ...noops });
  const detail = findByClass(tree, "candidate-assessment-region")[0];
  for (const [criterion, label, factCount] of [
    ["Критерий с одним фактом", "1 доказательство", 1],
    ["Критерий с двумя фактами", "2 доказательства", 2],
    ["Критерий с пятью фактами", "5 доказательств", 5],
  ]) {
    const row = findByClass(detail, "criterion-detail-item").find((item) => textContent(item).includes(criterion));
    assert.ok(row, `${criterion} is rendered`);
    assert.match(textContent(row), new RegExp(label), `${factCount} uses the correct Russian evidence form`);
    assert.equal(findByClass(row, "criterion-fact").length, factCount, `${label} equals the rendered fact count`);
  }
});

test("VIS-DEMO detailed assessment separates ABC and additional criteria without the legacy evidence heading", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidateForDetailedCriteria(), ...noops });
  const detail = findByClass(tree, "candidate-assessment-region")[0];
  const headings = findAll(detail, (node) => /^h[2-4]$/.test(String(node.type))).map((node) => textContent(node).trim());
  assert.ok(headings.includes("ABC-критерии"));
  assert.ok(headings.includes("Дополнительные критерии"));
  assert.ok(!headings.includes("Дополнительные доказательства"));
});

test("VIS-DEMO materials eyebrow is exactly Google Drive and cannot wrap", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidate(), ...noops });
  const materials = findByClass(tree, "candidate-materials-region")[0];
  const eyebrow = findAll(materials, (node) => node.type === "p" && hasClass(node, "eyebrow"))[0];
  assert.equal(textContent(eyebrow).trim(), "Google Drive");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(cssRule(css, ".candidate-materials-region .eyebrow"), /white-space\s*:\s*nowrap/);
});

test("VIS-DEMO result materials use separate aligned header and action rows", async (t) => {
  const tree = await renderComponent(t, "MaterialsPanel", { candidate: readyCandidate(), onPreview() {} });
  const result = findByClass(tree, "result-materials")[0];
  assert.ok(result, "published result pair has a dedicated materials block");
  const header = findByClass(result, "result-materials-header");
  const actions = findByClass(result, "result-materials-actions");
  assert.equal(header.length, 1, "title and version have their own header row");
  assert.match(textContent(header[0]), /^РезультатыАктуальная версия v0007$/);
  assert.equal(actions.length, 1, "document controls have their own action row");
  const labels = findAll(actions[0], (node) => node.type === "button").map((button) => textContent(button).trim());
  assert.deepEqual(labels, ["Итоги", "ABC-тест"]);
});

test("VIS-DEMO result materials alignment is isolated from generic compact material grid", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.materials-compact\s*>\s*div:not\(\.panel-head\):not\(\.result-materials\)\s*\{/, "generic compact item grid explicitly excludes the result block");
  const resultRule = cssRule(css, ".result-materials");
  assert.match(resultRule, /display\s*:\s*(?:grid|flex|block)/, "result materials defines its own layout context");
  assert.doesNotMatch(resultRule, /grid-template-columns\s*:\s*27px\s+1fr\s+auto\s+18px/, "generic material columns never shift result content");
  const headerRule = cssRule(css, ".result-materials-header");
  assert.match(headerRule, /display\s*:\s*(?:flex|grid)/);
  assert.match(headerRule, /align-items\s*:\s*(?:center|baseline)/, "result title and version align as one row");
  const actionsRule = cssRule(css, ".result-materials-actions");
  assert.match(actionsRule, /display\s*:\s*(?:flex|grid)/);
  assert.match(actionsRule, /align-items\s*:\s*center/, "result buttons align independently of the header");
  assert.match(actionsRule, /gap\s*:/, "result actions keep an explicit visual gap");
});

test("VIS-DEMO projectAssessment maps storage KE criterion/conclusion into the READY overview", async (t) => {
  const runtime = await loadPostgresAssessmentProjectionHarness();
  t.after(() => runtime.cleanup());
  const projection = runtime.project(storageAssessmentWithKeCriteria(), { facts: [] });
  assert.ok(projection, "structured assessment produces an overview");
  assert.equal(projection.accessToKe.length, 8, "all eight storage KE criteria survive projection");
  for (let index = 0; index < 8; index += 1) {
    assert.equal(projection.accessToKe[index].name, `Критерий допуска ${index + 1}`);
    assert.equal(projection.accessToKe[index].reason, `Вывод по критерию ${index + 1}`);
    assert.equal(projection.accessToKe[index].state, index < 6 ? "Подтверждено" : "Требует уточнения");
    assert.deepEqual(projection.accessToKe[index].factIds, [`ke-fact-${index + 1}`]);
  }
  const value = readyCandidate();
  value.result.aiOverview.accessToKe = projection.accessToKe;
  const populated = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  const populatedKe = findByClass(populated, "candidate-ke-region")[0];
  assert.match(textContent(populatedKe), /Критерий допуска 1/);
  assert.match(textContent(populatedKe), /Вывод по критерию 8/);
  assert.doesNotMatch(textContent(populatedKe), /Условия КЕ не заданы/);
});

test("VIS-DEMO projectAssessment builds the decision summary from stored name/description observations", async (t) => {
  const runtime = await loadPostgresAssessmentProjectionHarness();
  t.after(() => runtime.cleanup());
  const snapshot = {
    recommendation: "Рекомендовать с оговорками",
    structuredAssessment: {
      schemaVersion: "assessment/v1",
      observations: [
        { name: "Релевантный опыт", description: "Подтверждён многолетний опыт поддержки собственников.", state: "Подтверждено", factIds: ["fact-1"] },
        { name: "Автономность", description: "Есть конкретные примеры самостоятельного доведения задач до результата.", state: "Подтверждено", factIds: ["fact-2"] },
      ],
      risks: [{ name: "Мотивация", description: "Нужно уточнить готовность к бизнес-задачам.", state: "Требует проверки", factIds: ["fact-3"] }],
      stopFactors: [], competencies: [], accessToKe: [], abcStates: {}, abcEvidence: {},
    },
  };
  const projection = runtime.project(snapshot, { facts: [] });
  assert.match(projection.summary, /Подтверждён многолетний опыт поддержки собственников/);
  assert.match(projection.summary, /самостоятельного доведения задач до результата/);
  assert.match(projection.summary, /уточнить готовность к бизнес-задачам/);
  assert.doesNotMatch(projection.summary, /Предметная выжимка отсутствует/);
});

test("VIS-DEMO KE region keeps a subject-specific empty state", async (t) => {
  const emptyValue = readyCandidate();
  emptyValue.result.aiOverview.accessToKe = [];
  const empty = await renderComponent(t, "CandidateDetail", { candidate: emptyValue, ...noops });
  const emptyKe = findByClass(empty, "candidate-ke-region")[0];
  assert.match(textContent(emptyKe), /Условия КЕ не заданы в профиле вакансии\./);
  assert.doesNotMatch(textContent(emptyKe), /\b(?:null|undefined)\b|Не выявлено/);
});

test("VIS-DEMO KE not-confirmed and clarification states never receive a success check", async (t) => {
  const value = readyCandidate();
  value.result.aiOverview.accessToKe = [
    { name: "Подтверждённый пункт", state: "Подтверждено", reason: "Есть основание", factIds: [] },
    { name: "Частичный пункт", state: "Частично подтверждено", reason: "Есть часть основания", factIds: [] },
    { name: "Неподтверждённый пункт", state: "Не подтверждено", reason: "Основания недостаточны", factIds: [] },
    { name: "Пункт для уточнения", state: "Требует уточнения", reason: "Нужен ответ HR", factIds: [] },
  ];
  const tree = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  const ke = findByClass(tree, "candidate-ke-region")[0];
  assert.equal(textContent(findAll(keStateRow(ke, "Неподтверждённый пункт"), (node) => node.type === "span")[0]).trim(), "×", "Не подтверждено uses a negative icon, not the substring-based success check");
  assert.equal(textContent(findAll(keStateRow(ke, "Пункт для уточнения"), (node) => node.type === "span")[0]).trim(), "?", "Требует уточнения uses a clarification icon");
});

test("VIS-DEMO KE states expose distinct semantic classes and tokenized colors", async (t) => {
  const value = readyCandidate();
  value.result.aiOverview.accessToKe = [
    { name: "Подтверждённый пункт", state: "Подтверждено", factIds: [] },
    { name: "Частичный пункт", state: "Частично подтверждено", factIds: [] },
    { name: "Неподтверждённый пункт", state: "Не подтверждено", factIds: [] },
    { name: "Пункт для уточнения", state: "Требует уточнения", factIds: [] },
  ];
  const tree = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  const ke = findByClass(tree, "candidate-ke-region")[0];
  for (const [criterion, className, icon] of [
    ["Подтверждённый пункт", "ke-state-confirmed", "✓"],
    ["Частичный пункт", "ke-state-partial", "◐"],
    ["Неподтверждённый пункт", "ke-state-not-confirmed", "×"],
    ["Пункт для уточнения", "ke-state-needs-clarification", "?"],
  ]) {
    const row = keStateRow(ke, criterion);
    assert.ok(hasClass(row, className), `${criterion} exposes ${className}`);
    assert.equal(textContent(findAll(row, (node) => node.type === "span")[0]).trim(), icon);
  }
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(cssRule(css, ".ke-state-confirmed>span"), /var\(--success-soft\).*var\(--success-ink\)/);
  assert.match(cssRule(css, ".ke-state-partial>span"), /var\(--warning-soft\).*var\(--warning-ink\)/);
  assert.match(cssRule(css, ".ke-state-not-confirmed>span"), /var\(--risk-soft\).*var\(--risk-ink\)/);
  assert.match(cssRule(css, ".ke-state-needs-clarification>span"), /var\(--blue-soft\).*var\(--blue\)/);
});

test("VIS-DEMO KE rows keep at least a 10px horizontal gap after the icon column", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = cssRule(css, ".ke-access-content>div>p");
  assert.notEqual(rule, "", "KE row grid rule exists");
  const gap = rule.match(/(?:column-gap|gap)\s*:\s*(\d+(?:\.\d+)?)px/i);
  assert.ok(gap, "KE row declares an explicit horizontal gap");
  assert.ok(Number(gap[1]) >= 10, `KE icon-to-title gap is at least 10px, received ${gap[1]}px`);
});

test("VIS-DEMO B badges remain warning-yellow in light and dark without legacy risk overrides", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /:root\s*\{[^}]*--warning-soft\s*:[^;}]+;[^}]*--warning-ink\s*:/s);
  assert.match(css, /html\[data-theme=["']dark["']\]\s*\{[^}]*--warning-soft\s*:[^;}]+;[^}]*--warning-ink\s*:/s);
  assert.match(cssRule(css, ".assessment-grade.grade-b"), /background\s*:\s*var\(--warning-soft\).*color\s*:\s*var\(--warning-ink\)/s);
  const conflictingDarkRules = [...css.matchAll(/([^{}]*html\[data-theme=["']dark["'][^{}]*\.grade-b[^{}]*)\{([^}]*)\}/g)]
    .filter(([, selectors]) => !selectors.includes(".abc-grade-grid"))
    .map(([, selectors, declarations]) => `${selectors}{${declarations}}`)
    .join("\n");
  assert.doesNotMatch(conflictingDarkRules, /var\(--risk-(?:soft|ink)\)|#[0-9a-f]{3,8}\b|rgba?\(/i, "no legacy dark selector can turn assessment B brown/red/risk");
});

test("VIS-DEMO B badge uses a translucent amber warning surface in light and dark", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const light = cssRule(css, ":root");
  const dark = cssRule(css, 'html[data-theme="dark"]');
  for (const [theme, rule] of [["light", light], ["dark", dark]]) {
    const soft = cssVariable(rule, "--warning-soft");
    const ink = cssVariable(rule, "--warning-ink");
    assert.ok(isTranslucentWarningSurface(soft), `${theme} --warning-soft is translucent amber/yellow, received ${soft || "missing"}`);
    assert.notEqual(ink, "", `${theme} --warning-ink exists`);
    assert.notEqual(ink, cssVariable(rule, "--risk-ink"), `${theme} warning ink is distinct from risk/red ink`);
  }
  assert.match(cssRule(css, ".assessment-grade.grade-b"), /background\s*:\s*var\(--warning-soft\).*color\s*:\s*var\(--warning-ink\)/s);
  const gradeBRules = [...css.matchAll(/([^{}]*\.assessment-grade\.grade-b[^{}]*)\{([^}]*)\}/g)].map(([, selectors, declarations]) => `${selectors}{${declarations}}`).join("\n");
  assert.doesNotMatch(gradeBRules, /var\(--risk-(?:soft|ink)\)|(?:red|brown)|#[0-9a-f]{3,8}\b/i);
});

test("VIS-DEMO grouped neutral assessment badge uses blue theme tokens in light and dark", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const scopedRule = cssRule(css, ".assessment-grade.grade-neutral");
  assert.match(scopedRule, /background\s*:\s*var\(--blue-soft\).*color\s*:\s*var\(--blue\)/s, "neutral grouped badge is explicitly scoped to blue tokens");
  const conflictingDarkRules = [...css.matchAll(/([^{}]*html\[data-theme=["']dark["'][^{}]*\.grade-neutral[^{}]*)\{([^}]*)\}/g)]
    .map(([, selectors, declarations]) => `${selectors}{${declarations}}`)
    .join("\n");
  assert.doesNotMatch(conflictingDarkRules, /(?:background|color)\s*:\s*(?:white|#(?:fff|ffffff)\b|rgba?\()/i, "dark theme cannot replace the neutral blue badge with white/hardcoded color");
});

test("VIS-DEMO ready hero omits the ABC index and AI outcome", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidate({ progressPercent: 63, confidencePercent: 99 }), ...noops });
  const hero = findByClass(tree, "candidate-hero")[0];
  assert.doesNotMatch(textContent(hero), /(?:\d{1,2}|100)\s*%|Итог AI|Расч[её]тный индекс ABC/i);
  assert.equal(findAll(hero, (node) => node.props?.role === "meter").length, 0);
});

test("VIS-DEMO matching aside shows the same approved ABC-derived percent", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidate({ progressPercent: 63, confidencePercent: 99 }), ...noops });
  const matching = findByClass(tree, "candidate-matching-region")[0];
  assert.match(textContent(matching), /85\s*%/);
  assert.equal(findAll(matching, (node) => node.props?.["aria-valuenow"] === 85).length, 1);
  assert.doesNotMatch(textContent(matching), /63\s*%|99\s*%/);
});

test("VIS-DEMO matching aside omits match percent for invalid ABC while ready hero stays score-free", async (t) => {
  const value = readyCandidate();
  value.result.aiOverview.abc = [{ direction: "Продуктивность", grade: "X", reason: "Неизвестная категория", factIds: [] }];
  const tree = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  const hero = findByClass(tree, "candidate-hero")[0];
  assert.doesNotMatch(textContent(hero), /(?:\d{1,2}|100)\s*%|Итог AI|Расч[её]тный индекс ABC/i);
  for (const region of [findByClass(tree, "candidate-matching-region")[0]]) {
    assert.doesNotMatch(textContent(region), /(?:\d{1,2}|100)\s*%/);
    assert.match(textContent(region), /Оценка ещё не готова/i);
  }
});

test("VIS-DEMO KE access is a separate semantic region, not part of the match score card", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidate(), ...noops });
  const ke = findByClass(tree, "candidate-ke-region");
  assert.equal(ke.length, 1);
  assert.equal(ke[0].type, "section");
  const scoreCard = findByClass(tree, "assessment-score-card")[0];
  assert.equal(findAll(scoreCard, (node) => node === ke[0]).length, 0, "KE region is sibling content, not nested inside the score card");
});

test("VIS-DEMO materials panel never invents fallback files", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidate({ materials: [] }), ...noops });
  const materials = findByClass(tree, "candidate-materials-region")[0];
  assert.ok(materials);
  assert.doesNotMatch(textContent(materials), /Резюме Мария Орлова\.pdf|Интервью\.mp4|Заметки рекрутера\.docx/);
  assert.match(textContent(materials), /Материалы не найдены|Нет доступных материалов|Материалы отсутствуют/i);
});

test("VIS-DEMO decision summary and recommendation basis remain candidate-specific", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidate(), ...noops });
  const decision = findByClass(tree, "candidate-decision-region")[0];
  assert.match(textContent(decision), /Сильный продуктовый опыт с проверяемым личным вкладом/);
  assert.match(textContent(decision), /Подтверждены результаты и личный вклад/);
  assert.doesNotMatch(textContent(decision), /отч[её]т(?:ы)? (?:успешно )?(?:готов|сформирован|опубликован)|анализ заверш[её]н|результат готов|кандидат соответствует требованиям\.?$/i);

  const boilerplate = readyCandidate();
  boilerplate.result.summary = "Отчёты успешно опубликованы";
  boilerplate.result.aiOverview.recommendationBasis = "Кандидат соответствует требованиям";
  const rejected = await renderComponent(t, "CandidateDetail", { candidate: boilerplate, ...noops });
  assert.doesNotMatch(textContent(findByClass(rejected, "candidate-decision-region")[0]), /Отчёты успешно опубликованы|Кандидат соответствует требованиям/);
});

test("VIS-DEMO every evidence item is criterion-bound and has a contextual label", async (t) => {
  const value = readyCandidate();
  value.result.aiOverview.abc[1].factIds.push("ev-3");
  value.result.aiOverview.evidence.push({
    id: "ev-3",
    technicalType: "unregistered_pipeline_fact_kind",
    label: "unregistered_pipeline_fact_kind",
    claim: "Проверила гипотезу до постановки руководителя.",
    source: "Интервью Мария Орлова.mp4",
    timecode: "00:18:05",
    criterion: "Инициатива",
  });
  const tree = await renderComponent(t, "CandidateDetail", { candidate: value, ...noops });
  assert.equal(findByClass(tree, "unmatched-fact").length, 0, "evidence is not rendered in an ambiguous global bucket");
  const initiative = findAll(tree, (node) => hasClass(node, "criterion-detail-row") && textContent(node).includes("Инициатива"))[0];
  assert.match(textContent(initiative), /Проверила гипотезу до постановки руководителя/);
  assert.equal(findAll(initiative, (node) => textContent(node).trim() === "Доказательство").length, 0, "unknown technical types use criterion context instead of a global label");
});

test("VIS-DEMO ready detail hides schema keys and never duplicates evidence locators", async (t) => {
  const tree = await renderComponent(t, "CandidateDetail", { candidate: readyCandidate(), ...noops });
  const text = textContent(tree);
  for (const key of RAW_KEYS) assert.doesNotMatch(text, new RegExp(key));
  for (const [label, locator] of [["страница 2", /(?:страница|стр\.)\s*2/gi], ["00:12:40", /00:12:40/g]]) {
    assert.equal((text.match(locator) ?? []).length, 1, `${label} is shown once, in the evidence region`);
  }
  assert.doesNotMatch(text, /\b(?:null|undefined)\b/);
});

test("VIS-DEMO component surfaces use theme variables instead of light/dark hardcoded palettes", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const token of ["--success-soft", "--success-ink", "--risk-soft", "--risk-ink", "--score-track"]) {
    assert.match(css, new RegExp(`${token.replace("--", "--")}\\s*:`), `${token} is declared by the theme contract`);
  }
  for (const selector of [".ai-recommendation-callout", ".is-strength header>span", ".is-risk header>span", ".grade-bar", ".score-ring-a"]) {
    const rule = cssRule(css, selector);
    assert.notEqual(rule, "", `${selector} rule exists`);
    assert.doesNotMatch(rule, /(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/i, `${selector} uses theme variables/color-mix only`);
  }
  const demoDarkSelectors = [
    ".ai-recommendation-callout",
    ".is-strength",
    ".is-risk",
    ".grade-bar",
    ".score-ring",
    ".ranking-row",
    ".ranking-search",
    ".vacancy-score-indicator",
    ".processing-timeline",
    ".processing-metrics",
    ".processing-materials",
  ];
  const scopedDarkRules = [...css.matchAll(/([^{}]*html\[data-theme=["']dark["'][^{}]*)\{([^}]*)\}/g)]
    .filter(([, selectors]) => demoDarkSelectors.some((selector) => selectors.includes(selector)))
    .map(([, selectors, declarations]) => `${selectors}{${declarations}}`)
    .join("\n");
  assert.doesNotMatch(
    scopedDarkRules,
    /(?:background(?:-color)?|color|border-color)\s*:\s*(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/i,
    "dark overrides for demo components use theme tokens instead of a second hardcoded palette",
  );
});
