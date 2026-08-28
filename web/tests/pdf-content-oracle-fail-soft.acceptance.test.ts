import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDocumentProcessorServer } from "../server/document-processor/server.ts";
import {
  renderMinimalPdf,
  reportSectionTitle,
  requiredReportSections,
  validateRenderedReportPdf,
  type ReportModel,
} from "../server/candidate-pipeline/reports.ts";

function model(type: ReportModel["type"]): ReportModel {
  const longExtractableName = Array.from({ length: 48 }, (_, index) => `Имя${index + 1}`).join(" ");
  return {
    type,
    candidateId: "synthetic-content-oracle-candidate",
    candidateDisplayName: "Кандидат Ложноотрицательный",
    vacancyId: "synthetic-content-oracle-vacancy",
    vacancyTitle: "Вакансия PDF Oracle",
    profileVersion: "profile-pdf-oracle-v1",
    analysisVersion: 1,
    generatedAtUtc: "2026-08-27T00:00:00Z",
    recommendation: "Недостаточно данных",
    sections: requiredReportSections(type).map((id) => ({
      id,
      title: reportSectionTitle(type, id),
      // For abc-test this identifier-shaped value is removed by the renderer's
      // decision-safe sanitizer but remains in the extraction oracle input. The
      // resulting PDF is structurally valid: only the text oracle is uncertain.
      body: id === "directions" ? "candidate:opaque-oracle-payload" : `Содержимое раздела ${id}.`,
    })),
    evidence: [],
    interviewSummary: type === "candidate-results" ? {
      interviewDate: "27.08.2026",
      fullName: longExtractableName,
      age: "Не указан",
      compensation: "Не указана",
      recentEmployment: [],
      hardSkills: ["Недостаточно данных"],
      softSkills: ["Недостаточно данных"],
      positives: ["Недостаточно данных"],
      negatives: ["Недостаточно данных"],
      additional: ["Недостаточно данных"],
    } : undefined,
  };
}

test("PDF-FAIL-SOFT-RED-001: a structurally valid PDF survives a false-negative extraction/content oracle", async () => {
  const source = model("abc-test");
  const structurallyValidPdfWithIncompleteExtractedText = renderMinimalPdf(source);

  const validation = await validateRenderedReportPdf(structurallyValidPdfWithIncompleteExtractedText, source);

  assert.equal(validation.checksum.length, 64);
  assert.equal(validation.contentOraclePassed, false);
  assert.ok(validation.warnings.length >= 1, "the false-negative content oracle is retained as an explicit warning");
  assert.match(validation.warnings[0], /PDF_CONTENT_ORACLE_FAILED/);
});

test("PDF-FAIL-SOFT-RED-002: document processor returns 200 and warning metadata for content-oracle uncertainty", async () => {
  const token = "synthetic-pdf-fail-soft-token-000000001";
  const models = [model("abc-test"), model("candidate-results")];
  const server = createDocumentProcessorServer({ token, host: "127.0.0.1", port: 0, maxInputBytes: 4 * 1024 * 1024 });
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
    const payload = await response.json() as {
      code?: string;
      contentOraclePassed?: boolean;
      warningCount?: number;
      reports?: Array<{ type: string; checksum: string; bytesBase64: string; contentOraclePassed?: boolean; warningCount?: number }>;
    };

    assert.equal(response.status, 200, `content-oracle uncertainty must not terminal-fail PDF stage: ${JSON.stringify(payload)}`);
    assert.equal(payload.reports?.length, 2);
    assert.equal(payload.contentOraclePassed, false);
    assert.ok((payload.warningCount ?? 0) >= 1);
    assert.ok(payload.reports?.some((report) => report.contentOraclePassed === false && (report.warningCount ?? 0) >= 1));
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("PDF-FAIL-SOFT-RED-003: production persists the real content-oracle result, never a hard-coded pass", () => {
  const source = readFileSync(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /contentOracle\s*:\s*true/, "validation_json must not claim content success after a warning response");
  assert.match(source, /contentOracle(?:Passed)?\s*:\s*report\.contentOraclePassed/, "processor metadata must flow into validation_json");
  assert.match(source, /warningCount\s*:\s*report\.warningCount/, "warning count must flow into validation_json");
});
