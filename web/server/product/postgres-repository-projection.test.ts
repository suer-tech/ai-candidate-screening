import assert from "node:assert/strict";
import test from "node:test";
import { projectAssessment } from "./postgres-repository.ts";

test("assessment projection reads canonical fields and historical model aliases", () => {
  const overview = projectAssessment({
    recommendation: "Не рекомендовать",
    structuredAssessment: {
      observations: [], abcStates: {}, abcEvidence: {}, accessToKe: [],
      competencies: [
        { name: "Каноническая компетенция", state: "Подтверждено", reason: "Основание", factIds: ["fact-1"] },
        { competency: "Историческая компетенция", state: "Подтверждено", reason: "Основание", factIds: ["fact-2"] },
      ],
      risks: [{ risk: "Исторический риск", state: "Подтверждено", reason: "Основание", factIds: ["fact-3"] }],
      stopFactors: [{ stopFactor: "Исторический стоп-фактор", state: "Подтверждено", reason: "Основание", factIds: ["fact-4"] }],
    },
  }, { facts: [] });
  assert.ok(overview);
  assert.deepEqual(overview.competencies.map((item) => item.name), ["Каноническая компетенция", "Историческая компетенция"]);
  assert.deepEqual(overview.risks.map((item) => item.name), ["Исторический риск"]);
  assert.deepEqual(overview.stopFactors.map((item) => item.name), ["Исторический стоп-фактор"]);
  assert.equal(overview.recommendationBasis, "Основание");
});
