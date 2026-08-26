import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfiguration } from "../llm/configuration.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../llm/protected-store.ts";
import type { LlmProviderAdapter } from "../llm/gateway.ts";
import { RouterAiPageOcrAdapter } from "./router-tools.ts";

test("RouterAI OCR uses protected gateway and returns versioned page provenance", async () => {
  const configuration = validateRuntimeConfiguration({ releaseVersion: "test-v1", providers: { router: { provider: "routerai", endpoint: "https://router.invalid/v1/chat/completions", secretReference: "ROUTERAI_API_KEY", apiContractVersion: "openai-compatible/v1", supportsStructuredOutputs: true } }, capabilities: { ocr: { providerProfile: "router", model: "controlled-ocr", promptArtifact: "document-ocr/v1", responseSchemaArtifact: "ocr-page/v1", toolSchemaArtifacts: ["no-tools/v1"], generationParameters: { temperature: 0 }, limits: { maxOutputTokens: 1000 }, timeoutMs: 1000, retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 }, fallbackPolicy: { mode: "disabled" } } } }, { has: () => true, read: () => "server-secret" }, { requiredCapabilities: ["ocr"] });
  const provider: LlmProviderAdapter = { execute: async () => ({ rawEnvelope: {}, assistantMessages: [], parsedOutput: { schemaVersion: "ocr-page/v1", page: 2, text: "Распознанный текст", confidence: 0.91, regions: [{ text: "Распознанный текст", confidence: 0.91, bbox: { x: 1, y: 2, width: 3, height: 4 } }] }, normalizedOutput: { schemaVersion: "ocr-page/v1", page: 2, text: "Распознанный текст", confidence: 0.91, regions: [{ text: "Распознанный текст", confidence: 0.91, bbox: { x: 1, y: 2, width: 3, height: 4 } }] }, actualSchemaVersion: "ocr-page/v1", toolEvents: [] }) };
  const persistence = new InMemoryProtectedTracePersistence();
  const adapter = new RouterAiPageOcrAdapter({ configuration, adapter: provider, protectedStore: new AdminOnlyProtectedTraceStore(persistence), incidents: { record: () => undefined } }, ({ fileId, fileVersion, page }) => ({ traceId: `trace-${fileId}-${page}`, callId: `call-${page}`, attemptId: `attempt-${page}`, attemptNumber: 1, workflowRunId: "run-1", workflowStage: "document-ocr", candidateId: "candidate-1", inputVersion: fileVersion }));
  const result = await adapter.recognize({ fileId: "resume", fileVersion: "1", page: 2, bytes: new Uint8Array([1, 2, 3]) });
  assert.equal(result.schemaVersion, "ocr-page/v1");
  assert.equal(result.rawTraceIdentity, "trace-resume-2");
  assert.equal(result.regions[0].bbox.width, 3);
  assert.equal(persistence.records.has("trace-resume-2"), true);
});
