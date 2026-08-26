import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { groundStructuredAssessment } from "../server/candidate-pipeline/production-runtime.ts";
import { runLlmCapabilityWithPolicy } from "../server/candidate-pipeline/capability-runner.ts";
import { normalizeCandidateCapabilityOutput } from "../server/candidate-pipeline/schemas.ts";
import { environmentProjection, loadRuntimeConfiguration as loadUnifiedConfiguration } from "../server/configuration/runtime.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../server/llm/protected-store.ts";
import { loadRuntimeConfiguration } from "../server/llm/runtime-loader.ts";

const workspace = process.cwd();
const environment = environmentProjection(await loadUnifiedConfiguration(workspace));
const configuration = loadRuntimeConfiguration(environment, ["assessment"]);
const effective = configuration.resolve("assessment");
const persistence = new InMemoryProtectedTracePersistence();
const incidents: unknown[] = [];
let calls = 0;
const executionId = randomUUID();
const evidence = {
  schemaVersion: "evidence-bundle/v1",
  facts: [{ id: "synthetic-fact-1", predicate: "required_experience", value: "Synthetic candidate maintained a TypeScript service for two years.", confidence: 1, significant: true, locatorRef: "synthetic-locator-1" }],
  conflicts: [],
};
const profile = {
  schemaVersion: "vacancy-profile/v1",
  title: "Synthetic TypeScript engineer",
  criteria: [{ id: "criterion-1", label: "TypeScript service experience", required: true }],
  abcDefinitions: { A: "Directly supported required experience", B: "Partially supported", C: "Unsupported" },
  stopFactors: [],
};

const result = await runLlmCapabilityWithPolicy({
  configuration,
  adapter: new OpenAiCompatibleProviderAdapter(),
  protectedStore: new AdminOnlyProtectedTraceStore(persistence),
  incidents: { record: (incident) => { incidents.push(incident); } },
}, {
  reserve(amount) {
    calls += amount.llmCalls ?? 0;
    if (calls > 3) throw new Error("BUDGET_LLM_CALLS_EXHAUSTED");
  },
  commit() {},
  release() {},
}, {
  capability: "assessment",
  correlation: { traceId: `assessment-smoke-${executionId}`, callId: `call-${executionId}`, attemptId: `attempt-${executionId}`, attemptNumber: 1, workflowRunId: `run-${executionId}`, workflowStage: "assessment-smoke" },
  request: {
    messages: [
      { role: "system", content: `${effective.prompt.template}\nReturn only JSON matching this schema exactly: ${JSON.stringify(effective.responseSchema.schema)}` },
      { role: "user", content: { evidence, profile, responseSchema: effective.responseSchema.id } },
    ],
    toolDefinitions: [],
  },
  inputSnapshot: { materials: [{ materialId: "synthetic-evidence", mediaType: "application/x-evidence-graph", content: evidence }], context: profile },
});

const normalized = normalizeCandidateCapabilityOutput("assessment", result.response.normalizedOutput);
groundStructuredAssessment(normalized, evidence.facts);
if (normalized.schemaVersion !== "assessment/v1") throw new Error("ASSESSMENT_SMOKE_SCHEMA_MISMATCH");
if (!result.trace.persisted || persistence.records.size !== 1 || incidents.length !== 0) throw new Error("ASSESSMENT_SMOKE_TRACE_INCOMPLETE");
const evidenceDirectory = resolve(workspace, ".runtime", "evidence");
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(resolve(evidenceDirectory, "routerai-assessment-smoke.json"), `${JSON.stringify({
  schemaVersion: "routerai-assessment-smoke/v1",
  capturedAtUtc: new Date().toISOString(),
  environment: "local",
  providerMode: "real",
  capability: "assessment",
  responseSchemaVersion: normalized.schemaVersion,
  attempts: result.attempts,
  protectedTracePersisted: true,
  evidenceGroundingVerified: true,
  containsCredentials: false,
  containsPersonalData: false,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ready: true, provider: "routerai", capability: "assessment", attempts: result.attempts, protectedTracePersisted: true, personalData: false, secretsExposed: 0 }));
