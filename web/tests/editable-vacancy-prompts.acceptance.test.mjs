import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { cases } from "./fixtures/editable-vacancy-prompts/synthetic-conformance.mjs";
import { runEditableVacancyPromptsScenario, verifyEditableVacancyPromptsOracle } from "./helpers/editable-vacancy-prompts-conformance-harness.mjs";
import { loadVacanciesHarness, loadVacancySettingsHarness } from "./helpers/react-component-harness.mjs";
import {
  CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT,
  composeProtectedAssessmentInstruction,
  createEditablePromptSnapshot,
  standardEditablePrompt,
} from "../server/product/prompt-contracts.ts";

for (const item of cases) {
  test(`${item.requirements.join("/")}: ${item.title}`, async () => {
    const actual = await runEditableVacancyPromptsScenario(item.fixture);
    const mismatches = verifyEditableVacancyPromptsOracle(actual, item.oracle);
    assert.equal(mismatches.length, 0, mismatches.join("\n"));
  });
}

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node !== "object") return;
  visit(node);
  walk(node.props?.children, visit);
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return textContent(node.props?.children);
}

function findAll(tree, predicate) {
  const matches = [];
  walk(tree, (node) => { if (predicate(node)) matches.push(node); });
  return matches;
}

function visibleButtonLabel(node) {
  return textContent(node).trim().replace(/›$/, "").trim();
}

test("VAC-041/TST-086: user clarification real VacancySettings renders exact analysis-prompt copy", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());
  const defaultPrompt = standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
  const component = runtime.create({
    vacancy: {
      id: "vacancy-real-ui-prompt-001", title: "Синтетическая вакансия", short: "СВ", avatar: "СВ",
      candidates: 0, ready: 0, progress: 0, color: "#000000", status: "Черновик", version: 3,
      templateVersion: "vacancy-profile/v1", profile: {}, abcDirections: [], analysisPrompt: defaultPrompt,
    },
    onNotify() {},
  });

  let tree = component.render();
  const navigationLabels = findAll(tree, (node) => node.type === "aside")[0].props.children.map(visibleButtonLabel);
  assert.equal(navigationLabels.filter((label) => label === "Промпт для анализа").length, 1, "navigation contains the exact new label once");
  assert.equal(navigationLabels.includes("Промпт анализа"), false, "legacy navigation label is absent");

  const promptButton = findAll(tree, (node) => node.type === "button").find((node) => visibleButtonLabel(node) === "Промпт для анализа");
  assert.ok(promptButton, "real VacancySettings exposes the analysis-prompt section");
  promptButton.props.onClick();
  tree = component.render();

  const section = findAll(tree, (node) => node.type === "section")[0];
  assert.equal(textContent(findAll(section, (node) => node.type === "h3")[0]), "Промпт для анализа");
  assert.equal(findAll(section, (node) => node.type === "label").some((node) => textContent(node.props.children?.[0]) === "Промпт для анализа"), true);
  const visibleSectionText = textContent(section);
  assert.equal(visibleSectionText.includes("Инструкция анализа кандидатов"), false);
  assert.equal(visibleSectionText.includes("Промпт сохраняется в новой версии вакансии и применяется только к новым запускам. Выполняющиеся и завершённые анализы не изменяются."), false);
  assert.equal(visibleSectionText.includes("Промпт анализа"), false, "legacy label is absent from the opened section");
});

