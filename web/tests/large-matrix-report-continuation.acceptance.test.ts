import assert from "node:assert/strict";
import test from "node:test";
import { PdfJsExtractionAdapter } from "../server/candidate-pipeline/documents.ts";
import { renderCandidatePdf, reportSectionTitle, requiredReportSections, validateRenderedReportPdf, type ReportModel } from "../server/candidate-pipeline/reports.ts";
import type { CandidateMatrixRow } from "../server/candidate-pipeline/matrix-driven.ts";

const matrixRows: CandidateMatrixRow[] = Array.from({ length: 18 }, (_, index) => ({
  criterionId: `criterion-${String(index + 1).padStart(3, "0")}`,
  supportingClaimIds: [`claim-support-${index + 1}`],
  contradictingClaimIds: index % 4 === 0 ? [`claim-contradict-${index + 1}`] : [],
  checkedSourceIds: [`source-${index + 1}`],
  state: index % 5 === 0 ? "Недостаточно данных" : "Подтверждено",
  reason: `Синтетическое полное основание строки ${index + 1}`,
  missingData: index % 5 === 0 ? `Недостаёт независимого подтверждения строки ${index + 1}` : "",
  followUpQuestion: `Уточните полный контекст строки ${index + 1}`,
  verificationState: index % 5 === 0 ? "REJECTED" : "VERIFIED",
}));

const longSentence = (label: string, repetitions: number) =>
  `${label}-НАЧАЛО ` + Array.from({ length: repetitions }, (_, index) =>
    `наблюдаемый-фрагмент-${index + 1} подтверждает исходный смысл критерия без сокращения и без потери локатора`).join(" ") + ` ${label}-КОНЕЦ`;

const requiredSections = requiredReportSections("abc-test").map((id) => ({
  id,
  title: reportSectionTitle("abc-test", id),
  body: `Полное синтетическое содержимое обязательного раздела ${id}.`,
}));

const model: ReportModel = {
  type: "abc-test",
  candidateId: "synthetic-large-matrix-candidate",
  candidateDisplayName: "Большой Матричный Кандидат",
  vacancyId: "synthetic-large-matrix-vacancy",
  vacancyTitle: "Большая матричная вакансия",
  profileVersion: "profile-large-matrix-v2",
  analysisVersion: 1,
  generatedAtUtc: "2026-08-27T00:00:00Z",
  recommendation: "Недостаточно данных",
  workflowVersion: "matrix-v2",
  matrixProvenance: { matrixId: "matrix-large-v2", checksum: "a".repeat(64), policyVersion: "matrix-policy/v2" },
  matrixRows,
  evidence: [],
  sections: [
    ...requiredSections,
    { id: "matrix", title: "Матрица критериев", body: longSentence("MATRIX-SUMMARY", 360) },
    ...matrixRows.map((row, index) => ({
      id: `matrix:${row.criterionId}`,
      title: `Строка матрицы ${row.criterionId}`,
      body: longSentence(`MATRIX-ROW-${String(index + 1).padStart(3, "0")}`, 70),
    })),
  ],
};

test("REP-MATRIX-CONTINUATION-RED: large matrix report validates complete content across continuation pages", async () => {
  const bytes = await renderCandidatePdf(model);
  await validateRenderedReportPdf(bytes, model);

  const pages = await new PdfJsExtractionAdapter().extract(bytes);
  const text = pages.map((page) => page.text).join(" ").replace(/\s+/g, " ");
  const missingMarkers = [
    "MATRIX-SUMMARY-НАЧАЛО",
    "MATRIX-SUMMARY-КОНЕЦ",
    ...matrixRows.flatMap((_, index) => [
      `MATRIX-ROW-${String(index + 1).padStart(3, "0")}-НАЧАЛО`,
      `MATRIX-ROW-${String(index + 1).padStart(3, "0")}-КОНЕЦ`,
    ]),
  ].filter((marker) => !text.includes(marker));
  assert.deepEqual(missingMarkers, [], "continuation rendering lost matrix summary/row boundary markers");
  assert.ok(pages.length > 1, "fixture must exercise continuation pages");
});

test("REP-MATRIX-CONTINUATION-RED-SHORT: sub-400-char colon payload validates when split exactly at a card/page boundary", async () => {
  const boundaryRow: CandidateMatrixRow = {
    criterionId: "criterion-boundary-short",
    supportingClaimIds: ["claim-boundary"],
    contradictingClaimIds: [],
    checkedSourceIds: ["source-boundary"],
    state: "Недостаточно данных",
    reason: "Независимая проверка не подтвердила предварительный вывод",
    missingData: "Требуется дополнительное доказательство",
    followUpQuestion: "Какой пример подтверждает выполнение требования?",
    verificationState: "REJECTED",
  };
  const shortColonPayload = "Состояние: Недостаточно данных; Основание: независимая проверка отклонила предварительный вывод; "
    + "Доказательства: claim-boundary, source-boundary; Недостающие данные: дополнительное подтверждение; "
    + "Вопрос: какой пример подтверждает выполнение требования?; Проверка: REJECTED.";
  assert.ok(shortColonPayload.length < 400, "fixture payload must exercise the short-content validator branch");
  const boundaryModel: ReportModel = {
    ...model,
    candidateId: "synthetic-boundary-candidate",
    candidateDisplayName: "Граничный Матричный Кандидат",
    matrixRows: [boundaryRow],
    matrixProvenance: { matrixId: "matrix-boundary-v2", checksum: "b".repeat(64), policyVersion: "matrix-policy/v2" },
    sections: [
      ...requiredSections,
      {
        id: "matrix",
        title: "Матрица критериев",
        body: Array.from({ length: 43 }, (_, index) => `Заполняющая строка матрицы ${String(index + 1).padStart(2, "0")}.`).join("\n"),
      },
      { id: `matrix:${boundaryRow.criterionId}`, title: "Короткая граничная строка", body: shortColonPayload },
    ],
  };

  const bytes = await renderCandidatePdf(boundaryModel);
  await validateRenderedReportPdf(bytes, boundaryModel);
  const pages = await new PdfJsExtractionAdapter().extract(bytes);
  const text = pages.map((page) => page.text).join(" ").replace(/\s+/g, " ");
  assert.match(text, /Короткая граничная строка · продолжение/, "fixture must place the short card across a continuation boundary");
  const orderedTokens = shortColonPayload.split(/\s+/).filter(Boolean);
  let cursor = 0;
  for (const token of orderedTokens) {
    const next = text.indexOf(token, cursor);
    assert.ok(next >= cursor, `short payload token lost or reordered: ${token}`);
    cursor = next + token.length;
  }
});
