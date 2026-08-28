import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as batching from "../server/candidate-pipeline/transcript-claim-batching.ts";

const criterionIds = ["criterion-001", "criterion-002", "criterion-003"] as const;
const matrix = {
  schemaVersion: "vacancy-matrix/v1",
  profileVersion: "profile-coverage-ledger-v1",
  criteria: criterionIds.map((criterionId) => ({ criterionId, sourceText: `Source ${criterionId}`, interpretation: `Interpretation ${criterionId}` })),
};

type CoverageEntry = {
  criterionId: string;
  scanResult: "FOUND" | "NOT_FOUND_IN_BATCH";
  evidence: Array<{ evidenceId: string; relation: "SUPPORTS" | "CONTRADICTS" | "CONTEXT"; quote: string; locator: string; utteranceIds?: string[] }>;
};

type CoverageWorkflow = (input: {
  batches: readonly ReturnType<typeof batching.buildCriterionClaimExtractionBatches>[number][];
  criterionIds: readonly string[];
  extract: (request: { batchId: string; requestedCriterionIds: readonly string[]; retry: boolean }) => Promise<{ entries: CoverageEntry[] }>;
  gapSearch: (request: { requestedCriterionIds: readonly string[] }) => Promise<{ entries: CoverageEntry[] }>;
}) => Promise<{ ledger: Array<{ batchId: string; entries: CoverageEntry[] }>; evidence: CoverageEntry["evidence"]; gapSearchCount: number }>;

function batches() {
  return batching.buildCriterionClaimExtractionBatches({
    matrix,
    materials: {
      documents: [{ artifactId: "resume-1", text: "Резюме: самостоятельно организовывал коммуникации и follow-up." }],
      transcript: { normalized: { utterances: [
        { utteranceId: "u-1", speaker: "Интервьюер", start: 0, end: 1_000, text: "Как вы организуете встречи?" },
        { utteranceId: "u-2", speaker: "Кандидат", start: 1_000, end: 4_000, text: "Собираю контекст и готовлю follow-up заранее." },
        { utteranceId: "u-3", speaker: "Интервьюер", start: 4_000, end: 5_000, text: "Приведите ещё пример." },
        { utteranceId: "u-4", speaker: "Кандидат", start: 5_000, end: 8_000, text: "Заранее готовил встречу собственника." },
      ] } },
    },
    scope: { candidateId: "candidate-coverage", runId: "run-coverage", inputVersion: "input-coverage", profileVersion: "profile-coverage-ledger-v1" },
    maxContextTokens: 310,
    countContextTokens: (request) => Math.ceil(JSON.stringify(request).length / 4),
    overlapUtterances: 2,
  });
}

test("MDA-004 RED: every document/transcript batch explicitly requests the exact criterion ID set", () => {
  const generated = batches();
  assert.ok(generated.some((item) => (item.request.batch as { kind?: string }).kind === "document"));
  assert.ok(generated.filter((item) => (item.request.batch as { kind?: string }).kind === "transcript").length >= 2);
  for (const batch of generated) {
    assert.deepEqual(batch.request.requestedCriterionIds, criterionIds, `${batch.batchId} lacks the exact requestedCriterionIds coverage cell`);
  }
});

test("MDA-004 RED: ledger validator rejects duplicate and unknown returned criterion IDs", () => {
  const validate = (batching as unknown as {
    validateCriterionCoverageLedger?: (requested: readonly string[], returned: readonly CoverageEntry[]) => unknown;
  }).validateCriterionCoverageLedger;
  assert.equal(typeof validate, "function", "public deterministic coverage-ledger validation boundary is missing");
  assert.throws(() => validate!(criterionIds, [
    { criterionId: "criterion-001", scanResult: "FOUND", evidence: [] },
    { criterionId: "criterion-001", scanResult: "NOT_FOUND_IN_BATCH", evidence: [] },
    { criterionId: "criterion-unknown", scanResult: "FOUND", evidence: [] },
  ]), /COVERAGE_(?:DUPLICATE|UNKNOWN)_CRITERION/);
});

