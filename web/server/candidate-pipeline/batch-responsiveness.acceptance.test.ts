import assert from "node:assert/strict";
import { createServer, get, type ClientRequest } from "node:http";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { getEncoding } from "js-tiktoken";
import * as batching from "./transcript-claim-batching.ts";

/**
 * Independent acceptance author/executor: Codex test-only task, not the implementer.
 * Oracle: owner-approved cooperative batching correction; WF-043 deterministic
 * batching/coverage. Synthetic application-boundary regression, not an E2E claim.
 * Steps/expected results: named tests below; evidence/status: node:test output.
 * Cleanup: timers/sockets/server are closed in finally; loopback only, no providers/secrets.
 */
type Input = Parameters<typeof batching.buildCriterionClaimExtractionBatches>[0];
type Batches = ReturnType<typeof batching.buildCriterionClaimExtractionBatches>;
type Row = Record<string, unknown>;

// The baseline must fail for starvation, not because a proposed export is absent.
const candidate = (batching as typeof batching & {
  buildCriterionClaimExtractionBatchesAsync?: (input: Input) => Promise<Batches>;
}).buildCriterionClaimExtractionBatchesAsync ?? batching.buildCriterionClaimExtractionBatches;

const matrix = {
  schemaVersion: "synthetic-matrix/v1", profileVersion: "synthetic-profile-1",
  criteria: [{ criterionId: "criterion-parent", category: "experience", sourceText: "Synthetic delivery",
    interpretation: "Preserve evidence", hardRequired: true,
    children: [{ criterionId: "criterion-child", sourceText: "Synthetic collaboration" }] }],
};
const scope = { runId: "synthetic-run", inputVersion: "synthetic-input", profileVersion: "synthetic-profile-1" };
const size = (request: Readonly<Row>) => JSON.stringify(request).length;
function input(materials: unknown, overrides: Partial<Input> = {}): Input {
  return { matrix, scope, materials, maxContextTokens: 2_400, countContextTokens: size, overlapUtterances: 2, ...overrides };
}
function utterance(index: number, text = `Synthetic reply ${index}: ${"evidence ".repeat(9)}`) {
  return {
    utteranceId: `synthetic-source-${index % 2}:utterance-${index}`, text,
    speaker: index % 2 ? "interviewer" : "candidate", start: index * 1_000, end: index * 1_000 + 900,
    confidence: 0.97, sourceFileId: `synthetic-source-${index % 2}`, sourceFileVersion: String(index % 2 + 1),
    sourceFileName: `synthetic-interview-${index % 2}.txt`, sourceLine: index + 1, timingOrigin: "derived-line-order",
  };
}
function rows(batch: Batches[number], kind: "documents" | "utterances"): Row[] {
  const materials = batch.request.materials as { documents: Row[]; transcript: { normalized: { utterances: Row[] } } };
  return kind === "documents" ? materials.documents : materials.transcript.normalized.utterances;
}

for (const kind of ["transcript", "documents"] as const) {
  test(`BATCH-RESP-001 ${kind}: heartbeat timer progresses between token counts while building`, async () => {
    let counts = 0;
    let building = true;
    const progress: number[] = [];
    const materials = kind === "transcript"
      ? { transcript: { normalized: { utterances: Array.from({ length: 120 }, (_, i) => utterance(i)) } } }
      : { documents: Array.from({ length: 120 }, (_, i) => ({ artifactId: `synthetic-doc-${i}`, text: `Synthetic document ${i}` })) };
    const timer = setInterval(() => { if (building) progress.push(counts); }, 1);
    try {
      const result = await candidate(input(materials, {
        maxContextTokens: 1_000_000,
        countContextTokens(request) {
          counts += 1;
          // Small bounded CPU slices make real timers due without a multi-second fixture.
          const until = performance.now() + 0.2;
          while (performance.now() < until) { /* synthetic CPU tokenization */ }
          return size(request);
        },
      }));
      building = false;
      assert.ok(result.length > 0);
      assert.ok(counts >= 120, "the fixture must exercise repeated token counts");
      assert.ok(progress.some((count) => count > 0 && count < counts),
        `heartbeat timer must run DURING tokenization, not before/after it; counts=${counts}, observed=${JSON.stringify(progress)}`);
    } finally {
      building = false;
      clearInterval(timer);
    }
  });
}

