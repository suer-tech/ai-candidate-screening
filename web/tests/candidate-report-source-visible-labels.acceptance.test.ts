import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PdfJsExtractionAdapter } from "../server/candidate-pipeline/documents.ts";
import * as reports from "../server/candidate-pipeline/reports.ts";
import { renderCandidatePdf, reportSectionTitle, requiredReportSections, type ReportModel } from "../server/candidate-pipeline/reports.ts";

const sourceMaterials = [
  { fileName: "resume.pdf", roleLabel: "Резюме", href: "https://drive.google.com/file/d/drive-resume-visible/view" },
  { fileName: "interview.mp4", roleLabel: "Интервью", href: "https://drive.google.com/file/d/drive-interview-visible/view" },
  { fileName: "recommendation.docx", roleLabel: "Дополнительный документ", href: "https://docs.google.com/document/d/docs-recommendation-visible/edit" },
] as const;

test("REP-024: public HR source-line projection hides internal role labels and preserves the projection model", () => {
  const api = reports as unknown as { projectCandidateReportSourceLines?: (materials: typeof sourceMaterials) => readonly string[] };
  assert.equal(typeof api.projectCandidateReportSourceLines, "function", "public candidate-report source-line projection boundary is missing");
  const before = structuredClone(sourceMaterials);
  assert.deepEqual(api.projectCandidateReportSourceLines!(sourceMaterials), [
    "• resume.pdf",
    "• interview.mp4",
    "• recommendation.docx",
  ]);
  assert.deepEqual(sourceMaterials, before, "HR projection mutated sourceMaterials or removed its internal roleLabel");
});

test("REP-024: visible PDF source rows are filename-only while their exact Google Link annotations remain clickable", async () => {
  const sections = requiredReportSections("candidate-report").map((id) => ({
    id,
    title: reportSectionTitle("candidate-report", id),
    body: id === "sources" ? "Резюме: stale.pdf\nИнтервью: stale.mp4\nДополнительный документ: stale.docx" : `Синтетический раздел ${id}`,
  }));
  const model = { type: "candidate-report", candidateId: "synthetic", candidateDisplayName: "Synthetic", vacancyId: "vacancy", vacancyTitle: "Assistant", profileVersion: "profile-v1",
    analysisVersion: 1, generatedAtUtc: "2026-08-28T00:00:00Z", recommendation: "Рекомендовать с оговорками", sections, evidence: [], sourceMaterials } as unknown as ReportModel;
  const bytes = await renderCandidatePdf(model);
  const visible = (await new PdfJsExtractionAdapter().extract(bytes)).map((page) => page.text).join("\n");
  const raw = Buffer.from(bytes).toString("latin1");
  for (const fileName of sourceMaterials.map((item) => item.fileName)) {
    assert.match(visible, new RegExp(`•\\s*${fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `visible filename-only row is missing for ${fileName}`);
  }
  for (const forbidden of ["Резюме:", "Интервью:", "Дополнительный документ:", "stale.pdf", "stale.mp4", "stale.docx"]) {
    assert.equal(visible.includes(forbidden), false, `visible PDF leaks source role/body prefix: ${forbidden}`);
  }
  assert.equal((raw.match(/\/Subtype\s*\/Link/g) ?? []).length, sourceMaterials.length, "filename-only rows lost clickable annotations");
  for (const material of sourceMaterials) assert.equal(raw.includes(material.href), true, `missing exact /Link URI ${material.href}`);
});

test("REP-024: production fallback delegates source body to the shared filename-only projection", () => {
  const runtimePath = fileURLToPath(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url));
  const source = readFileSync(runtimePath, "utf8");
  const failures: string[] = [];
  if (!/projectCandidateReportSourceLines\(reportSourceMaterials\)/u.test(source)) failures.push("production sources body does not use the public filename-only projection");
  if (/reportSourceMaterials\.map\(\(item\)\s*=>\s*`•\s*\$\{item\.roleLabel\}:\s*\$\{item\.fileName\}`\)/u.test(source)) failures.push("production fallback still renders roleLabel: fileName");
  assert.deepEqual(failures, []);
});
