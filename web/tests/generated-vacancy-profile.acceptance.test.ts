import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CANONICAL_ABC_DIRECTIONS, validateGeneratedVacancyProfile } from "../server/product/vacancy-generation.ts";
import { findAll, findButton, loadProductUiHarness } from "./helpers/product-acceptance-harness.mjs";

const CANONICAL_ABC = [
  "Продуктивность",
  "Инициатива",
  "Самообучаемость",
  "Корпоративные ценности",
  "Автономность",
] as const;

function canonicalDirections() {
  return CANONICAL_ABC.map((name, index) => ({
    id: `canonical-${index + 1}`,
    name,
    gradeA: `${name}: наблюдаемое поведение уровня A`,
    gradeB: `${name}: наблюдаемое поведение уровня B`,
    gradeC: `${name}: наблюдаемое поведение уровня C`,
    origin: "standard",
  }));
}

function generatedResponse(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "vacancy-profile/v1",
    templateVersion: "canonical-readable-v1",
    profile: {
      "Образ результата": "Цель и измеримый результат",
      "Компетенции": "Критические навыки и наблюдаемые признаки",
      "Стоп-факторы": "Проверяемое условие и доказательство",
      "Допуск к КЕ": "Обязательная проверка, готовность и источник",
    },
    abcDirections: canonicalDirections(),
    hrDecisionMarkers: [],
    ...overrides,
  };
}

test("VAC-042: generated profile accepts exactly five canonical ABC directions in canonical order", () => {
  const accepted = validateGeneratedVacancyProfile(generatedResponse());
  assert.deepEqual(accepted.abcDirections.map(({ name }) => name), [...CANONICAL_ABC]);
  assert.equal(accepted.abcDirections.length, 5);
});

test("VAC-042: random, missing, extra, duplicate and reordered ABC sets are rejected", () => {
  const cases = [
    { label: "random names", directions: canonicalDirections().map((item, index) => ({ ...item, name: `Случайное направление ${index + 1}` })) },
    { label: "missing direction", directions: canonicalDirections().slice(0, 4) },
    { label: "extra direction", directions: [...canonicalDirections(), { ...canonicalDirections()[0], id: "extra", name: "Лишнее направление" }] },
    { label: "duplicate direction", directions: canonicalDirections().map((item, index, all) => index === 4 ? { ...item, name: all[0].name } : item) },
    { label: "reordered directions", directions: [canonicalDirections()[1], canonicalDirections()[0], ...canonicalDirections().slice(2)] },
  ];

  for (const item of cases) {
    assert.throws(
      () => validateGeneratedVacancyProfile(generatedResponse({ abcDirections: item.directions })),
      /invalid structured response/i,
      `${item.label} must be rejected before an editor or persisted profile is created`,
    );
  }
});

test("VAC-042/VAC-043 regression: actual RouterAI field names and canonical question suffixes are normalized", () => {
  const routerAiProfile = {
    resultImage: {
      goal: "Выстроить управляемый операционный контур",
      expectedResults: ["Сократить срок цикла", "Снизить число ошибок"],
      measurability: "Не более двух рабочих дней",
      scale: "Три подразделения",
    },
    competencies: [
      { name: "Управление изменениями", observableSigns: ["Фиксирует baseline", "Проверяет эффект"] },
      { name: "Работа с данными", observableSigns: ["Объясняет выбор метрик"] },
    ],
    stopFactors: [
      { condition: "Скрывает критические ошибки", evidenceType: "Противоречащие факты интервью" },
    ],
    keAdmission: [
      { check: "Подтверждён обязательный опыт", readinessSign: "Приведён измеримый кейс", required: true, resultSource: "Резюме и интервью" },
    ],
  };
  const routerAiDirections = CANONICAL_ABC_DIRECTIONS.map((canonical, index) => ({
    id: `router-${index + 1}`,
    name: `${canonical.name}: ${canonical.question}`,
    gradeA: `${canonical.name}: уровень A подтверждён наблюдаемыми фактами`,
    gradeB: `${canonical.name}: уровень B подтверждён частично`,
    gradeC: `${canonical.name}: уровень C не подтверждён`,
    origin: "standard",
  }));

  const accepted = validateGeneratedVacancyProfile(generatedResponse({
    profile: routerAiProfile,
    abcDirections: routerAiDirections,
  }));

  assert.deepEqual(Object.keys(accepted.profile), ["Образ результата", "Компетенции", "Стоп-факторы", "Допуск к КЕ"]);
  assert.equal("resultImage" in accepted.profile, false);
  assert.equal("competencies" in accepted.profile, false);
  assert.equal("stopFactors" in accepted.profile, false);
  assert.equal("keAdmission" in accepted.profile, false);
  assert.deepEqual(accepted.abcDirections.map(({ name }) => name), [...CANONICAL_ABC]);
  for (const [section, expectedFragment] of [
    ["Образ результата", "Выстроить управляемый операционный контур"],
    ["Компетенции", "Управление изменениями"],
    ["Стоп-факторы", "Скрывает критические ошибки"],
    ["Допуск к КЕ", "Подтверждён обязательный опыт"],
  ] as const) {
    assert.match(accepted.profile[section], new RegExp(expectedFragment));
    assert.match(accepted.profile[section], /\n/, `${section} remains readable multiline text after RouterAI key mapping`);
  }

  assert.throws(
    () => validateGeneratedVacancyProfile(generatedResponse({
      profile: routerAiProfile,
      abcDirections: routerAiDirections.map((direction, index) => ({ ...direction, name: `Случайное направление ${index + 1}: вопрос` })),
    })),
    /invalid structured response/i,
    "RouterAI key mapping must not weaken rejection of random ABC names",
  );
});