const documentText = Array.from({ length: 90 }, (_, i) => `synthetic-doc-word-${i} `).join("");
const longReply = Array.from({ length: 120 }, (_, i) => `synthetic-reply-word-${i} `).join("");
const utterances = [utterance(0), utterance(1, longReply), ...Array.from({ length: 12 }, (_, i) => utterance(i + 2))];
const mixedMaterials = {
  syntheticFlag: true,
  documents: { documents: [
    { artifactId: "synthetic-normalized", file: { fileId: "synthetic-pdf", version: "3", name: "synthetic.pdf" },
      processed: { normalized: { text: documentText, boundaries: [
        { start: 0, end: 300, page: 1, section: "Synthetic opening" },
        { start: 300, end: documentText.length, page: 2, section: "Synthetic continuation" },
      ] } } },
    { artifactId: "synthetic-raw", file: { fileId: "synthetic-raw-file", version: "2" },
      text: `RAW_START ${"synthetic raw material ".repeat(100)} RAW_END` },
  ] },
  transcript: { normalized: { utterances } },
};

for (const overlap of [0, 1, 2, 5]) {
  test(`BATCH-RESP-002 exact sync parity: mixed sources, oversized splits, overlap=${overlap}`, async () => {
    const syncCounts: string[] = [];
    const asyncCounts: string[] = [];
    const before = JSON.stringify(mixedMaterials);
    const expected = batching.buildCriterionClaimExtractionBatches(input(mixedMaterials, {
      overlapUtterances: overlap, countContextTokens: (request) => { syncCounts.push(JSON.stringify(request)); return size(request); },
    }));
    const actual = await candidate(input(mixedMaterials, {
      overlapUtterances: overlap, countContextTokens: (request) => { asyncCounts.push(JSON.stringify(request)); return size(request); },
    }));
    assert.deepEqual(actual, expected, "requests, IDs, order, metadata, and overlap must remain byte-equivalent");
    assert.deepEqual(asyncCounts, syncCounts, "all token-count inputs and decisions must retain their exact order");
    assert.equal(JSON.stringify(mixedMaterials), before, "building must not mutate source materials");
    assert.ok(actual.length > 3, "fixture must genuinely split both documents and transcript");
    assert.deepEqual(actual.map((batch) => batch.order), actual.map((_, index) => index));
    assert.equal(new Set(actual.map((batch) => batch.batchId)).size, actual.length);
    for (const batch of actual) {
      assert.equal(size(batch.request), size(expected[batch.order].request), "final token sizes must match the synchronous oracle exactly");
      assert.deepEqual(batch.request.requestedCriterionIds, ["criterion-parent", "criterion-child"]);
    }

    const documents = actual.flatMap((batch) => rows(batch, "documents"));
    for (const source of mixedMaterials.documents.documents) {
      const text = source.processed?.normalized.text ?? source.text!;
      const covered = new Set<number>();
      const parts = documents.filter((row) => row.artifactId === source.artifactId);
      assert.ok(parts.length > 1, "each synthetic document must exercise segmentation/splitting");
      for (const part of parts) {
        const span = part.textSpan as { start: number; end: number };
        assert.equal(part.text, text.slice(span.start, span.end));
        assert.deepEqual(part.file, source.file);
        for (let index = span.start; index < span.end; index += 1) covered.add(index);
      }
      assert.equal(covered.size, text.length, "document spans must cover every source character without loss");
    }
    const emitted = actual.flatMap((batch) => rows(batch, "utterances"));
    for (const source of utterances) {
      const parts = emitted.filter((row) => row.utteranceId === source.utteranceId);
      assert.ok(parts.length > 0, "every utterance must survive batching");
      for (const part of parts) {
        for (const key of ["speaker", "start", "end", "confidence", "sourceFileId", "sourceFileVersion", "sourceFileName", "sourceLine", "timingOrigin"] as const) {
          assert.equal(part[key], source[key], `source metadata ${key} must survive splitting`);
        }
      }
      const uniqueParts = [...new Map(parts.map((part) => [
        (part.utterancePart as { partIndex: number } | undefined)?.partIndex ?? 0, part,
      ])).entries()].sort(([a], [b]) => a - b).map(([, part]) => part);
      let cursor = 0;
      for (const [index, part] of uniqueParts.entries()) {
        const text = part.text as string;
        assert.equal(text, source.text.slice(cursor, cursor + text.length));
        cursor += text.length;
        if (index < uniqueParts.length - 1) cursor -= Math.min(256, Math.max(0, text.length - 1));
      }
      assert.equal(cursor, source.text.length, "split utterances must retain the complete original text");
    }
  });
}

