import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as productionRuntime from "../server/candidate-pipeline/production-runtime.ts";

type PromptProjection = {
  facts: Array<Record<string, unknown> & { locator?: Record<string, unknown> }>;
  conflicts: Array<Record<string, unknown>>;
};

const oversizedEvidence = {
  schemaVersion: "evidence-bundle/v1",
  facts: Array.from({ length: 87 }, (_, index) => ({
    id: `fact-${String(index + 1).padStart(3, "0")}`,
    predicate: index % 2 ? "competency:contract-review" : "abc:productivity",
    value: index % 3 ? "Подтверждено" : "Частично подтверждено",
    confidence: 0.91,
    significant: index % 5 === 0,
    sourceType: index % 2 ? "transcript" : "document",
    locator: index % 2
      ? { kind: "transcript", fileId: "interview", fileVersion: "1", artifactId: "transcript-1", fileName: "interview.mp4", speakerLabel: "Кандидат", startMs: index * 10_000, endMs: index * 10_000 + 8_000, exactText: `QUOTE_${index} ${"Подробная речь кандидата ".repeat(190)}` }
      : { kind: "document", fileId: "resume", fileVersion: "1", artifactId: "resume-1", fileName: "resume.pdf", page: 1 + index % 4, section: "Опыт", exactText: `QUOTE_${index} ${"Подробный фрагмент резюме ".repeat(180)}` },
  })),
  conflicts: Array.from({ length: 30 }, (_, index) => ({ id: `conflict-${index}`, predicate: "competency:contract-review", factIds: [`fact-${String(index + 1).padStart(3, "0")}`, `fact-${String(index + 2).padStart(3, "0")}`], resolved: false, verboseExplanation: "Причина противоречия ".repeat(200) })),
};

test("ASSESSMENT-PROMPT-001: oversized evidence is projected to a bounded provider payload without losing grounding identity", async () => {
  const project = (productionRuntime as unknown as { projectAssessmentEvidenceForPrompt?: (value: typeof oversizedEvidence) => PromptProjection }).projectAssessmentEvidenceForPrompt;
  assert.equal(typeof project, "function", "production exposes the deterministic assessment evidence projection used by the provider request");
  const projected = project!(oversizedEvidence);
  assert.equal(projected.facts.length, oversizedEvidence.facts.length, "all fact identities remain available to the model");
  for (const [index, fact] of projected.facts.entries()) {
    const original = oversizedEvidence.facts[index];
    for (const key of ["id", "predicate", "value", "confidence", "significant"] as const) assert.equal(fact[key], original[key], `${key} is preserved for ${original.id}`);
    assert.ok(fact.locator, `source coordinates remain for ${original.id}`);
    for (const key of ["kind", "fileId", "fileVersion", "artifactId", "fileName"] as const) assert.equal(fact.locator![key], original.locator[key]);
    const quote = String(fact.locator!.quote ?? fact.locator!.exactText ?? "");
    assert.ok(quote.length > 0 && quote.length <= 240, `quote is useful and capped at 240 characters for ${original.id}`);
  }
  assert.equal(projected.conflicts.length, oversizedEvidence.conflicts.length, "all conflict identities remain represented");
  assert.ok(projected.conflicts.every((item) => !Object.hasOwn(item, "verboseExplanation")), "conflicts contain compact IDs/predicate/fact references only");
  assert.ok(Buffer.byteLength(JSON.stringify(projected), "utf8") <= 120 * 1024, "complete projected evidence JSON is at most 120 KB");

  const source = await readFile(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  assert.match(source, /content:\s*\{[^}]*evidence:\s*(?:projected|promptEvidence|assessmentEvidence)/s, "provider user message uses the bounded projection");
  assert.match(source, /groundStructuredAssessment\([^,]+,\s*evidence\.facts\s*\?\?\s*\[\]\)/, "post-response grounding still uses the original full evidence facts");
});
