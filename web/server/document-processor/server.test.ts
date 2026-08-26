import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { renderMinimalPdf, requiredReportSections, type ReportModel } from "../candidate-pipeline/reports.ts";
import { createDocumentProcessorServer } from "./server.ts";

test("private document processor extracts PDF text without retaining input", async () => {
  const token = "document-processor-test-token-000000000000";
  const server = createDocumentProcessorServer({ token, host: "127.0.0.1", port: 0, maxInputBytes: 1024 * 1024 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const model: ReportModel = { type: "abc-test", candidateId: "candidate", candidateDisplayName: "Synthetic", vacancyId: "vacancy",
      vacancyTitle: "Vacancy", profileVersion: "v1", analysisVersion: 1, generatedAtUtc: new Date(0).toISOString(),
      recommendation: "Недостаточно данных", sections: requiredReportSections("abc-test").map((id) => ({ id, title: id, body: "synthetic" })), evidence: [] };
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/extract-document`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/pdf" }, body: renderMinimalPdf(model) });
    assert.equal(response.status, 200);
    const result = await response.json() as { kind?: string; pages?: Array<{ text?: string }> };
    assert.equal(result.kind, "pdf");
    assert(result.pages?.some((page) => page.text?.includes("candidate")));
    const second: ReportModel = { ...model, type: "candidate-results",
      sections: requiredReportSections("candidate-results").map((id) => ({ id, title: id, body: "synthetic" })) };
    const rendered = await fetch(`http://127.0.0.1:${address.port}/v1/render-report-pair`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ models: [model, second] }) });
    assert.equal(rendered.status, 200);
    const pair = await rendered.json() as { reports?: Array<{ bytesBase64?: string }> };
    assert.equal(pair.reports?.length, 2);
    assert(pair.reports?.every((report) => typeof report.bytesBase64 === "string" && report.bytesBase64.length > 100));
  } finally {
    server.close();
    await once(server, "close");
  }
});
