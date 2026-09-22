import assert from "node:assert/strict";
import test from "node:test";
import { taskFailurePolicy } from "../agent-runtime/failure-policy.ts";
import { environmentProjection, type RuntimeConfiguration } from "../configuration/runtime.ts";
import { RESPONSE_SCHEMA_ARTIFACTS } from "../llm/artifacts.ts";
import { LlmProviderAttemptError, structuredResponseFormat, type ProviderAttemptRequest } from "../llm/gateway.ts";
import { OpenAiCompatibleProviderAdapter } from "../llm/openai-compatible-adapter.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../llm/protected-store.ts";
import { loadRuntimeConfiguration } from "../llm/runtime-loader.ts";
import { assertStrictResponseSchema } from "../llm/strict-schema.ts";
import { buildAssessmentJoin } from "./assessment-join.ts";
import { runLlmCapabilityWithPolicy } from "./capability-runner.ts";
import { normalizeMatrixCapabilityOutput, type MatrixCapability } from "./matrix-schemas.ts";

// OPS-003 plus the explicitly approved length-only exception; not a release E2E gate.
const toolKey = "candidate.assessment-join/v1";
const summaryCapability = "matrix_assessment_summary" as MatrixCapability;
const summary = {
  schemaVersion: "candidate-assessment-summary/v1",
  recommendation: "\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u043e\u0432\u0430\u0442\u044c",
  recommendationReason: "Synthetic joined evidence supports the role requirements.",
};

for (const errorClass of ["network", "timeout", "rate_limit", "provider_unavailable", "output_length_exceeded"]) {
  test(`assessment join retries ${errorClass} at 5s/15s and stops at three total attempts`, () => {
    const code = `LLM_CAPABILITY_FAILED:${errorClass}`;
    assert.deepEqual([1, 2, 3, 4].map((attempt) => taskFailurePolicy(toolKey, code, attempt)), [
      { retry: true, delayMs: 5_000, maxAttempts: 3 },
      { retry: true, delayMs: 15_000, maxAttempts: 3 },
      { retry: false, delayMs: 0, maxAttempts: 3 },
      { retry: false, delayMs: 0, maxAttempts: 3 },
    ]);
  });
}

for (const code of [
  "LLM_CAPABILITY_FAILED:incomplete_structured_output",
  "LLM_CAPABILITY_FAILED:invalid_structured_output",
  "LLM_CAPABILITY_FAILED:missing_structured_output",
  "LLM_CAPABILITY_FAILED:invalid_provider_response",
  "LLM_CAPABILITY_FAILED:provider_content_filter",
  "LLM_CAPABILITY_FAILED:provider_refusal",
  "LLM_CAPABILITY_FAILED:authentication",
  "LLM_CAPABILITY_FAILED:provider_request_rejected",
  "INVALID_MATRIX_STRUCTURED_OUTPUT:recommendation",
  "INVALID_MATRIX_STRUCTURED_OUTPUT:recommendationReason",
  "ASSESSMENT_JOIN_EVIDENCE_MISSING",
]) {
  test(`assessment join never retries permanent failure ${code}`, () => {
    for (const attempt of [1, 2, 3]) {
      const actual = taskFailurePolicy(toolKey, code, attempt);
      assert.equal(actual.retry, false);
      assert.equal(actual.delayMs, 0);
    }
  });
}

function providerRequest(): ProviderAttemptRequest {
  return {
    endpoint: "https://synthetic-provider.invalid/v1/chat/completions", credential: "synthetic-only",
    model: "synthetic-model", apiContractVersion: "v1", messages: [], toolDefinitions: [],
    responseFormat: { type: "json_object" }, generationParameters: {}, limits: { maxOutputTokens: 512 }, timeoutMs: 100,
  };
}

for (const [finishReason, errorClass, retryable] of [
  ["length", "output_length_exceeded", true],
  ["content_filter", "provider_content_filter", false],
  ["incomplete", "incomplete_structured_output", false],
] as const) {
  test(`provider finish_reason=${finishReason} becomes ${errorClass}, not fake success`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls += 1;
      // Even parseable output must not make a truncated or blocked completion succeed.
      return Response.json({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(summary) } }] });
    });
    await assert.rejects(new OpenAiCompatibleProviderAdapter().execute(providerRequest()), (error: unknown) => {
      assert.ok(error instanceof LlmProviderAttemptError);
      assert.equal((error.traceError as { class: string }).class, errorClass);
      assert.equal(error.retryable, retryable);
      const policy = taskFailurePolicy(toolKey, `LLM_CAPABILITY_FAILED:${errorClass}`, 1);
      assert.equal(policy.retry, retryable);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("assessment summary normalizes a compact response with no regenerated rows", () => {
  assert.deepEqual(normalizeMatrixCapabilityOutput(summaryCapability, summary), summary);
});

for (const [message, errorClass] of [
  [{ content: "{broken" }, "invalid_structured_output"],
  [{}, "missing_structured_output"],
  [{ refusal: "Synthetic provider refusal", content: JSON.stringify(summary) }, "provider_refusal"],
] as const) {
  test(`provider ${errorClass} is terminal even without a length finish reason`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message }] }));
    await assert.rejects(new OpenAiCompatibleProviderAdapter().execute(providerRequest()), (error: unknown) => {
      assert.ok(error instanceof LlmProviderAttemptError);
      assert.equal((error.traceError as { class: string }).class, errorClass);
      assert.equal(error.retryable, false);
      return true;
    });
  });
}