test("ASM-062/TST-086: user clarification real prompt contracts and production boundary route the pinned prompt only to assessment", async () => {
  const defaultPrompt = standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
  const requiredHeadings = ["Цель анализа", "Порядок анализа", "Требования к доказательствам", "Формат результата"];
  const cyrillic = defaultPrompt.text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
  const latin = defaultPrompt.text.match(/[A-Za-z]/g)?.length ?? 0;
  assert.ok(cyrillic > latin, "real candidate-assessment/v1 default is Russian");
  for (const heading of requiredHeadings) assert.match(defaultPrompt.text, new RegExp(`^## ${heading}$`, "m"));
  assert.match(defaultPrompt.text, /^\s*-\s+\S+/m, "real default contains a readable bullet list");
  assert.match(defaultPrompt.text, /Назначай A, B или C только по известным фактам; если данных критически не хватает, например нет транскрибации, используй «Недостаточно данных»\./);
  assert.match(defaultPrompt.text, /Если для ABC-направления передан хотя бы один допустимый factId, назначь A, B или C\./);
  assert.match(defaultPrompt.text, /Используй CONFLICT только при наличии минимум двух связанных допустимых фактов, которые входят в переданное неразрешённое противоречие\./);
  assert.doesNotMatch(defaultPrompt.text, /Назначай A, B или C только при наличии допустимого факта/);

  const uniquePrompt = "Уникальная инструкция вакансии: учитывай только подтверждённый личный вклад.";
  const snapshot = createEditablePromptSnapshot(uniquePrompt, CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
  const composed = composeProtectedAssessmentInstruction(snapshot);
  assert.equal(composed.split(snapshot.text).length - 1, 1, "real composition contains the exact pinned prompt once");
  assert.ok(composed.indexOf("[immutable-server-envelope]") < composed.indexOf("[untrusted-business-instruction]"));
  assert.ok(composed.indexOf("[untrusted-business-instruction]") < composed.indexOf("[structured-candidate-input]"));

  const productionRuntimePath = path.resolve(import.meta.dirname, "../server/candidate-pipeline/production-runtime.ts");
  const productionSource = await readFile(productionRuntimePath, "utf8");
  const assessmentStart = productionSource.indexOf('if (capability === "assessment")');
  const assessmentEnd = productionSource.indexOf("if (capability ===", assessmentStart + 1);
  const assessmentBoundary = productionSource.slice(assessmentStart, assessmentEnd < 0 ? undefined : assessmentEnd);
  assert.ok(assessmentStart >= 0, "production assessment capability boundary is present");
  assert.match(assessmentBoundary, /SELECT analysis_prompt_text,analysis_prompt_artifact_id,analysis_prompt_hash FROM agent_runs WHERE id=\$1/);
  assert.match(assessmentBoundary, /composeProtectedAssessmentInstruction\(promptSnapshot\)/);
  assert.match(assessmentBoundary, /capability:\s*"assessment"/);
  assert.equal((productionSource.match(/composeProtectedAssessmentInstruction\(promptSnapshot\)/g) ?? []).length, 1, "vacancy prompt composition has one production call site");

  const preAssessmentPipeline = productionSource.slice(0, assessmentStart);
  assert.equal(preAssessmentPipeline.includes("analysis_prompt_text"), false, "document, transcription and fact stages do not read the analysis prompt");
});

test("VacancySettings analysis-prompt section does not expose the result schema", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());
  const defaultPrompt = standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
  const component = runtime.create({
    vacancy: {
      id: "vacancy-result-schema-disclosure-001", title: "Синтетическая вакансия", short: "СВ", avatar: "СВ",
      candidates: 0, ready: 0, progress: 0, color: "#000000", status: "Черновик", version: 3,
      templateVersion: "vacancy-profile/v1", profile: {}, abcDirections: [], analysisPrompt: defaultPrompt,
    },
    onNotify() {},
  });

  let tree = component.render();
  const promptButton = findAll(tree, (node) => node.type === "button").find((node) => visibleButtonLabel(node) === "Промпт для анализа");
  assert.ok(promptButton, "real VacancySettings exposes the analysis-prompt section");
  promptButton.props.onClick();
  tree = component.render();

  const section = findAll(tree, (node) => node.type === "section")[0];
  assert.equal(findAll(section, (node) => node.type === "button" && /схем.*результат/i.test(visibleButtonLabel(node))).length, 0,
    "analysis-prompt section has no result-schema button or disclosure control");
  assert.equal(findAll(section, (node) => node.props?.role === "region" && /схем.*результат/i.test(String(node.props?.["aria-label"] ?? ""))).length, 0,
    "analysis-prompt section has no result-schema region");
  assert.equal(findAll(section, (node) => node.type === "pre").length, 0,
    "analysis-prompt section has no formatted schema block");
  assert.equal(textContent(section).includes("Схема результата анализа"), false,
    "analysis-prompt section does not render the removed schema title");
});

