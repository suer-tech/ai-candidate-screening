import assert from "node:assert/strict";
import test from "node:test";
import { environmentProjection } from "../server/configuration/runtime.ts";
import { buildAssessmentJoin } from "../server/candidate-pipeline/assessment-join.ts";
import * as decisions from "../server/candidate-pipeline/jev-decisions.ts";
import { executeLlmAttempt } from "../server/llm/gateway.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import { loadRuntimeConfiguration } from "../server/llm/runtime-loader.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../server/llm/protected-store.ts";

const ASSESSMENT_MODEL = "anthropic/claude-fable-5.1";
const DECISION_MODEL = "perplexity/pplx-decider-v1.1-27b";
const GLOBAL_MODEL = "openai/gpt-5.6-sol";
const decisionQuestion = { abcLevel: { type: "choice" as const, instructions: "Оцени синтетическое направление",
  criteria: { A: "выше ожиданий", B: "соответствует", C: "ниже ожиданий", insufficient: "нет данных" } } };

function syntheticEnvironment(values: Record<string, string> = {}) {
  return {
    values: {
      APP_ORIGIN: "http://127.0.0.1:3000", ROUTERAI_ENDPOINT: "https://provider.example.invalid/v1/chat/completions",
      ROUTERAI_MODEL: GLOBAL_MODEL, ROUTERAI_STRUCTURED_OUTPUTS: "true", CANDIDATE_PIPELINE_BUILD_ID: "synthetic-build",
      MEDIA_PROCESSOR_URL: "http://127.0.0.1:3001/v1/extract-audio", MEDIA_PROCESSOR_HOST: "127.0.0.1", MEDIA_PROCESSOR_PORT: "3001",
      DOCUMENT_PROCESSOR_URL: "http://127.0.0.1:3002/v1/extract-document", DOCUMENT_PROCESSOR_HOST: "127.0.0.1", DOCUMENT_PROCESSOR_PORT: "3002",
      ...values,
    },
    credentials: {
      "database-url": "postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic",
      "internal-service-tokens.json": "{}", "rabbitmq-password": "synthetic-rabbit-password",
      "routerai-api-key": "synthetic-api-key",
    }, root: "/synthetic/config",
  } as never;
}

function choiceResponse(model: string, probabilities: Record<string, number> = { A: 0.01, B: 0.97, C: 0.01, insufficient: 0.01 }) {
  return { model, answers: { abcLevel: { type: "choice", choice: "B", confidence: 0.97, probabilities } } };
}

type DecisionRequest = Parameters<typeof decisions.callRouterAiJev>[0];
type DecisionCall = (request: DecisionRequest, apiKey: string, fetcher?: typeof fetch,
  options?: { model?: string; maxStateBytes?: number }) => ReturnType<typeof decisions.callRouterAiJev>;
const decisionCall = ((decisions as unknown as Record<string, unknown>).callRouterAiDecision ?? decisions.callRouterAiJev) as DecisionCall;

test("runtime routes only holistic recommendation to Fable and ABC Choice to Perplexity by default", () => {
  const previous = process.env;
  try {
    process.env = { NODE_ENV: "test" };
    const projected = environmentProjection(syntheticEnvironment());
    const llm = JSON.parse(projected.LLM_RUNTIME_CONFIG_JSON);
    assert.equal(llm.capabilities.matrix_assessment_summary.model, ASSESSMENT_MODEL);
    assert.deepEqual(llm.capabilities.matrix_assessment_summary.generationParameters, {});
    for (const capability of ["matrix_compiler", "matrix_row_evaluation", "abc_matrix_assessment", "candidate_report_composer"])
      assert.equal(llm.capabilities[capability].model, GLOBAL_MODEL, `${capability} retains the global model`);
    assert.equal(projected.ROUTERAI_DECISION_MODEL, DECISION_MODEL);
    assert.equal(Number(projected.ROUTERAI_DECISION_MAX_STATE_BYTES), 262_144);
    assert.equal((decisions as unknown as Record<string, unknown>).DECISION_MAX_STATE_BYTES, 262_144);
  } finally { process.env = previous; }
});