test("assessment summary provider schema requires exactly the three compact fields", () => {
  const artifact = RESPONSE_SCHEMA_ARTIFACTS[summary.schemaVersion as keyof typeof RESPONSE_SCHEMA_ARTIFACTS];
  assert.ok(artifact, "candidate-assessment-summary/v1 must be a registered response artifact");
  const format = structuredResponseFormat(artifact) as { json_schema: { strict: boolean; schema: { properties: object; required: string[]; additionalProperties: boolean } } };
  const schema = format.json_schema.schema;
  assert.equal(format.json_schema.strict, true);
  assert.deepEqual(Object.keys(schema.properties).sort(), ["recommendation", "recommendationReason", "schemaVersion"]);
  assert.deepEqual([...schema.required].sort(), ["recommendation", "recommendationReason", "schemaVersion"]);
  assert.equal(schema.additionalProperties, false);
  assert.doesNotThrow(() => assertStrictResponseSchema(artifact));
});

test("assessment summary normalization rejects invalid output instead of synthesizing success", () => {
  for (const invalid of [
    { ...summary, rows: [] },
    { ...summary, recommendation: "UNKNOWN" },
    { ...summary, recommendation: [summary.recommendation] },
    { ...summary, recommendationReason: "" },
    { ...summary, recommendationReason: "   " },
    { schemaVersion: summary.schemaVersion, recommendation: summary.recommendation },
    { ...summary, schemaVersion: "candidate-matrix-rows/v2" },
  ]) assert.throws(() => normalizeMatrixCapabilityOutput(summaryCapability, invalid));
});

function joinFixture(): Parameters<typeof buildAssessmentJoin>[0] {
  const quote = "Synthetic candidate delivered the planned release.";
  const evidenceItem = { claimId: "claim-synthetic-1", sourceRef: "source-synthetic/v1:paragraph-2", quote,
    relation: "SUPPORTS" as const, explanation: "Explicit example of delivery." };
  const row = { criterionId: "criterion-synthetic-1", supportingClaimIds: [evidenceItem.claimId], contradictingClaimIds: [],
    checkedSourceIds: [evidenceItem.sourceRef], state: "\u0421\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442" as const,
    reason: "A completed release is evidenced.", conclusion: "Delivery demonstrated.", evidence: [evidenceItem],
    missingData: "", followUpQuestion: "", verificationState: "NOT_REQUIRED" as const };
  return {
    matrixId: "matrix-synthetic-v1", matrix: { profileVersion: "profile-synthetic-v1", criteria: [
      { criterionId: row.criterionId, children: [] }, { criterionId: "criterion-synthetic-2", children: [] },
    ] }, evidenceRef: "artifact://synthetic/evidence-v1",
    evidence: { claimsRef: "artifact://synthetic/claims-v1", claims: [{ claimId: evidenceItem.claimId, text: quote,
      locator: evidenceItem.sourceRef, inputVersion: "input-synthetic-v1", profileVersion: "profile-synthetic-v1" }],
      conflicts: [], unmappedSignals: [{ signalId: "synthetic-strength", type: "STRENGTH", text: "Synthetic additional strength." }] },
    rows: { rows: [row, { ...structuredClone(row), criterionId: "criterion-synthetic-2", verificationState: "PENDING" }],
      coverageSummary: { criterionCount: 2, coveredCount: 2, technicalFallbackCount: 0 },
      warnings: ["SYNTHETIC_ROW_WARNING"], traceRefs: ["trace-synthetic-row-1", "trace-synthetic-row-2"] },
    abc: { directions: [{ directionId: "synthetic-delivery", grade: "A", reason: "Explicit delivery evidence.",
      evidence: [structuredClone(evidenceItem)] }], warnings: ["SYNTHETIC_ABC_WARNING"], traceRefs: ["trace-synthetic-abc"] },
  };
}

function freezeInputs<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeInputs);
    Object.freeze(value);
  }
  return value;
}