test("VAC-044: actual RouterAI resultImage uses deterministic Russian layout grammar", () => {
  const resultImage = {
    positionGoal: "  Обеспечить    управляемый   рост  ",
    measurableResults: [
      {
        result: "  Сократить   срок   цикла  ",
        metrics: ["  Срок   не более   двух дней  ", "  Ошибки   менее   одного процента  "],
      },
      {
        result: "  Увеличить    операционный охват  ",
        metrics: ["  Три    подразделения  "],
      },
    ],
    personalContribution: {
      result: "  Лично   внедряет   изменения  ",
      metrics: ["  План    перехода   выполнен  "],
    },
  };
  const accepted = validateGeneratedVacancyProfile(generatedResponse({
    profile: {
      resultImage,
      competencies: ["Управление изменениями", "Работа с данными"],
      stopFactors: ["Скрывает критические ошибки"],
      keAdmission: ["Подтверждён обязательный опыт"],
    },
  }));
  const text = accepted.profile["Образ результата"];
  const expected = [
    "Цель должности: Обеспечить управляемый рост",
    "",
    "Измеримые результаты:",
    "  • Результат: Сократить срок цикла",
    "    Метрики:",
    "      • Срок не более двух дней",
    "      • Ошибки менее одного процента",
    "  • Результат: Увеличить операционный охват",
    "    Метрики:",
    "      • Три подразделения",
    "",
    "Личный вклад:",
    "  Результат: Лично внедряет изменения",
    "  Метрики:",
    "    • План перехода выполнен",
  ].join("\n");

  assert.equal(text, expected, "resultImage is formatted by one deterministic Russian layout grammar");
  assert.doesNotMatch(text, /positionGoal|measurableResults|personalContribution|\bresult\b|\bmetrics\b/, "raw RouterAI camelCase keys never reach the editor text");
  assert.doesNotMatch(text, /[^\n ] {2,}[^\n ]/, "scalar values do not retain repeated spaces");
  assert.doesNotMatch(text, /\n{3,}/, "top-level blocks have exactly one empty line between them");
  assert.equal((text.match(/\n\n/g) ?? []).length, 2, "three top-level blocks have exactly two single blank separators");
  assert.deepEqual(
    text.split("\n").filter((line) => line.includes("•")).map((line) => line.match(/^\s*/)?.[0].length),
    [2, 6, 6, 2, 6, 4],
    "array bullets and nested metric bullets use stable indentation",
  );
});

