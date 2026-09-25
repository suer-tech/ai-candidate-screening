import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfiguration } from "../server/llm/configuration.ts";
import { executeLlmAttempt } from "../server/llm/gateway.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../server/llm/protected-store.ts";

type MatrixCapability = "matrix_compiler" | "matrix_critic";
const credential = "synthetic-test-credential";
const privatePartialResponse = "synthetic-private-partial-matrix";

function runtime(capability: MatrixCapability) {
  const compiler = capability === "matrix_compiler";
  return validateRuntimeConfiguration({
    releaseVersion: "synthetic-matrix-incident-v1",
    providers: { controlled: {
      provider: "synthetic-openai-compatible",
      endpoint: "https://provider.example.invalid/chat/completions",
      secretReference: "provider/synthetic",
      apiContractVersion: "openai-compatible/chat-completions/v1",
      supportsStructuredOutputs: true,
    } },
    capabilities: { [capability]: {
      providerProfile: "controlled",
      model: "synthetic-model",
      promptArtifact: compiler ? "compile-vacancy-matrix/v1" : "critique-vacancy-matrix/v2",
      responseSchemaArtifact: compiler ? "vacancy-matrix-draft/v1" : "vacancy-matrix-critic/v2",
      toolSchemaArtifacts: ["no-tools/v1"],
      generationParameters: { temperature: 0 },
      limits: { maxOutputTokens: 4096 },
      timeoutMs: 5000,
      retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 },
      fallbackPolicy: { mode: "disabled" },
    } },
  }, {
    has: (reference) => reference === "provider/synthetic",
    read: (reference) => reference === "provider/synthetic" ? credential : undefined,
  }, { requiredCapabilities: [capability] });
}

function criterion(missingDataQuestion: string) {
  return {
    temporaryId: "criterion-1",
    sourceRefs: ["vacancy.requirement"],
    sourceText: "Составление редакционного плана",
    interpretation: "Проверить опыт составления редакционного плана",
    category: "competency",
    required: true,
    requiredExplanation: "Требование указано в синтетическом профиле",
    hardRequired: false,
    operator: "ALL_OF",
    atLeast: null,
    evaluationRule: "Есть проверяемый пример редакционного плана",
    expectedEvidence: ["Пример плана"],
    allowedStates: ["Соответствует", "Не соответствует", "Недостаточно данных"],
    decisionEffect: "required-gap",
    missingDataQuestion,
    interpretationNotes: [],
    children: [],
  };
}

function matrixResponse(capability: MatrixCapability, missingDataQuestion: string) {
  const draft = { schemaVersion: "vacancy-matrix-draft/v1", criteria: [criterion(missingDataQuestion)] };
  return capability === "matrix_compiler" ? draft : {
    schemaVersion: "vacancy-matrix-critic/v2",
    decision: "PASS",
    changes: [],
    successor: draft,
    interpretationNotes: [],
  };
}

async function callProvider(capability: MatrixCapability, traceId: string, sourceFragments?: Readonly<Record<string, string>>) {
  const persistence = new InMemoryProtectedTracePersistence();
  const protectedStore = new AdminOnlyProtectedTraceStore(persistence);
  const profileContext = sourceFragments
    ? { profileVersion: "synthetic-profile-v1", sourceFragments }
    : { profileVersion: "synthetic-profile-v1" };
  const context = JSON.parse(JSON.stringify(profileContext));
  const execution = executeLlmAttempt({
    configuration: runtime(capability),
    adapter: new OpenAiCompatibleProviderAdapter(),
    protectedStore,
    incidents: { record() {} },
    clock: () => new Date("2026-09-25T10:00:00.000Z"),
    monotonicClock: (() => { let tick = 0; return () => ++tick; })(),
  }, {
    capability,
    correlation: { traceId, callId: `${traceId}-call`, attemptId: `${traceId}-attempt`, attemptNumber: 1,
      workflowRunId: "synthetic-run", workflowStage: "matrix", profileVersion: "synthetic-profile-v1" },
    request: { messages: [{ role: "user", content: context }], toolDefinitions: [] },
    inputSnapshot: { materials: [], context },
  });
  return { execution, persistence };
}

