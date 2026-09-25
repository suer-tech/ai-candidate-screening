import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfiguration } from "../server/llm/configuration.ts";
import { executeLlmAttempt } from "../server/llm/gateway.ts";
import { matrixResponseSchemaForProfile } from "../server/llm/matrix-response-schema.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../server/llm/protected-store.ts";

test("one-direction ABC assessment sends a provider schema limited to that direction", async (t) => {
  const credential = "synthetic-provider-credential";
  const directionId = "synthetic-abc-autonomy";
  const configuration = validateRuntimeConfiguration({
    releaseVersion: "synthetic-abc-contract-v1",
    providers: { controlled: {
      provider: "synthetic-openai-compatible",
      endpoint: "https://provider.example.invalid/chat/completions",
      secretReference: "provider/synthetic",
      apiContractVersion: "openai-compatible/chat-completions/v1",
      supportsStructuredOutputs: true,
    } },
    capabilities: { abc_matrix_assessment: {
      providerProfile: "controlled",
      model: "synthetic-model",
      promptArtifact: "assess-abc-direction/v2",
      responseSchemaArtifact: "candidate-abc-matrix/v1",
      toolSchemaArtifacts: ["no-tools/v1"],
      generationParameters: { temperature: 0 },
      limits: { maxOutputTokens: 1024 },
      timeoutMs: 5000,
      retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 },
      fallbackPolicy: { mode: "disabled" },
    } },
  }, {
    has: (reference) => reference === "provider/synthetic",
    read: (reference) => reference === "provider/synthetic" ? credential : undefined,
  }, { requiredCapabilities: ["abc_matrix_assessment"] });
  const context = Object.freeze({
    directions: [Object.freeze({ id: directionId, name: "Автономность", gradeA: "Самостоятельно улучшает процесс", gradeB: "Работает самостоятельно", gradeC: "Нуждается в поддержке" })],
    evidence: { claims: [] },
  });
  const baseSchema = configuration.resolve("abc_matrix_assessment").responseSchema;
  const responseSchema = matrixResponseSchemaForProfile("abc_matrix_assessment", baseSchema, context);
  let sentSchema: Record<string, any> | undefined;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_input, init) => {
    sentSchema = JSON.parse(String(init?.body)).response_format?.json_schema?.schema;
    return new Response(JSON.stringify({
      id: "synthetic-abc-provider-request",
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        schemaVersion: "candidate-abc-matrix/v1",
        directions: [{ directionId, level: "B", definingConditions: ["Работает самостоятельно"],
          coveredConditions: [], evidenceLocatorIds: [], reason: "Синтетический ответ" }],
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await executeLlmAttempt({
    configuration,
    adapter: new OpenAiCompatibleProviderAdapter(),
    protectedStore: new AdminOnlyProtectedTraceStore(new InMemoryProtectedTracePersistence()),
    incidents: { record() {} },
  }, {
    capability: "abc_matrix_assessment",
    responseSchema,
    correlation: { traceId: "synthetic-abc-trace", callId: "synthetic-abc-call", attemptId: "synthetic-abc-attempt",
      attemptNumber: 1, workflowRunId: "synthetic-run", workflowStage: "abc-shard" },
    request: { messages: [{ role: "user", content: context }], toolDefinitions: [] },
    inputSnapshot: { materials: [], context },
  });
  assert.equal((result.response.normalizedOutput as { schemaVersion?: string } | undefined)?.schemaVersion, "candidate-abc-matrix/v1",
    "non-matrix capability must reach the provider and parse its structured response");

  const directionsSchema = sentSchema?.properties?.directions;
  const directionIdSchema = directionsSchema?.items?.properties?.directionId;
  const permittedIds = directionIdSchema?.const !== undefined
    ? [directionIdSchema.const] : directionIdSchema?.enum;
  const violations: string[] = [];
  if (!directionsSchema) violations.push("provider received no directions schema");
  if (directionsSchema?.minItems !== 1 || directionsSchema?.maxItems !== 1) violations.push("directions is not constrained to exactly one item");
  if (JSON.stringify(permittedIds) !== JSON.stringify([directionId])) violations.push("directionId is not constrained to the requested ID");
  assert.deepEqual(violations, [], "one ABC shard must not be able to return another direction or a duplicate");
});
