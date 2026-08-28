import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfiguration } from "../llm/configuration.ts";
import { LlmProviderAttemptError, type LlmProviderAdapter } from "../llm/gateway.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../llm/protected-store.ts";
import { runLlmCapabilityWithPolicy } from "./capability-runner.ts";

function configuration(maxAttempts = 3) {
  return validateRuntimeConfiguration({ releaseVersion: "test", providers: { router: { provider: "routerai", endpoint: "https://router.invalid/v1", secretReference: "KEY", apiContractVersion: "v1", supportsStructuredOutputs: true } }, capabilities: { matrix_compiler: { providerProfile: "router", model: "controlled", promptArtifact: "compile-vacancy-matrix/v1", responseSchemaArtifact: "vacancy-matrix-draft/v1", toolSchemaArtifacts: ["no-tools/v1"], generationParameters: {}, limits: { maxInputBytes: 10_000, maxOutputTokens: 1_000 }, timeoutMs: 100, retryPolicy: { maxAttempts, initialBackoffMs: 0, maximumBackoffMs: 0 }, fallbackPolicy: { mode: "disabled" } } } }, { has: () => true, read: () => "secret" }, { requiredCapabilities: ["matrix_compiler"] });
}

const request = { capability: "matrix_compiler" as const, correlation: { traceId: "trace", callId: "call", attemptId: "attempt", attemptNumber: 1, workflowRunId: "run", workflowStage: "matrix" }, request: { messages: [], toolDefinitions: [] }, inputSnapshot: { profile: {}, context: {} } };

test("transient capability failure retries within config and accounts every external call", async () => {
  let calls = 0; let reserved = 0; let committed = 0;
  const traces = new InMemoryProtectedTracePersistence();
  const provider: LlmProviderAdapter = { execute: async () => { calls += 1; if (calls < 3) throw new LlmProviderAttemptError("temporary", { class: "provider_unavailable" }, 503, true); return { rawEnvelope: {}, assistantMessages: [], normalizedOutput: { schemaVersion: "vacancy-matrix-draft/v1", criteria: [] }, toolEvents: [] }; } };
  const result = await runLlmCapabilityWithPolicy({ configuration: configuration(), adapter: provider, protectedStore: new AdminOnlyProtectedTraceStore(traces), incidents: { record: () => undefined } }, { reserve: (amount) => { reserved += amount.llmCalls ?? 0; }, commit: (amount) => { committed += amount.llmCalls ?? 0; }, release: () => undefined }, request);
  assert.equal(result.attempts, 3); assert.equal(reserved, 3); assert.equal(committed, 3);
  assert.deepEqual([...traces.records.keys()], ["trace:attempt:1", "trace:attempt:2", "trace:attempt:3"]);
});

test("auth/config failure is not retried and returns safe error", async () => {
  let calls = 0;
  const provider: LlmProviderAdapter = { execute: async () => { calls += 1; throw new LlmProviderAttemptError("secret provider message", { class: "authentication" }, 401, false); } };
  await assert.rejects(() => runLlmCapabilityWithPolicy({ configuration: configuration(), adapter: provider, protectedStore: new AdminOnlyProtectedTraceStore(new InMemoryProtectedTracePersistence()), incidents: { record: () => undefined } }, { reserve: () => undefined, commit: () => undefined, release: () => undefined }, request), /LLM_CAPABILITY_FAILED:authentication/);
  assert.equal(calls, 1);
});

test("budget denial prevents provider call", async () => {
  let calls = 0;
  const provider: LlmProviderAdapter = { execute: async () => { calls += 1; return { rawEnvelope: {}, assistantMessages: [], toolEvents: [] }; } };
  await assert.rejects(() => runLlmCapabilityWithPolicy({ configuration: configuration(), adapter: provider, protectedStore: new AdminOnlyProtectedTraceStore(new InMemoryProtectedTracePersistence()), incidents: { record: () => undefined } }, { reserve: () => { throw new Error("BUDGET_DENIED:llmCalls"); }, commit: () => undefined, release: () => undefined }, request), /BUDGET_DENIED/);
  assert.equal(calls, 0);
});

test("safe internal phase survives while private diagnostics remain masked", async () => {
  const dependencies = (message: string) => ({
    configuration: configuration(),
    adapter: { execute: async () => { throw new Error(message); } } as LlmProviderAdapter,
    protectedStore: new AdminOnlyProtectedTraceStore(new InMemoryProtectedTracePersistence()),
    incidents: { record: () => undefined },
  });
  const budget = { reserve: () => undefined, commit: () => undefined, release: () => undefined };
  await assert.rejects(() => runLlmCapabilityWithPolicy(dependencies("PROVIDER_BOUNDARY_AUDIT_FAILED"), budget, request), /PROVIDER_BOUNDARY_AUDIT_FAILED/);
  await assert.rejects(() => runLlmCapabilityWithPolicy(dependencies("private database diagnostic"), budget, request), /LLM_CAPABILITY_FAILED:internal/);
});
