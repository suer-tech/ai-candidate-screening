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

test("claim batches preserve the source of every interview utterance", () => {
  const batches = buildCriterionClaimExtractionBatches({
    matrix: { criteria: [{ criterionId: "criterion-1", sourceText: "Коммуникация" }] },
    materials: { transcript: { normalized: { utterances: [
      { utteranceId: "file-1:utterance-0", sourceFileId: "file-1", sourceFileVersion: "2", sourceFileName: "Интервью 1.webm", speaker: "A", start: 1_000, end: 2_000, confidence: 0.9, text: "Ответ 1" },
      { utteranceId: "file-2:utterance-0", sourceFileId: "file-2", sourceFileVersion: "3", sourceFileName: "Интервью 2.docx", sourceLine: 7, timingOrigin: "derived-line-order", speaker: "Кандидат", start: 0, end: 1_000, confidence: 1, text: "Ответ 2" },
    ] } } },
    scope: {}, maxContextTokens: 20_000, countContextTokens: (request) => JSON.stringify(request).length, overlapUtterances: 0,
  });
  const serialized = JSON.stringify(batches);
  assert.match(serialized, /"sourceFileId":"file-1"/u);
  assert.match(serialized, /"sourceFileName":"Интервью 2\.docx"/u);
  assert.match(serialized, /"sourceLine":7/u);
});
