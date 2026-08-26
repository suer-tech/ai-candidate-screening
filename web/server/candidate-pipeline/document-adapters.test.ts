import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { MammothDocxExtractionAdapter, PdfJsExtractionAdapter, documentLocator, processDocument } from "./documents.ts";
import { renderMinimalPdf, requiredReportSections, type ReportModel } from "./reports.ts";

function pdfBytes() {
  const model: ReportModel = { type: "abc-test", candidateId: "candidate-1", candidateDisplayName: "Candidate", vacancyId: "vacancy-1", vacancyTitle: "Vacancy", profileVersion: "profile-1", analysisVersion: 1, generatedAtUtc: "2026-08-20T00:00:00Z", recommendation: "Рекомендовать", sections: requiredReportSections("abc-test").map((id) => ({ id, title: id, body: `known-${id}` })), evidence: [] };
  return renderMinimalPdf(model);
}

async function docxBytes() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder("_rels")!.file(".rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word")!.file("document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Опыт:</w:t></w:r></w:p><w:p><w:r><w:t>Руководил командой из 8 человек</w:t></w:r></w:p></w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

test("PDF.js extracts actual page text and rejects corrupt PDF", async () => {
  const adapter = new PdfJsExtractionAdapter();
  const pages = await adapter.extract(pdfBytes());
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /candidate=candidate-1/);
  await assert.rejects(() => adapter.extract(new Uint8Array([1, 2, 3])), /CORRUPT_PDF/);
});

test("Mammoth extracts actual DOCX paragraphs and section boundary", async () => {
  const adapter = new MammothDocxExtractionAdapter();
  const sections = await adapter.extract(await docxBytes());
  assert.deepEqual(sections.map((item) => item.paragraph), [1, 2]);
  assert.equal(sections[1].section, "Опыт");
  assert.match(sections[1].text, /8 человек/);
  await assert.rejects(() => adapter.extract(new Uint8Array([1, 2, 3])), /CORRUPT_DOCX/);
});

test("actual mixed PDF routes blank scanned page to OCR and keeps stable locator", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText("Known text page with enough searchable content", { x: 30, y: 700, font });
  document.addPage();
  const bytes = new Uint8Array(await document.save());
  const processed = await processDocument({ mimeType: "application/pdf", fileId: "mixed-pdf", fileVersion: "1", bytes, pdf: new PdfJsExtractionAdapter(), docx: new MammothDocxExtractionAdapter(), ocr: { recognize: async ({ page }) => ({ page, text: "Scanned OCR evidence", confidence: 0.61, regions: [{ text: "Scanned OCR evidence", confidence: 0.61, bbox: { x: 10, y: 20, width: 100, height: 20 } }] }) } });
  assert.deepEqual(processed.normalized.boundaries.map((item) => item.method), ["text", "ocr"]);
  const input = { fileId: "mixed-pdf", fileVersion: "1", artifactId: "document-1", fileName: "resume.pdf", exactText: "Scanned OCR evidence", processed, page: 2, bbox: { x: 10, y: 20, width: 100, height: 20 }, confidence: 0.61 } as const;
  assert.deepEqual(documentLocator(input), documentLocator(input));
});