test("WF-044 assessment assembly preserves persisted rows, evidence, ABC and pending critical verification", async () => {
  const input = freezeInputs(joinFixture());
  const before = structuredClone(input);
  let calls = 0;
  const result = await buildAssessmentJoin(input, async (capability, context, suffix) => {
    calls += 1;
    assert.equal(capability, "matrix_assessment_summary");
    assert.equal(suffix, "assessment-join");
    assert.deepEqual(context.matrix, before.matrix);
    assert.deepEqual(context.evidence, before.evidence);
    assert.deepEqual(context.preEvaluatedRows, before.rows.rows);
    assert.deepEqual(context.abcDirections, before.abc.directions);
    return { output: structuredClone(summary), traceRef: "trace-synthetic-summary" };
  });
  assert.equal(calls, 1, "the join must not regenerate row or ABC shards");
  assert.equal(result.schemaVersion, "candidate-matrix-rows-bundle/v3");
  assert.equal(result.matrixId, before.matrixId);
  assert.equal(result.evidenceRef, before.evidenceRef);
  assert.deepEqual(result.rows, before.rows.rows);
  assert.deepEqual(result.abcDirections, before.abc.directions);
  assert.deepEqual(result.coverageSummary, before.rows.coverageSummary);
  assert.deepEqual(result.warnings, [...before.rows.warnings!, ...before.abc.warnings!]);
  assert.deepEqual(result.traceRefs, [...before.rows.traceRefs!, ...before.abc.traceRefs!, "trace-synthetic-summary"]);
  assert.equal(result.recommendation, summary.recommendation);
  assert.equal(result.recommendationReason, summary.recommendationReason);
  assert.equal(result.recommendationSchemaVersion, "candidate-assessment-summary/v1");
  assert.equal(result.recommendationPromptVersion, "summarize-matrix-assessment/v1");
  assert.deepEqual(input, before);
});

test("assessment assembly rejects missing evidence before invoking the provider", async () => {
  let calls = 0;
  await assert.rejects(buildAssessmentJoin({ ...joinFixture(), evidenceRef: "" }, async () => {
    calls += 1;
    return { output: summary, traceRef: "trace-must-not-be-used" };
  }), /ASSESSMENT_JOIN_EVIDENCE_MISSING/);
  assert.equal(calls, 0);
});

for (const [name, output] of [
  ["regenerated rows", { ...summary, rows: [{ criterionId: "replacement" }] }],
  ["replaced ABC", { ...summary, abcDirections: [] }],
  ["invalid recommendation", { ...summary, recommendation: "UNKNOWN" }],
  ["non-string recommendation", { ...summary, recommendation: [summary.recommendation] }],
  ["empty rationale", { ...summary, recommendationReason: "   " }],
  ["missing rationale", { schemaVersion: summary.schemaVersion, recommendation: summary.recommendation }],
  ["wrong version", { ...summary, schemaVersion: "candidate-assessment-summary/v999" }],
] as const) {
  test(`assessment assembly fails closed for ${name} without mutating completed inputs`, async () => {
    const input = freezeInputs(joinFixture());
    const before = structuredClone(input);
    let returnedBundle = false;
    await assert.rejects(async () => {
      await buildAssessmentJoin(input, async () => ({ output: structuredClone(output), traceRef: "trace-invalid-summary" }));
      returnedBundle = true;
    }, /(?:INVALID_MATRIX_STRUCTURED_OUTPUT|UNSUPPORTED_MATRIX_SCHEMA_VERSION)/);
    assert.equal(returnedBundle, false);
    assert.deepEqual(input, before);
  });
}

test("assessment assembly propagates provider failure once and safely reuses completed inputs on retry", async () => {
  const input = freezeInputs(joinFixture());
  const before = structuredClone(input);
  const failure = new Error("LLM_CAPABILITY_FAILED:output_length_exceeded");
  let failedCalls = 0;
  await assert.rejects(buildAssessmentJoin(input, async () => {
    failedCalls += 1;
    throw failure;
  }), (error: unknown) => error === failure);
  assert.equal(failedCalls, 1, "durable retry owns retries; assembly must not multiply provider calls");
  assert.deepEqual(input, before);
  const result = await buildAssessmentJoin(input, async () => ({ output: summary, traceRef: "trace-synthetic-retry" }));
  assert.deepEqual(result.rows, before.rows.rows);
  assert.deepEqual(result.abcDirections, before.abc.directions);
  assert.deepEqual(result.traceRefs, [...before.rows.traceRefs!, ...before.abc.traceRefs!, "trace-synthetic-retry"]);
});

