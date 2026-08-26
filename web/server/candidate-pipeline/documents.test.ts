import assert from "node:assert/strict";
import test from "node:test";
import { documentLocator, processDocument } from "./documents.ts";

const pdf = { extract: async () => [{ page: 1, text: "Опыт: увеличил выручку на 20 процентов", section: "Опыт", method: "text" as const }, { page: 2, text: "", section: "Команда", method: "text" as const }] };
const docx = { extract: async () => [{ paragraph: 1, section: "Опыт", text: "Руководил продуктом" }] };
const ocr = { recognize: async () => ({ page: 2, text: "Руководил командой из 8 человек", confidence: 0.94, regions: [{ text: "Руководил командой из 8 человек", bbox: { x: 1, y: 2, width: 3, height: 4 }, confidence: 0.94 }] }) };

test("mixed PDF preserves raw extraction and OCR separately and merges deterministically", async () => {
  const processed = await processDocument({ mimeType: "application/pdf", fileId: "file-1", fileVersion: "1", bytes: new Uint8Array([37, 80, 68, 70]), pdf, docx, ocr });
  assert.equal(processed.extractedPages?.[1].text, "");
  assert.equal(processed.ocrPages?.[0].confidence, 0.94);
  assert.deepEqual(processed.normalized.boundaries.map((item) => item.method), ["text", "ocr"]);
  const locator = documentLocator({ fileId: "file-1", fileVersion: "1", artifactId: "artifact-1", fileName: "resume.pdf", exactText: "командой из 8", processed, page: 2, bbox: { x: 1, y: 2, width: 3, height: 4 }, confidence: 0.94 });
  assert.equal(locator.section, "Команда");
  assert.ok(locator.textSpan!.end > locator.textSpan!.start);
});

test("DOCX keeps paragraph/section boundary and unsupported/corrupt inputs fail safely", async () => {
  const processed = await processDocument({ mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileId: "file-2", fileVersion: "1", bytes: new Uint8Array([80, 75]), pdf, docx, ocr });
  assert.equal(processed.normalized.boundaries[0].paragraph, 1);
  assert.equal(documentLocator({ fileId: "file-2", fileVersion: "1", artifactId: "artifact-2", fileName: "resume.docx", exactText: "Руководил", processed, paragraph: 1 }).section, "Опыт");
  await assert.rejects(() => processDocument({ mimeType: "text/plain", fileId: "bad", fileVersion: "1", bytes: new Uint8Array([1]), pdf, docx, ocr }), /UNSUPPORTED_DOCUMENT_TYPE/);
  await assert.rejects(() => processDocument({ mimeType: "application/pdf", fileId: "bad", fileVersion: "1", bytes: new Uint8Array(), pdf, docx, ocr }), /CORRUPT_DOCUMENT/);
});