test("MDA-004/MDA-005 RED: targeted missing-ID retry, overlap dedupe and one zero-criterion gap-search", async () => {
  const runCoverage = (batching as unknown as { runCriterionCoverageWorkflow?: CoverageWorkflow }).runCriterionCoverageWorkflow;
  assert.equal(typeof runCoverage, "function", "public criterion coverage workflow boundary is missing");
  const generated = batches();
  const calls: Array<{ batchId: string; requestedCriterionIds: readonly string[]; retry: boolean }> = [];
  let gapCalls = 0;
  const duplicateEvidence = { evidenceId: "evidence-overlap-u2", relation: "SUPPORTS" as const, quote: "Готовлю follow-up заранее", locator: "transcript:u-2:1000-4000", utteranceIds: ["u-2"] };

  const result = await runCoverage!({
    batches: generated,
    criterionIds,
    async extract(request) {
      calls.push(request);
      if (request.retry) return { entries: request.requestedCriterionIds.map((criterionId) => ({ criterionId, scanResult: "NOT_FOUND_IN_BATCH" as const, evidence: [] })) };
      const entries = request.requestedCriterionIds
        .filter((criterionId) => !(calls.length === 1 && criterionId === "criterion-003"))
        .map((criterionId): CoverageEntry => criterionId === "criterion-001"
          ? { criterionId, scanResult: "FOUND", evidence: [duplicateEvidence] }
          : { criterionId, scanResult: "NOT_FOUND_IN_BATCH", evidence: [] });
      return { entries };
    },
    async gapSearch(request) {
      gapCalls += 1;
      assert.deepEqual(request.requestedCriterionIds, ["criterion-002", "criterion-003"]);
      return { entries: request.requestedCriterionIds.map((criterionId) => ({ criterionId, scanResult: criterionId === "criterion-003" ? "FOUND" as const : "NOT_FOUND_IN_BATCH" as const,
        evidence: criterionId === "criterion-003" ? [{ evidenceId: "gap-evidence-3", relation: "SUPPORTS" as const, quote: "Нашёл упущенный пример", locator: "resume:page-2" }] : [] })) };
    },
  });

  const retries = calls.filter((call) => call.retry);
  assert.equal(retries.length, 1, `expected one targeted missing-ID retry; calls=${JSON.stringify(calls)}`);
  assert.deepEqual(retries[0].requestedCriterionIds, ["criterion-003"], "retry must not repeat already returned IDs or the whole batch");
  assert.equal(result.ledger.length, generated.length, "every source batch remains represented in the ledger");
  assert.ok(result.ledger.every((cell) => cell.entries.length === criterionIds.length), "every completed cell has one FOUND|NOT_FOUND_IN_BATCH entry per criterion");
  assert.equal(result.evidence.filter((item) => item.locator === duplicateEvidence.locator && item.relation === duplicateEvidence.relation).length, 1, "overlap evidence must be deduplicated by criterion/locator/relation");
  assert.equal(gapCalls, 1);
  assert.equal(result.gapSearchCount, 1);
});

test("MDA-004 RED: versioned extraction response schema exposes coverage entries, not claims-only output", () => {
  const source = readFileSync(new URL("../server/llm/artifacts.ts", import.meta.url), "utf8");
  assert.match(source, /"candidate-claims\/v1"[\s\S]{0,500}required:\s*\[[^\]]*"coverage"/);
  assert.match(source, /matrixBatchCoverageSchema[\s\S]{0,500}scanResult[\s\S]{0,200}FOUND[\s\S]{0,100}NOT_FOUND_IN_BATCH/);
  assert.match(source, /matrixBatchCoverageSchema[\s\S]{0,800}SUPPORTS[\s\S]*CONTRADICTS[\s\S]*CONTEXT/);
});
