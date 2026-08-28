import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createDocumentProcessorServer } from "../server/document-processor/server.ts";
import { reportSectionTitle, requiredReportSections, validateRenderedReportPdf, type ReportModel } from "../server/candidate-pipeline/reports.ts";
import type { CandidateMatrixRow } from "../server/candidate-pipeline/matrix-driven.ts";

const row: CandidateMatrixRow = {
  criterionId: "criterion-pdf-boundary",
  supportingClaimIds: ["claim-pdf"],
  contradictingClaimIds: [],
  checkedSourceIds: ["source-pdf"],
  state: "Недостаточно данных",
  reason: "Независимая проверка отклонила предварительный вывод",
  missingData: "Требуется дополнительное подтверждение",
  followUpQuestion: "Какой пример подтверждает выполнение требования?",
  verificationState: "REJECTED",
};

const longSummary = Array.from({ length: 43 }, (_, index) =>
  `Заполняющая строка матрицы ${String(index + 1).padStart(2, "0")}: полный исходный смысл сохранён.`).join("\n");
const shortBoundaryRow = "Состояние: Недостаточно данных; Основание: независимая проверка отклонила предварительный вывод; "
  + "Доказательства: claim-pdf, source-pdf; Недостающие данные: дополнительное подтверждение; "
  + "Вопрос: какой пример подтверждает выполнение требования?; Проверка: REJECTED.";
assert.ok(shortBoundaryRow.length < 400);

function model(type: ReportModel["type"]): ReportModel {
  return {
    type,
    candidateId: "synthetic-pdf-stage-candidate",
    candidateDisplayName: "PDF Граничный Кандидат",
    vacancyId: "synthetic-pdf-stage-vacancy",
    vacancyTitle: "PDF матричная вакансия",
    profileVersion: "profile-pdf-matrix-v2",
    analysisVersion: 1,
    generatedAtUtc: "2026-08-27T00:00:00Z",
    recommendation: "Недостаточно данных",
    workflowVersion: "matrix-v2",
    matrixProvenance: { matrixId: "matrix-pdf-v2", checksum: "c".repeat(64), policyVersion: "matrix-policy/v2" },
    matrixRows: [row],
    evidence: [],
    sections: [
      ...requiredReportSections(type).map((id) => ({ id, title: reportSectionTitle(type, id), body: `Синтетическое содержимое раздела ${id}.` })),
      { id: "matrix", title: "Матрица критериев", body: longSummary },
      { id: `matrix:${row.criterionId}`, title: "Короткая граничная строка", body: shortBoundaryRow },
    ],
  };
}

test("PDF-STAGE-MATRIX-RED: processor renders and validates an isolated large matrix-v2 report pair", async () => {
  const token = "synthetic-document-processor-token-00000001";
  const models = [model("abc-test"), model("candidate-results")];
  const server = createDocumentProcessorServer({ token, host: "127.0.0.1", port: 0, maxInputBytes: 8 * 1024 * 1024 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/render-report-pair`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ models }),
    });
    const payload = await response.json() as { code?: string; schemaVersion?: string; reports?: Array<{ type: string; checksum: string; bytesBase64: string }> };
    assert.equal(response.status, 200, `isolated PDF stage failed: ${JSON.stringify(payload)}`);
    assert.equal(payload.schemaVersion, "rendered-report-pair/v1");
    assert.equal(payload.reports?.length, 2);
    assert.deepEqual(new Set(payload.reports?.map((report) => report.type)), new Set(["abc-test", "candidate-results"]));

    for (const report of payload.reports ?? []) {
      const bytes = new Uint8Array(Buffer.from(report.bytesBase64, "base64"));
      assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("ascii"), "%PDF-");
      const reportModel = models.find((item) => item.type === report.type);
      assert.ok(reportModel);
      const validation = await validateRenderedReportPdf(bytes, reportModel);
      assert.equal(report.checksum, validation.checksum);
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});
