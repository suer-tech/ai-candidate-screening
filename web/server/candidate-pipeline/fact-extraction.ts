import type { ExecuteLlmAttemptDependencies } from "../llm/gateway.ts";
import type { TraceCorrelation } from "../llm/tracing.ts";
import type { JsonValue } from "../llm/value-utils.ts";
import type { EvidenceFact, EvidenceLocator } from "./types.ts";
import { normalizeCandidateCapabilityOutput } from "./schemas.ts";
import { runLlmCapabilityWithPolicy, type CapabilityBudget } from "./capability-runner.ts";

export class RouterAiFactExtractionAdapter {
  constructor(private readonly dependencies: ExecuteLlmAttemptDependencies, private readonly budget: CapabilityBudget) {}

  async extract(input: { correlation: TraceCorrelation; candidateId: string; inputVersion: string; documentArtifactIds: readonly string[]; transcriptArtifactIds: readonly string[]; locators: Readonly<Record<string, EvidenceLocator>>; structuredContext: JsonValue }) {
    const config = this.dependencies.configuration.resolve("fact_extraction");
    const result = await runLlmCapabilityWithPolicy(this.dependencies, this.budget, {
      capability: "fact_extraction",
      correlation: input.correlation,
      request: { messages: [{ role: "system", content: `${config.prompt.template}\nВерни только структурированный результат, заданный системным response contract.` }, { role: "user", content: { documentArtifactIds: input.documentArtifactIds, transcriptArtifactIds: input.transcriptArtifactIds, locatorIds: Object.keys(input.locators), context: input.structuredContext } }] as JsonValue[], toolDefinitions: [] },
      inputSnapshot: { materials: [...input.documentArtifactIds.map((materialId) => ({ materialId, mediaType: "application/x-normalized-document", content: { artifactId: materialId } })), ...input.transcriptArtifactIds.map((materialId) => ({ materialId, mediaType: "application/x-normalized-transcript", content: { artifactId: materialId } }))], context: { candidateId: input.candidateId, inputVersion: input.inputVersion } },
    });
    const normalized = normalizeCandidateCapabilityOutput("fact_extraction", result.response.normalizedOutput);
    const facts = (normalized.facts as unknown[]).map((item, index): EvidenceFact => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("INVALID_FACT_OUTPUT");
      const value = item as Record<string, unknown>;
      const locatorRef = typeof value.locatorRef === "string" ? value.locatorRef : "";
      const locator = input.locators[locatorRef];
      if (!locator) throw new Error("FACT_LOCATOR_NOT_FOUND");
      if (typeof value.predicate !== "string" || typeof value.value !== "string" || typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) throw new Error("INVALID_FACT_OUTPUT");
      return { id: typeof value.id === "string" ? value.id : `fact-${index + 1}`, subject: input.candidateId, predicate: value.predicate, value: value.value, confidence: value.confidence, significant: value.significant !== false, locator: structuredClone(locator), provenance: { tool: "candidate.evidence-extraction/v1", toolVersion: "1", schemaVersion: "facts/v1", traceId: input.correlation.traceId } };
    });
    return { facts, conflicts: normalized.conflicts as unknown[], traceId: input.correlation.traceId, attempts: result.attempts };
  }
}
