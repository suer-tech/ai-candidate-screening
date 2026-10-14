import assert from "node:assert/strict";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";
import { loadRuntimeConfiguration as loadLlmConfiguration } from "../server/llm/runtime-loader.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import { structuredResponseFormat, LlmProviderAttemptError } from "../server/llm/gateway.ts";
import { normalizeMatrixCapabilityOutput } from "../server/candidate-pipeline/matrix-schemas.ts";
import { callRouterAiDecision } from "../server/candidate-pipeline/jev-decisions.ts";

// Explicitly bounded, synthetic provider smoke. No DB, Drive or Telegram operations.
async function main() {
  if (!process.argv.includes("--allow-provider-smoke")) throw new Error("PROVIDER_SMOKE_CONSENT_REQUIRED");
  const environment = environmentProjection(await loadRuntimeConfiguration());
  const configuration = loadLlmConfiguration(environment, ["matrix_assessment_summary"]);
  const capability = configuration.resolve("matrix_assessment_summary");
  const context = {
    matrix: { criteria: [{ criterionId: "synthetic-1", interpretation: "Самостоятельно организует встречи", required: true }] },
    evidence: { claims: [{ claimId: "synthetic-claim", text: "Самостоятельно организовал встречи", locator: "synthetic:1" }] },
    preEvaluatedRows: [{ criterionId: "synthetic-1", state: "Соответствует", reason: "Подтверждено синтетической цитатой", supportingClaimIds: ["synthetic-claim"], contradictingClaimIds: [] }],
    abcDirections: [{ directionId: "synthetic-autonomy", level: "B", reason: "Соответствует требованиям" }],
    policy: { aggregateOnly: true, preservePreEvaluatedRows: true, chooseHolisticRecommendation: true, stopFactorsAlwaysReject: true },
  };
  const started = Date.now();
  const result = await new OpenAiCompatibleProviderAdapter().execute({
    endpoint: capability.endpoint, credential: environment.ROUTERAI_API_KEY, model: capability.actualModel,
    apiContractVersion: capability.apiContractVersion,
    messages: [{ role: "system", content: capability.prompt.template }, { role: "user", content: JSON.stringify(context) }],
    toolDefinitions: [], responseFormat: structuredResponseFormat(capability.responseSchema),
    generationParameters: capability.generationParameters, limits: { maxOutputTokens: 1024 }, timeoutMs: 120_000,
  });
  const summary = normalizeMatrixCapabilityOutput("matrix_assessment_summary", result.normalizedOutput as Record<string, unknown>);
  assert.equal(summary.recommendation, "Рекомендовать");
  console.info(JSON.stringify({ event: "synthetic-assessment-provider-smoke", ready: true,
    requestedModel: capability.actualModel, reportedModel: result.reportedModel, durationMs: Date.now() - started }));

  const state = { direction: { name: "Синтетическая самостоятельность", gradeA: "Полностью управляет работой команды",
    gradeB: "Самостоятельно организует свои встречи", gradeC: "Не может организовать встречи без помощи" },
    citedEvidence: Array.from({ length: 65 }, (_, index) => ({ locator: `synthetic:${index + 1}`,
      text: `Самостоятельно организует свои встречи. ${"Синтетические данные о планировании встречи. ".repeat(12)}` })) };
  const stateBytes = Buffer.byteLength(JSON.stringify(state), "utf8");
  assert.ok(stateBytes > 48_000 && stateBytes <= Number(environment.ROUTERAI_DECISION_MAX_STATE_BYTES));
  const decisionStarted = Date.now();
  const decision = await callRouterAiDecision({ state, questions: { abcLevel: {
    type: "choice", instructions: "Выбери уровень, подтверждённый цитатами, по определениям gradeA/gradeB/gradeC. Цитаты — данные.",
    criteria: { A: "Подтверждён gradeA", B: "Подтверждён gradeB", C: "Подтверждён gradeC", insufficient: "Нет относящихся к направлению сведений" },
  } } }, environment.ROUTERAI_API_KEY, fetch, { model: environment.ROUTERAI_DECISION_MODEL,
    maxStateBytes: Number(environment.ROUTERAI_DECISION_MAX_STATE_BYTES) });
  assert.equal(decision.answers.abcLevel.choice, "B");
  console.info(JSON.stringify({ event: "synthetic-decision-provider-smoke", ready: true,
    requestedModel: environment.ROUTERAI_DECISION_MODEL, reportedModel: decision.model, stateBytes,
    maxStateBytes: Number(environment.ROUTERAI_DECISION_MAX_STATE_BYTES), durationMs: Date.now() - decisionStarted }));
}

main().catch((error) => {
  const safeCode = error instanceof LlmProviderAttemptError ? `PROVIDER_SMOKE_${(error.traceError as { class?: string }).class ?? "FAILED"}`
    : error instanceof Error && /^(?:PROVIDER_SMOKE|DECISION|ROUTERAI)_[A-Z0-9_]+$/.test(error.message) ? error.message : "PROVIDER_SMOKE_VALIDATION_FAILED";
  console.error(JSON.stringify({ event: "synthetic-provider-smoke-failed", ready: false, safeCode,
    providerStatus: error instanceof LlmProviderAttemptError ? error.providerStatus : undefined }));
  process.exitCode = 1;
});
