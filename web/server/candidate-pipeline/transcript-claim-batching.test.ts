import assert from "node:assert/strict";
import test from "node:test";
import { buildCriterionClaimExtractionBatches } from "./transcript-claim-batching.ts";

test("an oversized single utterance is losslessly windowed instead of rejecting the full transcript", () => {
  const text = `FIRST ${"длинная реплика ".repeat(8_000)} LAST`;
  const countContextTokens = (request: Readonly<Record<string, unknown>>) => JSON.stringify(request).length;
  const batches = buildCriterionClaimExtractionBatches({
    matrix: { criteria: [{ criterionId: "criterion-1", sourceText: "Коммуникация" }] },
    materials: { transcript: { normalized: { utterances: [{ speaker: "candidate", start: 1_000, end: 90_000, confidence: 0.98, text }] } } },
    scope: { candidateId: "candidate-1", runId: "run-1", inputVersion: "input-1", profileVersion: "profile-1" },
    maxContextTokens: 16 * 1024,
    countContextTokens,
    overlapUtterances: 1,
  });
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => countContextTokens(batch.request) <= 16 * 1024));
  const serialized = batches.map((batch) => JSON.stringify(batch.request));
  assert.ok(serialized.some((value) => value.includes("FIRST")));
  assert.ok(serialized.some((value) => value.includes("LAST")));
  for (const value of serialized) {
    assert.match(value, /"speaker":"candidate"/);
    assert.match(value, /"start":1000/);
    assert.match(value, /"end":90000/);
    assert.match(value, /"confidence":0\.98/);
  }
});