test("vacancy version badge contract: settings heading contains only the vacancy title", async (t) => {
  const runtime = await loadVacancySettingsHarness();
  t.after(() => runtime.cleanup());
  const component = runtime.create({
    vacancy: {
      id: "vacancy-version-badge-001", title: "Синтетическая вакансия", short: "СВ", avatar: "СВ",
      candidates: 0, ready: 0, progress: 0, color: "#000000", status: "Черновик", version: 7,
      templateVersion: "vacancy-profile/v1", profile: {}, abcDirections: [],
      analysisPrompt: standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT),
    },
    onNotify() {},
  });

  const tree = component.render();
  const settingsIntro = findAll(tree, (node) => node.props?.className === "settings-intro")[0];
  assert.ok(settingsIntro, "real VacancySettings renders its heading block");
  const eyebrow = findAll(settingsIntro, (node) => node.type === "p" && node.props?.className === "eyebrow")[0];
  assert.equal(textContent(eyebrow).trim(), "Синтетическая вакансия",
    "settings heading contains only the vacancy title without an inline version");
  assert.equal(textContent(settingsIntro).includes("· версия 7"), false,
    "settings heading does not expose the old inline version text");
});

test("vacancy version badge contract: header keeps version beside activity and removes old Drive/version copy", async (t) => {
  const runtime = await loadVacanciesHarness();
  t.after(() => runtime.cleanup());
  const vacancy = {
    id: "vacancy-version-badge-001", title: "Синтетическая вакансия", short: "СВ", avatar: "СВ",
    candidates: 0, ready: 0, progress: 0, color: "#000000", status: "Черновик", version: 7,
    templateVersion: "vacancy-profile/v1", profile: {}, abcDirections: [], archived: false,
    analysisPrompt: standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT),
  };
  const tree = runtime.create({
    candidates: [], vacancyState: { vacancies: [vacancy] }, onState() {}, onOpen() {}, onNotify() {}, onCandidatesDeleted() {},
  }).render();

  const header = findAll(tree, (node) => node.type === "header" && node.props?.className === "vacancy-header")[0];
  assert.ok(header, "real vacancy header is rendered");
  await t.test("keeps activity status without exposing the vacancy version", () => {
    const activityBadge = findAll(header, (node) => node.type === "span" && /(^|\s)soft-badge(\s|$)/.test(String(node.props?.className ?? ""))
      && textContent(node).trim() === "Активна")[0];
    assert.ok(activityBadge, "activity status badge remains visible");
    assert.equal(findAll(header, (node) => /profile-version-badge/.test(String(node.props?.className ?? ""))).length, 0,
      "vacancy version badge is absent");
    assert.doesNotMatch(textContent(header), /(?:Профиль\s+)?v7|версия\s+7/i, "header exposes no vacancy version copy");
  });

  await t.test("removes the old standalone version copy", () => {
    const oldVersionCopy = findAll(header, (node) => ["p", "small"].includes(node.type)
      && /профиль\s+v7|версия\s+7/i.test(textContent(node)));
    assert.equal(oldVersionCopy.length, 0, "old standalone version copy is absent from the header");
  });

  await t.test("removes Google Drive linkage copy", () => {
    assert.equal(/папка Google Drive связана/i.test(textContent(tree)), false,
      "removed Google Drive linkage text is absent from the real vacancy view");
  });
  assert.doesNotMatch(textContent(tree), /Версия\s+7\s+связана/i, "activity copy exposes no vacancy version");
});
