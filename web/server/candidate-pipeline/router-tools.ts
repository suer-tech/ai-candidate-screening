import { executeLlmAttempt, type ExecuteLlmAttemptDependencies } from "../llm/gateway.ts";
import type { TraceCorrelation } from "../llm/tracing.ts";
import type { JsonValue } from "../llm/value-utils.ts";
import { sha256 } from "./core.ts";
import type { OcrPage, PageOcrAdapter } from "./documents.ts";
import { normalizeCandidateCapabilityOutput } from "./schemas.ts";

function base64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function number(value: unknown, code: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(code);
  return value;
}

export class RouterAiPageOcrAdapter implements PageOcrAdapter {
  constructor(private readonly dependencies: ExecuteLlmAttemptDependencies, private readonly correlation: (input: { fileId: string; fileVersion: string; page: number }) => TraceCorrelation) {}

  async recognize(input: { fileId: string; fileVersion: string; page: number; bytes: Uint8Array }): Promise<OcrPage> {
    const correlation = this.correlation(input);
    const config = this.dependencies.configuration.resolve("ocr");
    const encoded = base64(input.bytes);
    const attempt = await executeLlmAttempt(this.dependencies, {
      capability: "ocr",
      correlation,
      request: {
        messages: [
          { role: "system", content: `${config.prompt.template}\nВерни только структурированный результат, заданный системным response contract.` },
          { role: "user", content: [{ type: "input_image", image_base64: encoded }, { type: "input_text", text: JSON.stringify({ fileId: input.fileId, fileVersion: input.fileVersion, page: input.page, expectedResponseContract: config.responseSchema.id }) }] },
        ] as JsonValue[],
        contentBlocks: [{ mediaType: "application/pdf-page", checksum: sha256(input.bytes), page: input.page, base64: encoded }],
        toolDefinitions: [],
      },
      inputSnapshot: { materials: [{ materialId: `${input.fileId}:${input.fileVersion}:page:${input.page}`, mediaType: "application/pdf-page", content: { checksum: sha256(input.bytes), page: input.page } }], context: { fileId: input.fileId, fileVersion: input.fileVersion, page: input.page } },
    });
    const normalized = normalizeCandidateCapabilityOutput("ocr", attempt.response.normalizedOutput);
    const regions = (normalized.regions as unknown[]).map((region) => {
      if (!region || typeof region !== "object" || Array.isArray(region)) throw new Error("INVALID_STRUCTURED_OUTPUT:ocr:region");
      const value = region as Record<string, unknown>;
      const bbox = value.bbox as Record<string, unknown> | undefined;
      if (typeof value.text !== "string" || !bbox) throw new Error("INVALID_STRUCTURED_OUTPUT:ocr:region");
      return { text: value.text, confidence: number(value.confidence, "INVALID_STRUCTURED_OUTPUT:ocr:region-confidence"), bbox: { x: number(bbox.x, "INVALID_STRUCTURED_OUTPUT:ocr:bbox"), y: number(bbox.y, "INVALID_STRUCTURED_OUTPUT:ocr:bbox"), width: number(bbox.width, "INVALID_STRUCTURED_OUTPUT:ocr:bbox"), height: number(bbox.height, "INVALID_STRUCTURED_OUTPUT:ocr:bbox") } };
    });
    return { page: normalized.page as number, text: normalized.text as string, confidence: normalized.confidence as number, regions, schemaVersion: "ocr-page/v1", instructionVersion: `${config.prompt.id}/${config.prompt.version}`, rawTraceIdentity: correlation.traceId };
  }
}
