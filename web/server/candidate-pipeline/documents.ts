import { sha256 } from "./core.ts";
import type { DocumentLocator } from "./types.ts";
import { createRequire } from "node:module";
import { stripRtf } from "rtf-to-text";

export type ExtractedPage = { page: number; text: string; section?: string; method: "text"; textSpans?: Array<{ start: number; end: number }> };
export type OcrPage = { page: number; text: string; confidence: number; regions: Array<{ text: string; bbox: { x: number; y: number; width: number; height: number }; confidence: number }>; schemaVersion?: "ocr-page/v1"; instructionVersion?: string; rawTraceIdentity?: string };
export type ExtractedSection = { paragraph: number; section?: string; text: string };

export interface PdfExtractionAdapter { extract(bytes: Uint8Array): Promise<readonly ExtractedPage[]>; }
export interface DocxExtractionAdapter { extract(bytes: Uint8Array): Promise<readonly ExtractedSection[]>; }
export interface PageOcrAdapter { recognize(input: { fileId: string; fileVersion: string; page: number; bytes: Uint8Array }): Promise<OcrPage>; }

export class PdfJsExtractionAdapter implements PdfExtractionAdapter {
  async extract(bytes: Uint8Array): Promise<readonly ExtractedPage[]> {
    let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
    try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); }
    catch { throw new Error("PDF_EXTRACTION_RUNTIME_UNAVAILABLE"); }
    let loadingTask: ReturnType<typeof pdfjs.getDocument>;
    let document: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
    try { loadingTask = pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, disableFontFace: true, useSystemFonts: true }); document = await loadingTask.promise; }
    catch { throw new Error("CORRUPT_PDF"); }
    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      const textSpans: Array<{ start: number; end: number }> = [];
      for (const item of content.items) {
        if (!("str" in item) || typeof item.str !== "string") continue;
        const value = item.str.trim();
        if (!value) continue;
        if (text && !text.endsWith("\n")) text += " ";
        const start = text.length;
        text += value;
        textSpans.push({ start, end: text.length });
        if ("hasEOL" in item && item.hasEOL) text += "\n";
      }
      pages.push({ page: pageNumber, text: text.trim(), section: "Раздел не определён", method: "text", textSpans });
      page.cleanup();
    }
    await loadingTask.destroy();
    return pages;
  }
}

export class MammothDocxExtractionAdapter implements DocxExtractionAdapter {
  async extract(bytes: Uint8Array): Promise<readonly ExtractedSection[]> {
    let mammoth: typeof import("mammoth");
    try { mammoth = await import("mammoth"); }
    catch { throw new Error("DOCX_EXTRACTION_RUNTIME_UNAVAILABLE"); }
    let result: { value: string };
    try { result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }); }
    catch { throw new Error("CORRUPT_DOCX"); }
    const paragraphs = result.value.split(/\r?\n\s*\r?\n/).map((value) => value.trim()).filter(Boolean);
    let section = "Раздел не определён";
    return paragraphs.map((text, index) => {
      if (text.endsWith(":" ) && text.length <= 120) section = text.slice(0, -1).trim() || section;
      return { paragraph: index + 1, section, text };
    });
  }
}

