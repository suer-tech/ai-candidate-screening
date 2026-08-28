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
  }, { facts: ["fact-1", "fact-2", "fact-3", "fact-4"].map((id) => ({ id, predicate: "grounded_statement", value: `Основание ${id}`, locator: { kind: "document", fileName: "Синтетический документ", page: 1, exactText: `Цитата ${id}` } })) });
  assert.ok(overview);
  assert.deepEqual(overview.competencies.map((item) => item.name), ["Каноническая компетенция", "Историческая компетенция"]);
  assert.deepEqual(overview.risks.map((item) => item.name), ["Исторический риск"]);
  assert.deepEqual(overview.stopFactors.map((item) => item.name), ["Исторический стоп-фактор"]);
  assert.equal(overview.recommendationBasis, "Основание");
});

test("assessment projection exposes the exact interview interval from claim locators", () => {
  const overview = projectAssessment({
    structuredAssessment: {
      observations: [{ name: "Наблюдение", reason: "Основание", factIds: ["claim-1"] }],
      competencies: [], risks: [], stopFactors: [], accessToKe: [], abcStates: {}, abcEvidence: {},
    },
  }, { claimsRef: "claims-ref" }, {
    claims: [{
      claimId: "claim-1",
      text: "Точный фрагмент ответа кандидата.",
      locator: "materials.transcript.normalized.utterances[62] (utteranceId=utterance-62, speaker=A, start=2785840, end=2809700)",
      sourceClass: "interview_transcript",
      relation: "CONTRADICTS",
    }],
  });
  assert.ok(overview);
  assert.equal(overview.evidence[0]?.source, "Интервью · 46:25–46:49");
});

test("balanced decision summary preserves a positive validated recommendation and basis", () => {
  const snapshot = {
    recommendation: "Рекомендовать",
    recommendationReason: "Совокупность подтверждённых соответствий позволяет рекомендовать кандидата.",
    structuredAssessment: {
      observations: [], abcStates: {}, abcEvidence: {}, accessToKe: [], stopFactors: [], risks: [],
      competencies: [{ name: "Организация", state: "Подтверждено", reason: "Кандидат системно готовит встречи и материалы заранее.", factIds: ["fact-positive"] }],
    },
  };
  const overview = projectAssessment(snapshot, { facts: [{ id: "fact-positive", predicate: "competency", value: "Организация", locator: {
    kind: "document", fileName: "Synthetic resume.pdf", page: 1, exactText: "Готовил встречи и материалы заранее.",
  } }] });
  assert.ok(overview);
  assert.equal(overview.recommendationBasis, snapshot.recommendationReason);
  assert.match(overview.summary ?? "", /системно готовит встречи/);
  assert.doesNotMatch(overview.summary ?? "", /Совокупность подтверждённых соответствий позволяет рекомендовать/);
  assert.equal(snapshot.recommendation, "Рекомендовать");
});