function syntheticConfiguration(t: test.TestContext) {
  const previousEnvironment = process.env;
  process.env = { NODE_ENV: "test" };
  t.after(() => { process.env = previousEnvironment; });
  const source: RuntimeConfiguration = {
    root: "synthetic-not-read", readiness: { runtimeEnv: true, credentialDirectory: true, credentialFiles: 9, secretsExposed: 0 },
    values: {
      APP_ORIGIN: "http://127.0.0.1:3000", CANDIDATE_PIPELINE_BUILD_ID: "synthetic-assessment-join-build",
      ROUTERAI_ENDPOINT: "https://synthetic-provider.invalid/v1/chat/completions", ROUTERAI_MODEL: "synthetic-model",
      ROUTERAI_STRUCTURED_OUTPUTS: "true",
      MEDIA_PROCESSOR_URL: "http://127.0.0.1:3001/v1/extract-audio", MEDIA_PROCESSOR_HOST: "127.0.0.1", MEDIA_PROCESSOR_PORT: "3001",
      DOCUMENT_PROCESSOR_URL: "http://127.0.0.1:3002/v1/extract-document", DOCUMENT_PROCESSOR_HOST: "127.0.0.1", DOCUMENT_PROCESSOR_PORT: "3002",
    },
    credentials: {
      "database-url": "postgres://synthetic.invalid/not-used", "google-oauth-client-secret": "synthetic-not-used",
      "google-oauth-keyring.json": "{}", "routerai-api-key": "synthetic-only", "assemblyai-api-key": "synthetic-not-used",
      "telegram-bot-token": "synthetic-not-used", "telegram-recipients.json": "{}", "internal-service-tokens.json": "{}",
      "rabbitmq-password": "synthetic-not-used",
    },
  };
  return loadRuntimeConfiguration(environmentProjection(source), ["matrix_assessment_summary"]);
}

for (const finishReason of ["stop", "length"] as const) {
  test(`production-provisioned summary reaches the strict provider boundary once for ${finishReason}`, async (t) => {
    const configuration = syntheticConfiguration(t);
    const config = configuration.resolve("matrix_assessment_summary");
    assert.equal(config.retryPolicy.maxAttempts, 1);
    assert.equal(config.responseSchema.id, "candidate-assessment-summary");
    assert.equal(config.responseSchema.version, "v1");
    assert.equal(config.prompt.id, "summarize-matrix-assessment");
    assertStrictResponseSchema(config.responseSchema);
    const traces = new InMemoryProtectedTracePersistence();
    let requests = 0;
    let reservations = 0;
    let committed = 0;
    const input = freezeInputs(joinFixture());
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      requests += 1;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.response_format.type, "json_schema");
      assert.equal(body.response_format.json_schema.strict, true);
      assert.deepEqual(Object.keys(body.response_format.json_schema.schema.properties).sort(), ["recommendation", "recommendationReason", "schemaVersion"]);
      assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
      assert.deepEqual([...body.response_format.json_schema.schema.required].sort(), ["recommendation", "recommendationReason", "schemaVersion"]);
      const context = JSON.parse(body.messages[1].content);
      assert.deepEqual(context.preEvaluatedRows, input.rows.rows);
      assert.deepEqual(context.abcDirections, input.abc.directions);
      assert.deepEqual(context.evidence, input.evidence);
      return Response.json({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(summary) } }] });
    });
    const execution = buildAssessmentJoin(input, async (capability, context, suffix) => {
      const result = await runLlmCapabilityWithPolicy({ configuration, adapter: new OpenAiCompatibleProviderAdapter(),
        protectedStore: new AdminOnlyProtectedTraceStore(traces), incidents: { record: () => undefined } },
      { reserve: () => { reservations += 1; }, commit: () => { committed += 1; }, release: () => undefined },
      { capability, correlation: { traceId: "trace-synthetic-gateway", callId: "call-synthetic", attemptId: "attempt-synthetic",
        attemptNumber: 1, workflowRunId: "run-synthetic", workflowStage: suffix },
      request: { messages: [{ role: "system", content: config.prompt.template }, { role: "user", content: JSON.stringify(context) }], toolDefinitions: [] },
      inputSnapshot: { materials: [], context: {} } });
      return { output: result.response.normalizedOutput as Record<string, unknown>, traceRef: "trace-synthetic-gateway:attempt:1" };
    });
    if (finishReason === "stop") {
      const result = await execution;
      assert.equal(result.recommendation, summary.recommendation);
      assert.deepEqual(result.rows, input.rows.rows);
      assert.deepEqual(result.abcDirections, input.abc.directions);
    } else await assert.rejects(execution, /LLM_CAPABILITY_FAILED:output_length_exceeded/);
    assert.equal(requests, 1);
    assert.equal(reservations, 1);
    assert.equal(committed, 1);
    assert.equal(traces.records.size, 1);
  });
}
