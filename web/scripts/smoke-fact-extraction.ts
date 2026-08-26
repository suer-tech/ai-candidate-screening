import path from "node:path";
import { RouterAiFactExtractionAdapter } from "../server/candidate-pipeline/fact-extraction.ts";
import type { CapabilityBudget } from "../server/candidate-pipeline/capability-runner.ts";
import { environmentProjection, loadRuntimeConfiguration as loadUnifiedConfiguration } from "../server/configuration/runtime.ts";
import { InMemoryProtectedTracePersistence, AdminOnlyProtectedTraceStore } from "../server/llm/protected-store.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import { loadRuntimeConfiguration } from "../server/llm/runtime-loader.ts";

const unified = await loadUnifiedConfiguration(path.resolve(import.meta.dirname, ".."));
const environment = environmentProjection(unified);
const budget: CapabilityBudget = { reserve() {}, commit() {}, release() {} };
const adapter = new RouterAiFactExtractionAdapter({
  configuration: loadRuntimeConfiguration(environment, ["fact_extraction"]),
  adapter: new OpenAiCompatibleProviderAdapter(),
  protectedStore: new AdminOnlyProtectedTraceStore(new InMemoryProtectedTracePersistence()),
  incidents: { record() {} },
}, budget);
const locator = {
  kind: "document" as const,
  fileId: "synthetic-file",
  fileVersion: "synthetic-version",
  artifactId: "synthetic-artifact",
  fileName: "synthetic-resume.pdf",
  exactText: "Синтетический кандидат подтвердил рост выручки на двадцать процентов.",
  page: 1,
  section: "Результаты",
  textSpan: { start: 0, end: 70 },
};
try {
  const result = await adapter.extract({
    correlation: { traceId: "synthetic-fact-smoke-trace", callId: "synthetic-fact-smoke-call", attemptId: "synthetic-fact-smoke-attempt", attemptNumber: 1,
      workflowRunId: "synthetic-fact-smoke-run", workflowStage: "fact-extraction", candidateId: "synthetic-candidate", inputVersion: "synthetic-input", profileVersion: "synthetic-profile" },
    candidateId: "synthetic-candidate",
    inputVersion: "synthetic-input",
    documentArtifactIds: ["synthetic-artifact"],
    transcriptArtifactIds: [],
    locators: { "synthetic-locator": locator },
    structuredContext: {
      vacancy: { title: "Руководитель синтетической программы", profile: { "Образ результата": "Подтверждённый измеримый рост выручки" } },
      locators: { "synthetic-locator": locator },
    },
  });
  if (!result.facts.length) throw new Error("FACT_EXTRACTION_SMOKE_EMPTY");
  console.log(JSON.stringify({ ready: true, provider: "routerai", capability: "fact_extraction", attempts: result.attempts, facts: result.facts.length, personalData: false, secretsExposed: 0 }));
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_.-]*(?::[A-Za-z0-9_.-]+)*$/.test(error.message) ? error.message : "FACT_EXTRACTION_SMOKE_FAILED";
  console.error(JSON.stringify({ ready: false, provider: "routerai", capability: "fact_extraction", safeCode: code, personalData: false, secretsExposed: 0 }));
  process.exitCode = 1;
}