test("decision context limit is allowlisted and bounded at 1 MiB, while model overrides stay independent", () => {
  const previous = process.env;
  try {
    process.env = { NODE_ENV: "test" };
    const projected = environmentProjection(syntheticEnvironment({
      ROUTERAI_ASSESSMENT_MODEL: `${ASSESSMENT_MODEL}-20261014`,
      ROUTERAI_DECISION_MODEL: `${DECISION_MODEL}-20261014`,
      ROUTERAI_DECISION_MAX_STATE_BYTES: "1048576",
    }));
    const llm = JSON.parse(projected.LLM_RUNTIME_CONFIG_JSON);
    assert.equal(llm.capabilities.matrix_assessment_summary.model, `${ASSESSMENT_MODEL}-20261014`);
    assert.equal(llm.capabilities.abc_matrix_assessment.model, GLOBAL_MODEL);
    assert.equal(projected.ROUTERAI_DECISION_MODEL, `${DECISION_MODEL}-20261014`);
    assert.equal(Number(projected.ROUTERAI_DECISION_MAX_STATE_BYTES), 1_048_576);
    assert.throws(() => environmentProjection(syntheticEnvironment({ ROUTERAI_DECISION_MAX_STATE_BYTES: "1048577" })),
      /ROUTERAI_DECISION_MAX_STATE_BYTES_INVALID/);
  } finally { process.env = previous; }
});

