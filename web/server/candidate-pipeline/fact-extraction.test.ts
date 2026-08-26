import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfiguration } from "../llm/configuration.ts";
import type { LlmProviderAdapter } from "../llm/gateway.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../llm/protected-store.ts";
import { RouterAiFactExtractionAdapter } from "./fact-extraction.ts";

test("fact extraction binds every fact to supplied locator and protected trace", async () => {
  const configuration = validateRuntimeConfiguration({ releaseVersion: "test", providers: { router: { provider: "routerai", endpoint: "https://router.invalid/v1", secretReference: "KEY", apiContractVersion: "v1", supportsStructuredOutputs: true } }, capabilities: { fact_extraction: { providerProfile: "router", model: "controlled", promptArtifact: "fact-extraction/v1", responseSchemaArtifact: "facts/v1", toolSchemaArtifacts: ["no-tools/v1"], generationParameters: {}, limits: {}, timeoutMs: 100, retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 }, fallbackPolicy: { mode: "disabled" } } } }, { has: () => true, read: () => "secret" }, { requiredCapabilities: ["fact_extraction"] });
  const output = { schemaVersion: "facts/v1", facts: [{ id: "fact-1", predicate: "experience", value: "yes", confidence: 0.9, significant: true, locatorRef: "locator-1" }], conflicts: [] };
  const provider: LlmProviderAdapter = { execute: async () => ({ rawEnvelope: output, assistantMessages: [], normalizedOutput: output, toolEvents: [] }) };
  const adapter = new RouterAiFactExtractionAdapter({ configuration, adapter: provider, protectedStore: new AdminOnlyProtectedTraceStore(new InMemoryProtectedTracePersistence()), incidents: { record: () => undefined } }, { reserve: () => undefined, commit: () => undefined, release: () => undefined });
  const result = await adapter.extract({ correlation: { traceId: "trace-facts", callId: "call", attemptId: "attempt", attemptNumber: 1, workflowRunId: "run", workflowStage: "facts" }, candidateId: "candidate-1", inputVersion: "input-1", documentArtifactIds: ["document-1"], transcriptArtifactIds: ["transcript-1"], locators: { "locator-1": { kind: "document", fileId: "resume", fileVersion: "1", artifactId: "document-1", fileName: "resume.pdf", exactText: "есть опыт", page: 1 } }, structuredContext: {} });
  assert.equal(result.facts[0].locator.artifactId, "document-1"); assert.equal(result.facts[0].provenance.traceId, "trace-facts");
});
