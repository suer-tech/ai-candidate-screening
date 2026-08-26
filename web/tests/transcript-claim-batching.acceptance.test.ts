import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectGlobalClaimConflicts } from "../server/candidate-pipeline/matrix-driven.ts";

type ClaimBatch = Readonly<{
  batchId: string;
  order: number;
  request: unknown;
}>;

type BuildClaimBatches = (input: Readonly<{
  matrix: unknown;
  materials: unknown;
  scope: unknown;
  maxSerializedBytes: number;
  overlapUtterances: number;
}>) => readonly ClaimBatch[];

async function loadBatchBuilder(): Promise<BuildClaimBatches> {
  const moduleUrl = new URL("../server/candidate-pipeline/transcript-claim-batching.ts", import.meta.url);
  const loaded = await import(moduleUrl.href) as Record<string, unknown>;
  assert.equal(
    typeof loaded.buildCriterionClaimExtractionBatches,
    "function",
    "transcript-claim-batching.ts must export buildCriterionClaimExtractionBatches",
  );
  return loaded.buildCriterionClaimExtractionBatches as BuildClaimBatches;
}

function utteranceIds(value: unknown): number[] {
  const matches = JSON.stringify(value).matchAll(/UTT-(\d{4})/g);
  return [...new Set([...matches].map((match) => Number(match[1])))];
}

function occurrenceBatches(batches: readonly ClaimBatch[], utteranceId: number): string[] {
  return batches.filter((batch) => utteranceIds(batch.request).includes(utteranceId)).map((batch) => batch.batchId);
}

test("MDA-CLAIM-BATCH-RED-001: deterministic bounded windows cover a multi-megabyte transcript with Q/A overlap", async () => {
  const buildBatches = await loadBatchBuilder();
  const utterances = Array.from({ length: 320 }, (_, index) => ({
    utteranceId: `UTT-${String(index).padStart(4, "0")}`,
    speaker: index % 2 === 0 ? "interviewer" : "candidate",
    start: index * 2_000,
    end: index * 2_000 + 1_900,
    confidence: 0.99,
    text: [
      `UTT-${String(index).padStart(4, "0")}`,
      index === 0 ? "CONFLICT-SIDE-A: бюджет проекта был 10 млн" : "",
      index === 160 ? "MIDDLE-SENTINEL" : "",
      index === 319 ? "CONFLICT-SIDE-B: бюджет проекта был 20 млн" : "",
      "контекст ".repeat(700),
    ].join(" "),
  }));
  const input = {
    matrix: { matrixId: "matrix-v1", criteria: [{ criterionId: "criterion-budget" }] },
    materials: {
      untrustedCandidateData: true,
      rawLocatorIdentityPreserved: true,
      documents: [{ locator: "resume:1", text: "Краткое резюме" }],
      transcript: { normalized: { utterances } },
    },
    scope: { candidateId: "candidate-1", runId: "run-1", inputVersion: "input-1", profileVersion: "profile-1" },
    maxSerializedBytes: 64 * 1024,
    overlapUtterances: 2,
  } as const;

  assert.ok(Buffer.byteLength(JSON.stringify(input.materials.transcript), "utf8") > 1_000_000, "fixture must remain multi-megabyte scale");
  const first = buildBatches(input);
  const second = buildBatches(input);

  assert.ok(first.length > 1, "multi-megabyte transcript must be split into multiple extraction requests");
  assert.deepEqual(first.map(({ batchId, order }) => ({ batchId, order })), second.map(({ batchId, order }) => ({ batchId, order })), "chunk IDs/order must be stable");
  assert.deepEqual(first.map((batch) => batch.order), first.map((_, index) => index), "batch order must be contiguous and deterministic");
  assert.equal(new Set(first.map((batch) => batch.batchId)).size, first.length, "batch IDs must be unique");

  for (const batch of first) {
    assert.ok(batch.batchId.length > 0, "each extraction batch needs a stable ID");
    assert.ok(
      Buffer.byteLength(JSON.stringify(batch.request), "utf8") <= input.maxSerializedBytes,
      `${batch.batchId} exceeds the configured serialized request budget`,
    );
  }

  const covered = new Set(first.flatMap((batch) => utteranceIds(batch.request)));
  assert.equal(covered.size, utterances.length, "every utterance must be covered by at least one extraction batch");
  assert.ok(covered.has(0), "first transcript fragment was lost");
  assert.ok(covered.has(160), "middle transcript fragment was lost");
  assert.ok(covered.has(319), "last transcript fragment was lost");

  for (let question = 0; question < utterances.length - 1; question += 2) {
    const answer = question + 1;
    assert.ok(
      first.some((batch) => {
        const ids = utteranceIds(batch.request);
        return ids.includes(question) && ids.includes(answer);
      }),
      `question/answer pair UTT-${String(question).padStart(4, "0")}/UTT-${String(answer).padStart(4, "0")} was split without overlap`,
    );
  }
  for (let index = 0; index < utterances.length - 1; index += 1) {
    assert.ok(
      first.some((batch) => {
        const ids = utteranceIds(batch.request);
        return ids.includes(index) && ids.includes(index + 1);
      }),
      `neighboring utterances ${index}/${index + 1} never coexist in a context window`,
    );
  }

  const firstConflictBatches = occurrenceBatches(first, 0);
  const lastConflictBatches = occurrenceBatches(first, 319);
  assert.ok(firstConflictBatches.length > 0 && lastConflictBatches.length > 0, "both conflict sides must be covered");
  assert.equal(firstConflictBatches.some((id) => lastConflictBatches.includes(id)), false, "conflict fixture must span different batches");

  const extractedAcrossBatches = first.flatMap((batch) => {
    const serialized = JSON.stringify(batch.request);
    return [
      ...(serialized.includes("CONFLICT-SIDE-A") ? [{
        claimId: "claim-side-a", candidateId: "candidate-1", runId: "run-1", inputVersion: "input-1", profileVersion: "profile-1",
        author: "candidate", role: "candidate" as const, roleConfidence: 0.99, text: "Бюджет проекта был 10 млн", locator: "UTT-0000",
        provenanceRef: batch.batchId, criterionIds: ["criterion-budget"], sourceClass: "transcript", directness: "direct" as const,
        predicate: "project-budget", value: "10 млн",
      }] : []),
      ...(serialized.includes("CONFLICT-SIDE-B") ? [{
        claimId: "claim-side-b", candidateId: "candidate-1", runId: "run-1", inputVersion: "input-1", profileVersion: "profile-1",
        author: "candidate", role: "candidate" as const, roleConfidence: 0.99, text: "Бюджет проекта был 20 млн", locator: "UTT-0319",
        provenanceRef: batch.batchId, criterionIds: ["criterion-budget"], sourceClass: "transcript", directness: "direct" as const,
        predicate: "project-budget", value: "20 млн",
      }] : []),
    ];
  });
  assert.deepEqual(new Set(extractedAcrossBatches.map((claim) => claim.claimId)), new Set(["claim-side-a", "claim-side-b"]), "claims from first and last batches must both survive aggregation");
  const conflicts = detectGlobalClaimConflicts(extractedAcrossBatches);
  assert.equal(conflicts.length, 1, "a single global pass must detect the cross-batch conflict");
  assert.deepEqual(new Set(conflicts[0].claimIds), new Set(["claim-side-a", "claim-side-b"]), "global conflict must preserve both cross-batch sides");
});

