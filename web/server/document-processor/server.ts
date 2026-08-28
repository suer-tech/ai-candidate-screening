import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MammothDocxExtractionAdapter, PdfJsExtractionAdapter } from "../candidate-pipeline/documents.ts";
import { renderCandidatePdf, validateRenderedReportPdf, type ReportModel } from "../candidate-pipeline/reports.ts";

export type DocumentProcessorConfig = { token: string; host: string; port: number; maxInputBytes: number };

export function loadDocumentProcessorConfig(source: NodeJS.ProcessEnv = process.env): DocumentProcessorConfig {
  const token = source.DOCUMENT_PROCESSOR_TOKEN?.trim();
  if (!token || token.length < 32) throw new Error("DOCUMENT_PROCESSOR_TOKEN_MISSING_OR_WEAK");
  const port = Number(source.DOCUMENT_PROCESSOR_PORT ?? 4081);
  const maxInputBytes = Number(source.DOCUMENT_PROCESSOR_MAX_INPUT_BYTES ?? 64 * 1024 * 1024);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DOCUMENT_PROCESSOR_PORT_INVALID");
  if (!Number.isInteger(maxInputBytes) || maxInputBytes < 1) throw new Error("DOCUMENT_PROCESSOR_MAX_INPUT_BYTES_INVALID");
  return { token, host: source.DOCUMENT_PROCESSOR_HOST?.trim() || "127.0.0.1", port, maxInputBytes };
}

function authorized(header: string | undefined, expected: string) {
  const actual = header?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function bytes(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > limit) throw new Error("DOCUMENT_INPUT_TOO_LARGE");
    chunks.push(value);
  }
  if (!length) throw new Error("DOCUMENT_INPUT_EMPTY");
  return new Uint8Array(Buffer.concat(chunks));
}

function json(response: ServerResponse, status: number, body: Record<string, unknown>) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

export function createDocumentProcessorServer(config: DocumentProcessorConfig) {
  return createServer(async (request, response) => {
    if (!authorized(request.headers.authorization, config.token)) return json(response, 401, { code: "DOCUMENT_PROCESSOR_UNAUTHORIZED" });
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ready: true, pdfjs: true, mammoth: true, storesInput: false });
    if (request.method === "POST" && request.url === "/v1/render-candidate-report") {
      try {
        const input = await bytes(request, config.maxInputBytes);
        const payload = JSON.parse(new TextDecoder().decode(input)) as { model?: ReportModel };
        if (!payload.model || payload.model.type !== "candidate-report") throw new Error("CANDIDATE_REPORT_MODEL_INVALID");
        const rendered = await renderCandidatePdf(payload.model);
        const validation = await validateRenderedReportPdf(rendered, payload.model);
        if (!validation.contentOraclePassed) console.info(JSON.stringify({ event: "report-content-oracle-warning", reportType: payload.model.type,
          warningCount: validation.contentOracleWarningCount, warningFingerprints: validation.contentOracleWarningFingerprints }));
        return json(response, 200, { schemaVersion: "rendered-candidate-report/v1", report: { type: payload.model.type,
          checksum: validation.checksum, bytesBase64: Buffer.from(rendered).toString("base64"), contentOraclePassed: validation.contentOraclePassed,
          warningCount: validation.contentOracleWarningCount, contentOracleWarningFingerprints: validation.contentOracleWarningFingerprints } });
      } catch (error) {
        const code = error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message) ? error.message : "REPORT_RENDER_PROCESSOR_FAILED";
        return json(response, 422, { code });
      }
    }
    if (request.method !== "POST" || request.url !== "/v1/extract-document") return json(response, 404, { code: "DOCUMENT_PROCESSOR_ROUTE_NOT_FOUND" });
    try {
      const input = await bytes(request, config.maxInputBytes);
      const mimeType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim();
      if (mimeType === "application/pdf") {
        const pages = await new PdfJsExtractionAdapter().extract(input);
        return json(response, 200, { schemaVersion: "document-extraction/v1", kind: "pdf", pages });
      }
      if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const sections = await new MammothDocxExtractionAdapter().extract(input);
        return json(response, 200, { schemaVersion: "document-extraction/v1", kind: "docx", sections });
      }
      return json(response, 415, { code: "UNSUPPORTED_DOCUMENT_TYPE" });
    } catch (error) {
      const code = error instanceof Error && ["DOCUMENT_INPUT_TOO_LARGE", "DOCUMENT_INPUT_EMPTY", "CORRUPT_PDF", "CORRUPT_DOCX", "PDF_EXTRACTION_RUNTIME_UNAVAILABLE", "DOCX_EXTRACTION_RUNTIME_UNAVAILABLE"].includes(error.message)
        ? error.message : "DOCUMENT_PROCESSOR_FAILED";
      return json(response, code === "DOCUMENT_INPUT_TOO_LARGE" ? 413 : 422, { code });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = loadDocumentProcessorConfig();
  createDocumentProcessorServer(config).listen(config.port, config.host, () => {
    console.log(`Document processor listening on ${config.host}:${config.port}`);
  });
}
