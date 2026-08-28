import assert from "node:assert/strict";
import test from "node:test";
import * as reports from "../server/candidate-pipeline/reports.ts";
import { renderCandidatePdf, reportSectionTitle, requiredReportSections, type ReportModel } from "../server/candidate-pipeline/reports.ts";

const manifest = Object.freeze({ entries: Object.freeze([
  Object.freeze({ role: "resume", name: "resume.pdf", fileId: "drive-pdf-safe", webViewLink: "https://drive.google.com/file/d/drive-pdf-safe/view", supported: true }),
  Object.freeze({ role: "interview", name: "interview.mp4", fileId: "drive-video-safe", webViewLink: "https://drive.google.com/file/d/drive-video-safe/view", supported: true }),
  Object.freeze({ role: "additional", name: "recommendation", fileId: "docs-safe", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/docs-safe/edit", supported: true }),
  Object.freeze({ role: "result", name: "old-result.pdf", fileId: "result-secret", webViewLink: "https://drive.google.com/file/d/result-secret/view", supported: true }),
  Object.freeze({ role: "additional", name: "bad-http.pdf", fileId: "bad-http", webViewLink: "http://drive.google.com/file/d/bad-http/view", supported: true }),
  Object.freeze({ role: "additional", name: "evil.pdf", fileId: "evil", webViewLink: "https://evil.example/file/evil", supported: true }),
  Object.freeze({ role: "additional", name: "mismatch.pdf", fileId: "expected-id", webViewLink: "https://drive.google.com/file/d/other-id/view", supported: true }),
]) });

test("REP-024: immutable manifest projects only supported non-result materials with exact HR-safe Google targets", () => {
  const api = reports as unknown as { projectReportSourceMaterials?: (manifest: unknown) => Array<{ fileName: string; roleLabel: string; href: string }> };
  assert.equal(typeof api.projectReportSourceMaterials, "function", "public source-material projection boundary is missing");
  const projected = api.projectReportSourceMaterials!(manifest);
  assert.deepEqual(projected, [
    { fileName: "resume.pdf", roleLabel: "Резюме", href: "https://drive.google.com/file/d/drive-pdf-safe/view" },
    { fileName: "interview.mp4", roleLabel: "Интервью", href: "https://drive.google.com/file/d/drive-video-safe/view" },
    { fileName: "recommendation", roleLabel: "Дополнительный документ", href: "https://docs.google.com/document/d/docs-safe/edit" },
  ]);
  assert.equal(JSON.stringify(manifest).includes("result-secret"), true, "fixture must remain immutable-like and include excluded result");
});

test("REP-024: candidate-report PDF emits one Link annotation per valid source and leaks no invalid/internal target", async () => {
  const sourceMaterials = [
    { fileName: "resume.pdf", roleLabel: "Резюме", href: "https://drive.google.com/file/d/drive-pdf-safe/view" },
    { fileName: "interview.mp4", roleLabel: "Интервью", href: "https://drive.google.com/file/d/drive-video-safe/view" },
    { fileName: "recommendation", roleLabel: "Дополнительный документ", href: "https://docs.google.com/document/d/docs-safe/edit" },
    { fileName: "bad-http.pdf", roleLabel: "Документ", href: "http://drive.google.com/file/d/bad-http/view" },
    { fileName: "evil.pdf", roleLabel: "Документ", href: "https://evil.example/file/evil" },
    { fileName: "mismatch.pdf", roleLabel: "Документ", href: "https://drive.google.com/file/d/other-id/view", fileId: "expected-id" },
  ];
  const sections = requiredReportSections("candidate-report").map((id) => ({ id, title: reportSectionTitle("candidate-report", id), body: id === "sources" ? "Материалы кандидата доступны по безопасным ссылкам." : `Синтетический раздел ${id}` }));
  const model = { type: "candidate-report", candidateId: "synthetic", candidateDisplayName: "Synthetic", vacancyId: "vacancy", vacancyTitle: "Assistant", profileVersion: "profile-v1", analysisVersion: 1,
    generatedAtUtc: "2026-08-27T00:00:00Z", recommendation: "Рекомендовать с оговорками", sections, evidence: [], sourceMaterials } as unknown as ReportModel;
  const bytes = await renderCandidatePdf(model); const raw = Buffer.from(bytes).toString("latin1");
  for (const target of ["https://drive.google.com/file/d/drive-pdf-safe/view", "https://drive.google.com/file/d/drive-video-safe/view", "https://docs.google.com/document/d/docs-safe/edit"]) {
    assert.equal(raw.includes(target), true, `missing exact /Link URI target ${target}`);
  }
  assert.equal((raw.match(/\/Subtype\s*\/Link/g) ?? []).length, 3, "expected exactly three Link annotations");
  for (const forbidden of ["http://drive.google.com", "evil.example", "/other-id/", "expected-id", "candidate:///", "artifact://", "drive-pdf-safe", "drive-video-safe", "docs-safe"]) {
    if (forbidden.startsWith("drive-") || forbidden === "docs-safe") continue;
    assert.equal(raw.includes(forbidden), false, `PDF leaks invalid/internal value ${forbidden}`);
  }
});
