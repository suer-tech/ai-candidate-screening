import assert from "node:assert/strict";
import test from "node:test";
import { UnsupportedCandidateSchemaError, normalizeCandidateCapabilityOutput } from "./schemas.ts";

test("candidate capability schemas accept current controlled outputs", () => {
  assert.equal(normalizeCandidateCapabilityOutput("ocr", { schemaVersion: "ocr-page/v1", page: 1, text: "text", confidence: 0.9, regions: [] }).schemaVersion, "ocr-page/v1");
  assert.equal(normalizeCandidateCapabilityOutput("fact_extraction", { schemaVersion: "facts/v1", facts: [], conflicts: [] }).schemaVersion, "facts/v1");
  assert.equal(normalizeCandidateCapabilityOutput("assessment", { schemaVersion: "assessment/v1", observations: [], abcStates: {}, abcEvidence: {}, competencies: [], accessToKe: [], risks: [], stopFactors: [] }).schemaVersion, "assessment/v1");
});

test("known old speaker schema migrates deterministically without inventing fields", () => {
  const migrated = normalizeCandidateCapabilityOutput("speaker_mapping", { schemaVersion: "speaker-map/v0", roles: [{ label: "A", role: "Кандидат" }] });
  assert.equal(migrated.schemaVersion, "speaker-map/v1");
  assert.deepEqual(migrated.mappings, [{ label: "A", role: "Кандидат" }]);
});

test("unknown or structurally invalid schemas fail explicitly", () => {
  assert.throws(() => normalizeCandidateCapabilityOutput("assessment", { schemaVersion: "assessment/v999" }), UnsupportedCandidateSchemaError);
  assert.throws(() => normalizeCandidateCapabilityOutput("ocr", { schemaVersion: "ocr-page/v1", page: 0, text: "", confidence: 2, regions: [] }), /INVALID_STRUCTURED_OUTPUT/);
});

test("assessment schema requires canonical fields for every rendered collection", () => {
  const canonical = {
    schemaVersion: "assessment/v1",
    observations: [{ criterion: "Опыт", category: "required-experience", required: true, state: "Подтверждено", reason: "Есть факт", factIds: ["fact-1"] }],
    abcStates: { initiative: "B" },
    abcEvidence: { initiative: { factIds: ["fact-1"], reason: "Частичное соответствие", levels: {
      A: { definition: "Уровень A", matchedConditions: [], missingConditions: ["Доведение до результата"], contradictingFactIds: [] },
      B: { definition: "Уровень B", matchedConditions: ["Предлагает решение по запросу"], missingConditions: [], contradictingFactIds: [] },
      C: { definition: "Уровень C", matchedConditions: [], missingConditions: [], contradictingFactIds: ["fact-1"] },
    } } },
    competencies: [{ name: "Коммуникация", state: "Подтверждено", reason: "Есть факт", factIds: ["fact-1"] }],
    accessToKe: [{ name: "Готовность", required: true, state: "Подтверждено", reason: "Есть факт", factIds: ["fact-1"] }],
    risks: [{ name: "Риск", state: "Частично подтверждено", reason: "Есть факт", factIds: ["fact-1"] }],
    stopFactors: [{ name: "Стоп-фактор", state: "Не подтверждено", reason: "Нет прямого подтверждения", factIds: ["fact-1"] }],
  };
  assert.equal(normalizeCandidateCapabilityOutput("assessment", canonical).schemaVersion, "assessment/v1");
  assert.throws(() => normalizeCandidateCapabilityOutput("assessment", { ...canonical, risks: [{ risk: "legacy", state: "Подтверждено", factIds: ["fact-1"] }] }), /INVALID_STRUCTURED_OUTPUT:assessment:risks/);
  assert.throws(() => normalizeCandidateCapabilityOutput("assessment", { ...canonical, accessToKe: [{ name: "Готовность", state: "Подтверждено", reason: "Есть факт", factIds: ["fact-1"] }] }), /INVALID_STRUCTURED_OUTPUT:assessment:accessToKe/);
  assert.throws(() => normalizeCandidateCapabilityOutput("assessment", { ...canonical, abcEvidence: { initiative: { factIds: ["fact-1"], reason: "Без матрицы" } } }), /INVALID_STRUCTURED_OUTPUT:assessment:abcEvidence/);
});

test("strict assessment transport arrays normalize deterministically to domain maps", () => {
  const normalized = normalizeCandidateCapabilityOutput("assessment", {
    schemaVersion: "assessment/v1", observations: [], competencies: [], accessToKe: [], risks: [], stopFactors: [],
    abcStates: [{ directionId: "productivity", state: "B" }],
    abcEvidence: [{ directionId: "productivity", factIds: [], reason: "Нет достаточных фактов", levels: {
      A: { definition: "A", matchedConditions: [], missingConditions: ["пример"], contradictingFactIds: [] },
      B: { definition: "B", matchedConditions: [], missingConditions: ["пример"], contradictingFactIds: [] },
      C: { definition: "C", matchedConditions: [], missingConditions: ["пример"], contradictingFactIds: [] },
    } }],
  });
  assert.deepEqual(normalized.abcStates, { productivity: "B" });
  assert.equal((normalized.abcEvidence as Record<string, unknown>).productivity !== undefined, true);
});