test("a 65-row Cyrillic decision context larger than 55 KiB reaches RouterAI uncut with Perplexity model", async () => {
  const rows = Array.from({ length: 65 }, (_, index) => ({ criterionId: `synthetic-criterion-${index}`,
    state: "Соответствует", reason: `Синтетическое основание ${index}: ${"данные ".repeat(95)}` }));
  const state = { rows, abc: [{ directionId: "synthetic-autonomy", level: "B", reason: "Синтетическое обоснование" }] };
  const stateBytes = Buffer.byteLength(JSON.stringify(state), "utf8");
  assert.ok(stateBytes > 55_000 && stateBytes < 262_144, `fixture must exceed the old 48 KiB limit (${stateBytes})`);
  const request = { state, questions: decisionQuestion };
  let fetchCalls = 0;
  const response = await decisionCall(request, "synthetic-api-key", async (url, init) => {
    fetchCalls += 1;
    assert.equal(url, "https://routerai.ru/api/v1/decisions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, DECISION_MODEL);
    assert.deepEqual(body.state, state, "the application must not truncate later rows or Cyrillic reasons");
    assert.deepEqual(body.questions, decisionQuestion);
    return Response.json(choiceResponse(`${DECISION_MODEL}-20261014`));
  });
  assert.equal(fetchCalls, 1);
  assert.equal(response.model, `${DECISION_MODEL}-20261014`, "the actual dated model identity must survive validation");
  assert.equal(response.answers.abcLevel.choice, "B");
  const traceCreator = ((decisions as unknown as Record<string, unknown>).protectedDecisionTrace ?? decisions.protectedJevTrace) as typeof decisions.protectedJevTrace;
  const trace = traceCreator({ traceId: "synthetic-decision-trace", callId: "synthetic-call", attemptId: "synthetic-attempt",
    attemptNumber: 1, workflowRunId: "synthetic-run", workflowStage: "abc-choice" }, request, response,
  new Date("2026-10-14T00:00:00.000Z"));
  assert.equal(trace.model, `${DECISION_MODEL}-20261014`, "protected provenance retains the exact served model");
});

test("decision input above the configured limit is rejected before an HTTP request", async () => {
  let fetchCalls = 0;
  const request = { state: { syntheticText: "данные ".repeat(12_000) }, questions: decisionQuestion };
  assert.ok(Buffer.byteLength(JSON.stringify(request.state), "utf8") > 65_536);
  await assert.rejects(decisionCall(request, "synthetic-api-key", async () => {
    fetchCalls += 1;
    return Response.json(choiceResponse(DECISION_MODEL));
  }, { maxStateBytes: 65_536 }), /DECISION_CONTEXT_TOO_LARGE/);
  assert.equal(fetchCalls, 0);
});

test("Perplexity Choice rejects wrong model and invalid probability distributions", async () => {
  const request = { state: { direction: "synthetic-autonomy" }, questions: decisionQuestion };
  for (const response of [
    choiceResponse("typesafe/jev-1.13"),
    choiceResponse(DECISION_MODEL, { A: 0.1, B: 0.5, C: 0.1, insufficient: 0.1 }),
    choiceResponse(DECISION_MODEL, { A: 0.01, B: 0.97, C: 0.01 }),
  ]) await assert.rejects(decisionCall(request, "synthetic-api-key", async () => Response.json(response)), /DECISION_RESPONSE_INVALID/);
});

test("Fable summary provider request preserves persisted rows, ABC and provenance without a second recommendation Choice", async () => {
  const previous = process.env;
  let projected: ReturnType<typeof environmentProjection>;
  try { process.env = { NODE_ENV: "test" }; projected = environmentProjection(syntheticEnvironment()); }
  finally { process.env = previous; }
  const configuration = loadRuntimeConfiguration(projected, ["matrix_assessment_summary"]);
  const input: Parameters<typeof buildAssessmentJoin>[0] = {
    matrixId: "synthetic-matrix", matrix: { profileVersion: "synthetic-profile" }, evidenceRef: "artifact://synthetic/evidence",
    evidence: { claimsRef: "artifact://synthetic/claims" },
    rows: { rows: [{ criterionId: "criterion-1", supportingClaimIds: ["claim-1"], contradictingClaimIds: [], checkedSourceIds: ["source-1"],
      state: "Соответствует", reason: "Синтетическое основание", missingData: "", followUpQuestion: "", verificationState: "NOT_REQUIRED" }],
      warnings: [], traceRefs: ["row-trace"] },
    abc: { directions: [{ directionId: "abc-1", level: "B", evidenceLocatorIds: ["claim-1"] }], warnings: [], traceRefs: ["abc-trace"] },
  };
  const before = structuredClone(input);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  let providerBody: Record<string, any> | undefined;
  globalThis.fetch = async (_url, init) => {
    providerCalls += 1;
    providerBody = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      schemaVersion: "candidate-assessment-summary/v1", recommendation: "Рекомендовать",
      recommendationReason: "Синтетическое обоснование рекомендации",
    }) } }] });
  };
  try {
    const result = await buildAssessmentJoin(input, async (capability, context, suffix) => {
      const config = configuration.resolve(capability);
      const attempt = await executeLlmAttempt({ configuration, adapter: new OpenAiCompatibleProviderAdapter(),
        protectedStore: new AdminOnlyProtectedTraceStore(new InMemoryProtectedTracePersistence()), incidents: { record() {} } },
      { capability, correlation: { traceId: "synthetic-fable-trace", callId: "synthetic-call", attemptId: "synthetic-attempt",
        attemptNumber: 1, workflowRunId: "synthetic-run", workflowStage: suffix },
      request: { messages: [{ role: "system", content: config.prompt.template }, { role: "user", content: context }], toolDefinitions: [] },
      inputSnapshot: { materials: [], context } });
      return { output: attempt.response.normalizedOutput as Record<string, unknown>, traceRef: "synthetic-fable-trace" };
    });
    assert.equal(providerCalls, 1);
    assert.equal(providerBody?.model, ASSESSMENT_MODEL);
    assert.ok(!Object.hasOwn(providerBody ?? {}, "temperature"), "Fable's RouterAI request omits unsupported temperature");
    assert.deepEqual(JSON.parse(providerBody?.messages?.[1]?.content).preEvaluatedRows, input.rows.rows);
    assert.equal(result.recommendation, "Рекомендовать");
    assert.equal(result.evidenceRef, input.evidenceRef);
    assert.deepEqual(result.rows, input.rows.rows);
    assert.deepEqual(result.abcDirections, input.abc.directions);
    assert.ok(result.traceRefs.includes("row-trace") && result.traceRefs.includes("abc-trace") && result.traceRefs.includes("synthetic-fable-trace"));
    assert.deepEqual(input, before);
  } finally { globalThis.fetch = originalFetch; }
});