const syntheticProfiles = [
  Object.freeze({ "vacancy.result.goal": "Составление редакционного плана", "vacancy.skills.editor": "Редакторские навыки" }),
  Object.freeze({ "vacancy.conditions.schedule": "Согласование графика", "vacancy.skills.analysis": "Анализ метрик" }),
];
for (const [index, sourceFragments] of syntheticProfiles.entries()) {
  test(`matrix provider contract derives sourceRefs from immutable synthetic vacancy profile ${index + 1} and rejects an unknown ref`, async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    const unknownRef = "vacancy.private.unconfigured";
    const output = { schemaVersion: "vacancy-matrix-draft/v1", criteria: [criterion("Как проверить этот опыт?")] };
    output.criteria[0].sourceRefs = [unknownRef];
    let providerSchema: Record<string, any> | undefined;
    globalThis.fetch = async (_input, init) => {
      providerSchema = JSON.parse(String(init?.body)).response_format?.json_schema?.schema;
      return new Response(JSON.stringify({
        id: `synthetic-vacancy-${index}`,
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(output) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const traceId = `synthetic-profile-schema-${index}`;
    const { execution, persistence } = await callProvider("matrix_compiler", traceId, sourceFragments);
    const outcome = await Promise.allSettled([execution]);
    const sourceRefItemSchema = providerSchema?.$defs?.criterion?.properties?.sourceRefs?.items;
    assert.ok(sourceRefItemSchema, "the provider must receive a vacancy-derived sourceRef contract");
    assert.deepEqual(new Set(sourceRefItemSchema.enum), new Set(Object.keys(sourceFragments)),
      "allowed source references must come from this immutable profile, not a global schema or another vacancy");
    assert.equal(outcome[0].status, "rejected",
      "the parsed provider answer must not accept a sourceRef absent from this vacancy version");
    assert.equal(persistence.records.get(traceId)?.execution.outcome, "failed");
  });
}

test("length-truncated matrix answer retains the exact provider envelope only in the protected failed trace", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const envelope = {
    id: "synthetic-provider-request",
    model: "synthetic-model",
    choices: [{ finish_reason: "length", message: { role: "assistant", content: privatePartialResponse } }],
    usage: { prompt_tokens: 23, completion_tokens: 4096 },
  };
  globalThis.fetch = async () => new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });

  const { execution, persistence } = await callProvider("matrix_compiler", "synthetic-length-trace");
  await assert.rejects(execution, /length/i);
  const protectedTrace = persistence.records.get("synthetic-length-trace");
  assert.ok(protectedTrace, "failed provider attempt must have a protected trace");
  assert.equal(protectedTrace.execution.outcome, "failed");
  assert.deepEqual(protectedTrace.exchange.response?.rawEnvelope, envelope,
    "a technical administrator needs the exact truncated answer and finish reason to investigate");
  assert.equal(protectedTrace.exchange.response?.finishReason, "length");
  assert.doesNotMatch(JSON.stringify(protectedTrace.execution), /synthetic-private-partial-matrix|synthetic-test-credential/,
    "ordinary safe error metadata must not duplicate private content or credentials");
});

for (const capability of ["matrix_compiler", "matrix_critic"] as const) {
  for (const missingDataQuestion of ["", "   "]) {
    test(`${capability} rejects ${missingDataQuestion ? "whitespace" : "empty"} missingDataQuestion at the structured response boundary`, async (t) => {
      const originalFetch = globalThis.fetch;
      t.after(() => { globalThis.fetch = originalFetch; });
      const output = matrixResponse(capability, missingDataQuestion);
      let suppliedSchema: Record<string, any> | undefined;
      globalThis.fetch = async (_input, init) => {
        suppliedSchema = JSON.parse(String(init?.body)).response_format?.json_schema?.schema;
        return new Response(JSON.stringify({
          id: "synthetic-question-request",
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(output) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      };

      const traceId = `synthetic-question-${capability}-${missingDataQuestion.length}`;
      const { execution, persistence } = await callProvider(capability, traceId);
      await assert.rejects(execution, (error) => error instanceof Error,
        "a required question with no non-whitespace characters is a model contract failure");
      const questionSchema = suppliedSchema?.$defs?.criterion?.properties?.missingDataQuestion;
      assert.ok(questionSchema, "the provider must receive a separate strict matrix response schema");
      assert.equal(questionSchema.type, "string");
      assert.equal(persistence.records.get(traceId)?.execution.outcome, "failed");
    });
  }
}

test("post-provider Pydantic failure preserves the received answer in a failed protected trace", async () => {
  const persistence = new InMemoryProtectedTracePersistence();
  const traceId = "synthetic-pydantic-failure";
  const privateEnvelope = { id: "synthetic-provider-id", answer: "synthetic-private-response" };
  await assert.rejects(executeLlmAttempt({
    configuration: runtime("matrix_compiler"),
    adapter: { async execute() { return { rawEnvelope: privateEnvelope, assistantMessages: [],
      normalizedOutput: matrixResponse("matrix_compiler", "Как проверяли?"), toolEvents: [] }; } },
    protectedStore: new AdminOnlyProtectedTraceStore(persistence),
    incidents: { record() {} },
  }, {
    capability: "matrix_compiler",
    correlation: { traceId, callId: "synthetic-call", attemptId: "synthetic-attempt", attemptNumber: 1,
      workflowRunId: "synthetic-run", workflowStage: "matrix" },
    request: { messages: [], toolDefinitions: [] },
    inputSnapshot: { materials: [], context: {} },
    responseValidator: async () => { throw new Error("MATRIX_CRITERIA_INVALID"); },
  }), /structured output validation failed/);
  const trace = persistence.records.get(traceId);
  assert.equal(trace?.execution.outcome, "failed");
  assert.deepEqual(trace?.exchange.response?.rawEnvelope, privateEnvelope);
  assert.equal((trace?.execution.error as { validationCode?: string }).validationCode, "MATRIX_CRITERIA_INVALID");
});

test("HTTP provider failure preserves its JSON envelope in a protected trace", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const envelope = { error: { message: "synthetic-private-provider-diagnostic" } };
  globalThis.fetch = async () => new Response(JSON.stringify(envelope), { status: 429,
    headers: { "content-type": "application/json", "retry-after": "2" } });
  const traceId = "synthetic-provider-http-failure";
  const { execution, persistence } = await callProvider("matrix_compiler", traceId);
  await assert.rejects(execution, /provider request failed/);
  const trace = persistence.records.get(traceId);
  assert.equal(trace?.execution.outcome, "failed");
  assert.deepEqual(trace?.exchange.response?.rawEnvelope, envelope);
  assert.doesNotMatch(JSON.stringify(trace?.execution), /synthetic-private-provider-diagnostic/);
});