for (const materials of [{}, { documents: [] }, { transcript: { normalized: { utterances: [] } } },
  { transcript: { normalized: { utterances: [{ speaker: "candidate", text: "Synthetic reply without ID" }] } } }]) {
  test(`BATCH-RESP-003 empty/minimal parity: ${JSON.stringify(materials)}`, async () => {
    assert.deepEqual(await candidate(input(materials)), batching.buildCriterionClaimExtractionBatches(input(materials)));
  });
}

const invalidCases: { label: string; value: Input; error: string }[] = [
  { label: "invalid budget", value: input({}, { maxContextTokens: 0 }), error: "MATRIX_CLAIM_BATCH_LIMIT_INVALID" },
  { label: "invalid overlap", value: input({}, { overlapUtterances: -1 }), error: "MATRIX_CLAIM_BATCH_OVERLAP_INVALID" },
  { label: "invalid counter", value: input({}, { countContextTokens: null as unknown as Input["countContextTokens"] }), error: "MATRIX_CLAIM_BATCH_TOKEN_COUNTER_INVALID" },
  { label: "base overflow", value: input({}, { maxContextTokens: 1 }), error: "MATRIX_CLAIM_BATCH_BASE_EXCEEDS_LIMIT" },
  { label: "unsplittable document", value: input({ documents: [{ opaque: true }] }, {
    countContextTokens: (request) => (request.materials as { documents: unknown[] }).documents.length ? 3_000 : 1,
  }), error: "MATRIX_CLAIM_DOCUMENT_SEGMENT_EXCEEDS_LIMIT" },
  { label: "unsplittable utterance", value: input({ transcript: { normalized: { utterances: [{ opaque: true }] } } }, {
    countContextTokens: (request) => (request.materials as { transcript: { normalized: { utterances: unknown[] } } }).transcript.normalized.utterances.length ? 3_000 : 1,
  }), error: "MATRIX_CLAIM_UTTERANCE_EXCEEDS_LIMIT" },
  { label: "counter error", value: input({}, { countContextTokens() { throw new Error("SYNTHETIC_COUNTER_FAILURE"); } }), error: "SYNTHETIC_COUNTER_FAILURE" },
];
for (const { label, value, error } of invalidCases) {
  test(`BATCH-RESP-004 preserves errors: ${label}`, async () => {
    assert.throws(() => batching.buildCriterionClaimExtractionBatches(value), { message: error });
    await assert.rejects(async () => candidate(value), { message: error });
  });
}

test("BATCH-RESP-005 real tokenizer: loopback control response arrives before planning finishes", { timeout: 30_000 }, async () => {
  const encoding = getEncoding("o200k_base");
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  });
  let request: ClientRequest | undefined;
  let finished = false;
  let counts = 0;
  type Observation = { unfinished: boolean; counts: number; status?: number; body?: string; failed?: boolean };
  let received!: (value: Observation) => void;
  const controlResponse = new Promise<Observation>((resolve) => { received = resolve; });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const batches = await candidate(input({ transcript: { normalized: {
      utterances: Array.from({ length: 120 }, (_, index) => utterance(index)),
    } } }, {
      maxContextTokens: 128_000,
      countContextTokens(value) {
        counts += 1;
        if (counts === 3) {
          // Start only after real planning work; a pre-planning response cannot pass.
          request = get({ hostname: "127.0.0.1", port: address.port, path: "/synthetic-control", agent: false }, (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => { body += chunk; });
            response.once("end", () => received({ unfinished: !finished, counts, status: response.statusCode, body }));
            response.once("error", () => received({ unfinished: !finished, counts, failed: true }));
          });
          request.once("error", () => received({ unfinished: !finished, counts, failed: true }));
        }
        return encoding.encode(JSON.stringify(value)).length;
      },
    }));
    finished = true;
    assert.ok(batches.length > 0);
    assert.ok(request, "the control request must have started during tokenization");
    const observation = await controlResponse;
    assert.equal(observation.failed, undefined, "loopback request must complete successfully");
    assert.equal(observation.status, 200);
    assert.deepEqual(JSON.parse(observation.body!), { accepted: true });
    assert.equal(observation.unfinished, true, "HTTP response must be received while planning is unfinished");
    assert.ok(observation.counts >= 3 && observation.counts < counts,
      "further token counts must occur after the HTTP response, not merely a final yield");
  } finally {
    finished = true;
    request?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
