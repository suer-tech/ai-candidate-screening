import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runLlmCapabilityWithPolicy } from "../server/candidate-pipeline/capability-runner.ts";
import { environmentProjection, loadRuntimeConfiguration as loadUnifiedConfiguration } from "../server/configuration/runtime.ts";
import { normalizeCandidateCapabilityOutput } from "../server/candidate-pipeline/schemas.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import {
  AdminOnlyProtectedTraceStore,
  InMemoryProtectedTracePersistence,
} from "../server/llm/protected-store.ts";
import { loadRuntimeConfiguration } from "../server/llm/runtime-loader.ts";

const workspace = process.cwd();
const runtimeRoot = resolve(workspace, ".runtime");

const environment = environmentProjection(await loadUnifiedConfiguration(workspace));
const configuration = loadRuntimeConfiguration(environment, ["fact_extraction"]);
const effective = configuration.resolve("fact_extraction");
const persistence = new InMemoryProtectedTracePersistence();
const incidents: unknown[] = [];
let reservedCalls = 0;
let committedCalls = 0;
const executionId = randomUUID();

const result = await runLlmCapabilityWithPolicy({
  configuration,
  adapter: new OpenAiCompatibleProviderAdapter(),
  protectedStore: new AdminOnlyProtectedTraceStore(persistence),
  incidents: { record: (incident) => { incidents.push(incident); } },
}, {
  reserve(amount) {
    const calls = amount.llmCalls ?? 0;
    if (reservedCalls + calls > 3) throw new Error("BUDGET_LLM_CALLS_EXHAUSTED");
    reservedCalls += calls;
  },
  commit(amount) { committedCalls += amount.llmCalls ?? 0; },
  release() {},
}, {
  capability: "fact_extraction",
  correlation: {
    traceId: `routerai-smoke-${executionId}`,
    callId: `call-${executionId}`,
    attemptId: `attempt-${executionId}`,
    attemptNumber: 1,
    workflowRunId: `run-${executionId}`,
    workflowStage: "real-model-smoke",
  },
  request: {
    messages: [
      { role: "system", content: `${effective.prompt.template}\nReturn one JSON object only matching this schema exactly: ${JSON.stringify(effective.responseSchema.schema)}` },
      { role: "user", content: "Synthetic evidence: candidate says: 'I maintained a TypeScript service for two years.' Locator id: synthetic-transcript-1:0-4. Return one grounded fact with locatorRef equal to that locator id, or empty arrays if evidence is insufficient." },
    ],
    toolDefinitions: [],
  },
  inputSnapshot: {
    materials: [{ materialId: "synthetic-transcript-1", mediaType: "text/plain", content: "Synthetic non-personal test material" }],
    context: { environment: "local-smoke", containsPersonalData: false },
  },
});

if (!result.response.normalizedOutput || typeof result.response.normalizedOutput !== "object" || Array.isArray(result.response.normalizedOutput)) {
  const envelope = result.response.rawEnvelope && typeof result.response.rawEnvelope === "object" && !Array.isArray(result.response.rawEnvelope)
    ? result.response.rawEnvelope as Record<string, unknown> : {};
  const first = Array.isArray(envelope.choices) && envelope.choices[0] && typeof envelope.choices[0] === "object"
    ? envelope.choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" && !Array.isArray(first.message) ? first.message as Record<string, unknown> : {};
  console.error(JSON.stringify({ diagnostic: "ROUTERAI_ENVELOPE_STRUCTURE", topLevelKeys: Object.keys(envelope).sort(),
    choiceKeys: Object.keys(first).sort(), messageKeys: Object.keys(message).sort(), contentType: Array.isArray(message.content) ? "array" : typeof message.content,
    finishReason: typeof first.finish_reason === "string" ? first.finish_reason : "missing" }));
}
const normalized = normalizeCandidateCapabilityOutput("fact_extraction", result.response.normalizedOutput);
if (normalized.schemaVersion !== "facts/v1") throw new Error("ROUTERAI_SMOKE_SCHEMA_MISMATCH");
if (!result.trace.persisted || persistence.records.size !== 1 || incidents.length !== 0) throw new Error("ROUTERAI_SMOKE_TRACE_INCOMPLETE");
if (committedCalls !== result.attempts || reservedCalls !== result.attempts) throw new Error("ROUTERAI_SMOKE_BUDGET_MISMATCH");

const evidenceDirectory = resolve(runtimeRoot, "evidence");
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(resolve(evidenceDirectory, "routerai-real-model-smoke.json"), `${JSON.stringify({
  schemaVersion: "routerai-real-model-smoke/v1",
  capturedAtUtc: new Date().toISOString(),
  environment: "local",
  providerMode: "real",
  capability: "fact_extraction",
  responseSchemaVersion: normalized.schemaVersion,
  attempts: result.attempts,
  protectedTracePersisted: result.trace.persisted,
  budgetAccountingVerified: true,
  productionLikeAcceptanceClaimed: false,
  containsCredentials: false,
  containsPersonalData: false,
}, null, 2)}\n`, "utf8");

console.log("RouterAI real-model smoke: GREEN");
console.log(`Проверено: structured schema, protected trace, retry/budget accounting; attempts=${result.attempts}.`);
console.log("Ключ, исходный ответ модели и тестовый материал не выводились.");