export class LegacyDocExtractionAdapter implements DocxExtractionAdapter {
  async extract(bytes: Uint8Array): Promise<readonly ExtractedSection[]> {
    type ExtractedWordDocument = { getBody(): string };
    type WordExtractorInstance = { extract(value: Buffer): Promise<ExtractedWordDocument> };
    type WordExtractorConstructor = new () => WordExtractorInstance;
    let body: string;
    const source = Buffer.from(bytes).toString("latin1");
    if (source.trimStart().startsWith("{\\rtf")) {
      const codePage = source.match(/\\ansicpg(\d+)/i)?.[1] ?? "1252";
      const encoding = codePage === "1251" ? "windows-1251" : codePage === "65001" ? "utf-8" : "windows-1252";
      const decoder = new TextDecoder(encoding);
      const decodedHex = source.replace(/\\'([0-9a-f]{2})/gi, (_match, value: string) => decoder.decode(Uint8Array.of(Number.parseInt(value, 16))));
      body = stripRtf(decodedHex);
    } else {
      let WordExtractor: WordExtractorConstructor;
      try { WordExtractor = createRequire(import.meta.url)("word-extractor") as WordExtractorConstructor; }
      catch { throw new Error("DOC_EXTRACTION_RUNTIME_UNAVAILABLE"); }
      try { body = (await new WordExtractor().extract(Buffer.from(bytes))).getBody(); }
      catch { throw new Error("CORRUPT_DOC"); }
    }
    const paragraphs = body.replace(/\u0000/g, "").split(/\r?\n+/).map((value) => value.trim()).filter(Boolean);
    if (!paragraphs.length) throw new Error("CORRUPT_DOC");
    let section = "Раздел не определён";
    return paragraphs.map((text, index) => {
      if (text.endsWith(":" ) && text.length <= 120) section = text.slice(0, -1).trim() || section;
      return { paragraph: index + 1, section, text };
    });
  }
}

export type ProcessedDocument = {
  raw: { checksum: string; byteSize: number };
  normalized: { text: string; boundaries: Array<{ page?: number; paragraph?: number; section: string; start: number; end: number; method: "text" | "ocr" }> };
  extractedPages?: readonly ExtractedPage[];
  ocrPages?: readonly OcrPage[];
};

export async function processDocument(input: { mimeType: string; fileId: string; fileVersion: string; bytes: Uint8Array; pdf: PdfExtractionAdapter; docx: DocxExtractionAdapter; ocr: PageOcrAdapter; ocrThreshold?: number }): Promise<ProcessedDocument> {
  if (!input.bytes.byteLength) throw new Error("CORRUPT_DOCUMENT");
  const raw = { checksum: sha256(input.bytes), byteSize: input.bytes.byteLength };
  if (input.mimeType === "application/pdf") {
    const extractedPages = await input.pdf.extract(input.bytes);
    if (!extractedPages.length) throw new Error("CORRUPT_PDF");
    const ocrPages: OcrPage[] = [];
    const merged: Array<{ page: number; text: string; section: string; method: "text" | "ocr" }> = [];
    for (const page of extractedPages) {
      const density = page.text.trim().length;
      if (density < (input.ocrThreshold ?? 20)) {
        const ocr = await input.ocr.recognize({ fileId: input.fileId, fileVersion: input.fileVersion, page: page.page, bytes: input.bytes });
        ocrPages.push(ocr);
        merged.push({ page: page.page, text: ocr.text, section: page.section ?? "Раздел не определён", method: "ocr" });
      } else merged.push({ page: page.page, text: page.text, section: page.section ?? "Раздел не определён", method: "text" });
    }
    let text = "";
    const boundaries = merged.map((page) => { const start = text.length; text += `${page.text}\n`; return { page: page.page, section: page.section, start, end: start + page.text.length, method: page.method }; });
    return { raw, normalized: { text: text.trimEnd(), boundaries }, extractedPages: structuredClone(extractedPages), ocrPages };
  }
  if (["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"].includes(input.mimeType)) {
    const sections = await input.docx.extract(input.bytes);
    if (!sections.length) throw new Error(input.mimeType === "application/msword" ? "CORRUPT_DOC" : "CORRUPT_DOCX");
    let text = "";
    const boundaries = sections.map((section) => { const start = text.length; text += `${section.text}\n`; return { paragraph: section.paragraph, section: section.section ?? "Раздел не определён", start, end: start + section.text.length, method: "text" as const }; });
    return { raw, normalized: { text: text.trimEnd(), boundaries } };
  }
  throw new Error("UNSUPPORTED_DOCUMENT_TYPE");
}

export function documentLocator(input: { fileId: string; fileVersion: string; artifactId: string; fileName: string; exactText: string; processed: ProcessedDocument; page?: number; paragraph?: number; bbox?: DocumentLocator["bbox"]; confidence?: number }): DocumentLocator {
  const boundary = input.processed.normalized.boundaries.find((item) => (input.page !== undefined && item.page === input.page) || (input.paragraph !== undefined && item.paragraph === input.paragraph));
  if (!boundary) throw new Error("LOCATOR_BOUNDARY_NOT_FOUND");
  const relative = input.processed.normalized.text.slice(boundary.start, boundary.end).indexOf(input.exactText);
  if (relative < 0) throw new Error("LOCATOR_TEXT_NOT_FOUND");
  return { kind: "document", fileId: input.fileId, fileVersion: input.fileVersion, artifactId: input.artifactId, fileName: input.fileName, exactText: input.exactText, page: input.page, paragraph: input.paragraph, section: boundary.section, textSpan: { start: boundary.start + relative, end: boundary.start + relative + input.exactText.length }, bbox: input.bbox, confidence: input.confidence };
}
