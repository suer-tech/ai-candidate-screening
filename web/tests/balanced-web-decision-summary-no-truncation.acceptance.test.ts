import assert from "node:assert/strict";
import test from "node:test";
import { projectAssessment } from "../server/product/postgres-repository.ts";

test("REP-025 regression: decision summary keeps selected evidence sentences intact without artificial ellipsis", () => {
  const positive = "Кандидат описал устойчивый процесс подготовки встреч: заранее собирает контекст по участникам, проверяет договорённости и значимые даты, готовит собственнику единый пакет материалов, предлагает несколько вариантов решения и после встречи фиксирует ответственных и сроки, что подтверждено резюме и конкретным примером на интервью.";
  const attention = "При обсуждении срочных поручений кандидат прямо отметил, что в периоды одновременного запуска нескольких задач часть последующих касаний могла переноситься на следующий рабочий день, поэтому для этой роли потребуется заранее согласованный механизм приоритизации и контроль незавершённых договорённостей.";
  assert.ok(positive.length > 220, "fixture must exercise the former per-item 220-character limit");
  assert.ok(attention.length > 220, "fixture must exercise the former per-item 220-character limit");
  assert.ok(positive.length + attention.length > 520, "fixture must exercise the former aggregate 520-character limit");

  const snapshot = {
    recommendation: "Рекомендовать с оговорками",
    recommendationReason: "Рекомендация основана на совокупности подтверждённых критериев и обозначенной зоне внимания.",
    structuredAssessment: {
      observations: [], abcStates: {}, abcEvidence: {}, accessToKe: [], stopFactors: [],
      competencies: [{ name: "Подготовка коммуникаций", state: "Подтверждено", reason: positive, factIds: ["fact-positive-long"] }],
      risks: [{ name: "Своевременность follow-up", state: "Не подтверждено", reason: attention, factIds: ["fact-attention-long"] }],
    },
  };
  const evidence = { facts: [
    { id: "fact-positive-long", predicate: "competency", value: positive, locator: { kind: "document", fileName: "Synthetic resume.pdf", page: 2, exactText: "Заранее готовил единый пакет материалов к встречам." } },
    { id: "fact-attention-long", predicate: "risk", value: attention, locator: { kind: "transcript", recordingId: "synthetic", startMs: 31_000, endMs: 42_000, exactText: "Иногда переносил последующее касание на следующий рабочий день." } },
  ] };

  const projection = projectAssessment(snapshot, evidence);
  assert.ok(projection);
  const failures: string[] = [];
  if (!projection.summary.includes(positive)) failures.push("selected positive evidence was cut instead of preserving its complete sentence");
  if (!projection.summary.includes(attention)) failures.push("selected attention evidence was cut instead of preserving its complete sentence");
  if (projection.summary.includes("…")) failures.push("summary contains an artificial ellipsis introduced by a projection character limit");
  if (projection.summary.indexOf(positive) < 0 || projection.summary.indexOf(positive) > projection.summary.indexOf(attention)) failures.push("complete evidence sentences are not ordered positive then attention");
  assert.deepEqual(failures, [], `actual summary: ${projection.summary}`);
});