test("MDA-CLAIM-BATCH-RED-002: production extracts every batch then runs one global pass over aggregated claims", () => {
  const source = readFileSync(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  const claimsStart = source.indexOf('toolKey === "candidate.matrix-claims/v1"');
  const evidenceStart = source.indexOf('toolKey === "candidate.matrix-evidence/v1"', claimsStart);
  const rowsStart = source.indexOf('toolKey === "candidate.matrix-rows/v1"', evidenceStart);
  assert.ok(claimsStart >= 0 && evidenceStart > claimsStart && rowsStart > evidenceStart, "matrix claim/evidence branches must exist in order");
  const claimsSource = source.slice(claimsStart, evidenceStart);
  const evidenceSource = source.slice(evidenceStart, rowsStart);

  assert.match(claimsSource, /buildCriterionClaimExtractionBatches\s*\(/, "production must build deterministic bounded extraction batches");
  assert.doesNotMatch(
    claimsSource,
    /call\s*\(\s*["']criterion_claim_extraction["']\s*,\s*\{\s*matrix\s*,\s*materials\s*,/,
    "production must not send the entire transcript materials envelope in one criterion_claim_extraction call",
  );
  assert.match(claimsSource, /(?:for\s*\([^)]*(?:batch|claimBatch)|(?:batch|claimBatch)[\s\S]{0,120}\.map\s*\()/i, "criterion extraction must execute for every planned batch");
  assert.match(claimsSource, /call\s*\(\s*["']criterion_claim_extraction["'][\s\S]{0,240}(?:batch\.request|claimBatch\.request)/, "each model call must receive one bounded batch request");
  assert.match(claimsSource, /(?:flatMap|\.push\s*\(\s*\.\.\.)[\s\S]{0,160}(?:output\.claims|claims)/, "claims from all batches must be aggregated without dropping a batch");

  assert.equal((evidenceSource.match(/call\s*\(\s*["']evidence_consolidation["']/g) ?? []).length, 1, "all batch claims require one unified consolidation stage");
  assert.equal((evidenceSource.match(/call\s*\(\s*["']global_conflict_detection["']/g) ?? []).length, 1, "all batch claims require one global conflict stage");
  assert.match(evidenceSource, /global_conflict_detection[\s\S]{0,220}\bclaims\b/, "global conflict input must contain the aggregated claims bundle");
});