test("VAC-043: arrays and nested objects become deterministic readable multiline text", () => {
  const structuredProfile = {
    "Образ результата": {
      "Цель": "Стабилизировать операционный контур",
      "Ожидаемые результаты": ["Срок цикла сокращён", "Ошибки измеримо снижены"],
      "Измеримость": { "Метрика": "Не более двух дней", "Масштаб": "Три подразделения" },
    },
    "Компетенции": [
      { "Навык": "Управление изменениями", "Наблюдаемые признаки": ["Фиксирует baseline", "Проверяет эффект"] },
      { "Навык": "Работа с данными", "Наблюдаемые признаки": "Объясняет выбор метрик" },
    ],
    "Стоп-факторы": [
      { "Условие": "Скрывает критические ошибки", "Доказательство": "Противоречащие факты интервью" },
      { "Условие": "Не принимает обратную связь", "Доказательство": "Повторяемый наблюдаемый пример" },
    ],
    "Допуск к КЕ": {
      "Проверка": "Подтверждён обязательный опыт",
      "Признак готовности": "Приведён измеримый кейс",
      "Обязательность": true,
      "Источник результата": "Резюме и интервью",
    },
  };
  const accepted = validateGeneratedVacancyProfile(generatedResponse({ profile: structuredProfile }));

  const expectedLeaves: Record<string, string[]> = {
    "Образ результата": ["Стабилизировать операционный контур", "Срок цикла сокращён", "Ошибки измеримо снижены", "Не более двух дней", "Три подразделения"],
    "Компетенции": ["Управление изменениями", "Фиксирует baseline", "Проверяет эффект", "Работа с данными", "Объясняет выбор метрик"],
    "Стоп-факторы": ["Скрывает критические ошибки", "Противоречащие факты интервью", "Не принимает обратную связь", "Повторяемый наблюдаемый пример"],
    "Допуск к КЕ": ["Подтверждён обязательный опыт", "Приведён измеримый кейс", "true", "Резюме и интервью"],
  };

  for (const [section, leaves] of Object.entries(expectedLeaves)) {
    const text = accepted.profile[section];
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    assert.doesNotMatch(text, /; /, `${section} must not be flattened with semicolon separators`);
    assert.ok(lines.length >= leaves.length, `${section} must expose semantic items on separate lines; actual=${JSON.stringify(text)}`);
    let previousPosition = -1;
    for (const leaf of leaves) {
      const lineIndex = lines.findIndex((line) => line.includes(leaf));
      assert.ok(lineIndex >= 0, `${section} preserves nested value ${JSON.stringify(leaf)}; actual=${JSON.stringify(text)}`);
      assert.ok(lineIndex > previousPosition, `${section} preserves source order for ${JSON.stringify(leaf)}; actual=${JSON.stringify(text)}`);
      previousPosition = lineIndex;
    }
  }
});

test("VAC-043: vacancy settings editor preserves newlines and wraps long generated content", async (t) => {
  const runtime = await loadProductUiHarness();
  t.after(() => runtime.cleanup());
  const multiline = ["Цель: Стабилизировать операционный контур", "Результат: Срок цикла сокращён", "Масштаб: Три подразделения"].join("\n");
  const vacancy = {
    id: "vac-readable-1", title: "Синтетическая вакансия", short: "Синтетическая вакансия", avatar: "СВ",
    color: "#58dfc4", status: "Активна", version: 1, driveFolderId: "folder-synthetic",
    profile: {
      "Образ результата": multiline,
      "Компетенции": "Навык: Управление изменениями\nПризнак: Проверяет эффект",
      "Стоп-факторы": "Условие: Скрывает ошибки\nДоказательство: Противоречащие факты",
      "Допуск к КЕ": "Проверка: Обязательный опыт\nИсточник: Резюме и интервью",
    },
    abcDirections: canonicalDirections(),
  };
  const view = runtime.create("VacancySettings", { vacancy, onNotify() {} });
  let tree = view.render();
  let textarea = findAll(tree, (node) => node.type === "textarea")[0];
  assert.equal(textarea.props.value, multiline, "generated line breaks remain present in the editor value");
  assert.equal(textarea.props.wrap, "soft", "the profile editor explicitly wraps long lines");

  const edited = `${multiline}\nИзмеримость: не более двух дней`;
  textarea.props.onChange({ target: { value: edited } });
  tree = view.render();
  textarea = findAll(tree, (node) => node.type === "textarea")[0];
  assert.equal(textarea.props.value, edited, "HR edits preserve all generated and newly added line breaks");

  for (const section of ["Компетенции", "Стоп-факторы", "Допуск к КЕ"]) {
    findButton(tree, section).props.onClick();
    tree = view.render();
    textarea = findAll(tree, (node) => node.type === "textarea")[0];
    assert.match(textarea.props.value, /\n/, `${section} remains a multiline editor value`);
    assert.equal(textarea.props.wrap, "soft", `${section} uses explicit soft wrapping`);
  }

  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const settingsTextareaRule = css.match(/\.settings-field textarea\{([^}]*)\}/)?.[1] ?? "";
  assert.match(settingsTextareaRule, /white-space\s*:\s*pre-wrap/, "profile editor CSS preserves newline rendering");
  assert.match(settingsTextareaRule, /overflow-wrap\s*:\s*(?:anywhere|break-word)/, "profile editor CSS wraps long unbroken content");
});
