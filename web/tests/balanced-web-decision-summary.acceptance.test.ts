import assert from "node:assert/strict";
import test from "node:test";
import { projectAssessment } from "../server/product/postgres-repository.ts";

test("REP-025: deterministic web summary preserves validated decision and balances evidence positive before attention", () => {
  const validatedRecommendation = "Не рекомендовать";
  const validatedBasis = "Подтверждён стоп-фактор доступности в согласованном графике.";
  const positive = "Сильная сторона: кандидат заранее готовит встречи и полный контекст.";
  const attention = "Зона внимания: часть follow-up выполнялась с задержкой.";
  const snapshot = {
    recommendation: validatedRecommendation,
    recommendationReason: validatedBasis,
    structuredAssessment: {
      observations: [], abcStates: {}, abcEvidence: {}, accessToKe: [], stopFactors: [],
      competencies: [{ name: "Подготовка встреч", state: "Подтверждено", reason: positive, factIds: ["fact-positive"] }],
      risks: [{ name: "Своевременный follow-up", state: "Не подтверждено", reason: attention, factIds: ["fact-risk"] }],
    },
  };
  const evidence = { facts: [
    { id: "fact-positive", predicate: "competency", value: positive, locator: { kind: "document", fileName: "Synthetic resume.pdf", page: 2, exactText: "Готовил материалы заранее." } },
    { id: "fact-risk", predicate: "risk", value: attention, locator: { kind: "transcript", recordingId: "synthetic", startMs: 12000, endMs: 18000, exactText: "Иногда follow-up задерживался." } },
  ] };

  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { providerCalls += 1; throw new Error("REP-025 projection must not call a provider"); }) as typeof fetch;
  try {
    const before = structuredClone(snapshot);
    const first = projectAssessment(snapshot, evidence);
    const second = projectAssessment(snapshot, evidence);
    assert.ok(first && second);
    const failures: string[] = [];
    if (providerCalls !== 0) failures.push(`projection made ${providerCalls} provider calls`);
    if (JSON.stringify(first) !== JSON.stringify(second)) failures.push("same validated projection produced a non-deterministic summary");
    if (!first.summary.includes(positive)) failures.push("negative recommendation suppressed the evidence-backed strength");
    if (!first.summary.includes(attention)) failures.push("summary omitted the evidence-backed attention item");
    if (first.summary.indexOf(positive) < 0 || first.summary.indexOf(positive) > first.summary.indexOf(attention)) failures.push("summary order is not positive then attention");
    if (first.recommendationBasis !== validatedBasis) failures.push(`recommendationBasis mutated: ${first.recommendationBasis}`);
    if (first.summary.includes(validatedBasis)) failures.push("verbatim recommendation basis is duplicated in summary");
    if (snapshot.recommendation !== validatedRecommendation || snapshot.recommendationReason !== validatedBasis) failures.push("validated recommendation or basis input was mutated");
    if (JSON.stringify(snapshot) !== JSON.stringify(before)) failures.push("HR summary projection mutated the validated assessment artifact");
    const allowed = [positive, attention];
    if (!allowed.some((item) => first.summary.includes(item))) failures.push("summary is not grounded in existing HR-safe evidence");
    assert.deepEqual(failures, []);
  } finally { globalThis.fetch = originalFetch; }
});
