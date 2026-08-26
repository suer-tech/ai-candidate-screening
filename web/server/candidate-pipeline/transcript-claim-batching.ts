import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export type CriterionClaimExtractionBatch = Readonly<{
  batchId: string;
  order: number;
  request: Readonly<UnknownRecord>;
}>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function stableId(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function compactCriterion(value: unknown): UnknownRecord | undefined {
  const source = record(value);
  if (!source || typeof source.criterionId !== "string") return undefined;
  const children = Array.isArray(source.children) ? source.children.flatMap((child) => {
    const projected = compactCriterion(child);
    return projected ? [projected] : [];
  }) : [];
  return Object.fromEntries([
    ["criterionId", source.criterionId],
    ["sourceText", source.sourceText],
    ["interpretation", source.interpretation],
    ["evaluationRule", source.evaluationRule],
    ["required", source.required],
    ["hardRequired", source.hardRequired],
    ["decisionEffect", source.decisionEffect],
    ["operator", source.operator],
    ["children", children],
  ].filter(([, item]) => item !== undefined));
}

export function projectMatrixForClaimExtraction(value: unknown) {
  const source = record(value) ?? {};
  return Object.fromEntries([
    ["schemaVersion", source.schemaVersion],
    ["profileVersion", source.profileVersion],
    ["criteria", Array.isArray(source.criteria) ? source.criteria.flatMap((criterion) => {
      const projected = compactCriterion(criterion);
      return projected ? [projected] : [];
    }) : []],
  ].filter(([, item]) => item !== undefined));
}

function documentSegments(value: unknown): unknown[] {
  const bundle = record(value);
  if (bundle && Array.isArray(bundle.documents)) return documentSegments(bundle.documents);
  if (!Array.isArray(value)) return value === undefined ? [] : [value];
  return value.flatMap((document) => {
    const source = record(document);
    const processed = record(source?.processed);
    const normalized = record(processed?.normalized);
    const boundaries = Array.isArray(normalized?.boundaries) ? normalized.boundaries : [];
    const normalizedText = typeof normalized?.text === "string" ? normalized.text : undefined;
    if (!source || !normalizedText || !boundaries.length) return [document];
    return boundaries.flatMap((boundaryValue) => {
      const boundary = record(boundaryValue);
      const start = typeof boundary?.start === "number" ? boundary.start : undefined;
      const end = typeof boundary?.end === "number" ? boundary.end : undefined;
      if (start === undefined || end === undefined || end <= start) return [];
      return [{
        artifactId: source.artifactId,
        file: source.file,
        locator: Object.fromEntries(Object.entries(boundary!).filter(([key]) => !["start", "end"].includes(key))),
        textSpan: { start, end },
        text: normalizedText.slice(start, end),
      }];
    });
  });
}

function makeRequest(input: {
  matrix: unknown;
  scope: unknown;
  flags: UnknownRecord;
  order: number;
  kind: "document" | "transcript" | "empty";
  documents?: readonly unknown[];
  utterances?: readonly unknown[];
}) {
  const batchId = `claim-batch-${stableId({ order: input.order, kind: input.kind, documents: input.documents, utterances: input.utterances, scope: input.scope })}`;
  return {
    batchId,
    order: input.order,
    request: {
      matrix: input.matrix,
      materials: {
        ...input.flags,
        documents: input.documents ?? [],
        transcript: { normalized: { utterances: input.utterances ?? [] } },
      },
      scope: input.scope,
      batch: { batchId, order: input.order, kind: input.kind },
    },
  } satisfies CriterionClaimExtractionBatch;
}

function packDocuments(input: {
  matrix: unknown;
  scope: unknown;
  flags: UnknownRecord;
  segments: readonly unknown[];
  maxContextTokens: number;
  countContextTokens: (request: Readonly<UnknownRecord>) => number;
  startOrder: number;
}) {
  const batches: CriterionClaimExtractionBatch[] = [];
  let current: unknown[] = [];
  const pending = [...input.segments];
  while (pending.length) {
    const segment = pending.shift();
    const candidate = makeRequest({ ...input, order: input.startOrder + batches.length, kind: "document", documents: [...current, segment] });
    if (input.countContextTokens(candidate.request) <= input.maxContextTokens) {
      current.push(segment);
      continue;
    }
    if (!current.length) {
      const source = record(segment);
      const segmentText = typeof source?.text === "string" ? source.text : undefined;
      if (!source || !segmentText) throw new Error("MATRIX_CLAIM_DOCUMENT_SEGMENT_EXCEEDS_LIMIT");
      let low = 1;
      let high = segmentText.length;
      let accepted = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const part = { ...source, text: segmentText.slice(0, middle) };
        const request = makeRequest({ ...input, order: input.startOrder + batches.length, kind: "document", documents: [part] });
        if (input.countContextTokens(request.request) <= input.maxContextTokens) { accepted = middle; low = middle + 1; }
        else high = middle - 1;
      }
      if (!accepted) throw new Error("MATRIX_CLAIM_DOCUMENT_SEGMENT_EXCEEDS_LIMIT");
      const boundary = record(source.textSpan);
      const absoluteStart = typeof boundary?.start === "number" ? boundary.start : 0;
      const part = { ...source, text: segmentText.slice(0, accepted), textSpan: { start: absoluteStart, end: absoluteStart + accepted } };
      batches.push(makeRequest({ ...input, order: input.startOrder + batches.length, kind: "document", documents: [part] }));
      if (accepted < segmentText.length) {
        const overlap = Math.min(256, Math.max(0, accepted - 1));
        const nextStart = accepted - overlap;
        pending.unshift({ ...source, text: segmentText.slice(nextStart), textSpan: { start: absoluteStart + nextStart, end: absoluteStart + segmentText.length } });
      }
      continue;
    }
    batches.push(makeRequest({ ...input, order: input.startOrder + batches.length, kind: "document", documents: current }));
    current = [];
    pending.unshift(segment);
  }
  if (current.length) batches.push(makeRequest({ ...input, order: input.startOrder + batches.length, kind: "document", documents: current }));
  return batches;
}

function packUtterances(input: {
  matrix: unknown;
  scope: unknown;
  flags: UnknownRecord;
  utterances: readonly unknown[];
  maxContextTokens: number;
  countContextTokens: (request: Readonly<UnknownRecord>) => number;
  overlapUtterances: number;
  startOrder: number;
}) {
  const batches: CriterionClaimExtractionBatch[] = [];
  const normalizedUtterances = input.utterances.map((utterance, utteranceIndex) => {
    const source = record(utterance);
    if (!source) return utterance;
    return Object.fromEntries([
      ["utteranceId", source.utteranceId ?? `utterance-${utteranceIndex}`],
      ["speaker", source.speaker],
      ["start", source.start],
      ["end", source.end],
      ["confidence", source.confidence],
      ["text", source.text],
    ].filter(([, value]) => value !== undefined));
  });
  const utterances = normalizedUtterances.flatMap((utterance, utteranceIndex) => {
    const single = makeRequest({ ...input, order: 999_999_999, kind: "transcript", utterances: [utterance] });
    if (input.countContextTokens(single.request) <= input.maxContextTokens) return [utterance];
    const source = record(utterance);
    const utteranceText = typeof source?.text === "string" ? source.text : undefined;
    if (!source || !utteranceText) throw new Error("MATRIX_CLAIM_UTTERANCE_EXCEEDS_LIMIT");
    const parts: unknown[] = [];
    let cursor = 0;
    while (cursor < utteranceText.length) {
      let low = cursor + 1;
      let high = utteranceText.length;
      let accepted = cursor;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const part = { ...source, text: utteranceText.slice(cursor, middle), utterancePart: { sourceIndex: utteranceIndex, partIndex: parts.length } };
        const request = makeRequest({ ...input, order: 999_999_999, kind: "transcript", utterances: [part] });
        if (input.countContextTokens(request.request) <= input.maxContextTokens) { accepted = middle; low = middle + 1; }
        else high = middle - 1;
      }
      if (accepted === cursor) throw new Error("MATRIX_CLAIM_UTTERANCE_EXCEEDS_LIMIT");
      parts.push({ ...source, text: utteranceText.slice(cursor, accepted), utterancePart: { sourceIndex: utteranceIndex, partIndex: parts.length } });
      if (accepted >= utteranceText.length) break;
      const overlap = Math.min(256, Math.max(0, accepted - cursor - 1));
      cursor = Math.max(cursor + 1, accepted - overlap);
    }
    return parts;
  });
  let start = 0;
  while (start < utterances.length) {
    let end = start;
    while (end < utterances.length) {
      const candidate = makeRequest({ ...input, order: input.startOrder + batches.length, kind: "transcript", utterances: utterances.slice(start, end + 1) });
      if (input.countContextTokens(candidate.request) > input.maxContextTokens) break;
      end += 1;
    }
    if (end === start) throw new Error("MATRIX_CLAIM_UTTERANCE_EXCEEDS_LIMIT");
    batches.push(makeRequest({ ...input, order: input.startOrder + batches.length, kind: "transcript", utterances: utterances.slice(start, end) }));
    if (end >= utterances.length) break;
    start = Math.max(start + 1, end - input.overlapUtterances);
  }
  return batches;
}

export function buildCriterionClaimExtractionBatches(input: Readonly<{
  matrix: unknown;
  materials: unknown;
  scope: unknown;
  maxContextTokens: number;
  countContextTokens: (request: Readonly<UnknownRecord>) => number;
  overlapUtterances: number;
}>): readonly CriterionClaimExtractionBatch[] {
  if (!Number.isInteger(input.maxContextTokens) || input.maxContextTokens < 1) throw new Error("MATRIX_CLAIM_BATCH_LIMIT_INVALID");
  if (typeof input.countContextTokens !== "function") throw new Error("MATRIX_CLAIM_BATCH_TOKEN_COUNTER_INVALID");
  if (!Number.isInteger(input.overlapUtterances) || input.overlapUtterances < 0) throw new Error("MATRIX_CLAIM_BATCH_OVERLAP_INVALID");
  const materials = record(input.materials) ?? {};
  const transcript = record(materials.transcript);
  const normalized = record(transcript?.normalized);
  const utterances = Array.isArray(normalized?.utterances) ? normalized.utterances : [];
  const flags = Object.fromEntries(Object.entries(materials).filter(([key]) => !["documents", "transcript"].includes(key)));
  const matrix = projectMatrixForClaimExtraction(input.matrix);
  const empty = makeRequest({ matrix, scope: input.scope, flags, order: 0, kind: "empty" });
  if (input.countContextTokens(empty.request) > input.maxContextTokens) throw new Error("MATRIX_CLAIM_BATCH_BASE_EXCEEDS_LIMIT");

  const documents = packDocuments({ matrix, scope: input.scope, flags, segments: documentSegments(materials.documents), maxContextTokens: input.maxContextTokens,
    countContextTokens: input.countContextTokens, startOrder: 0 });
  const transcriptBatches = packUtterances({ matrix, scope: input.scope, flags, utterances, maxContextTokens: input.maxContextTokens,
    countContextTokens: input.countContextTokens,
    overlapUtterances: input.overlapUtterances, startOrder: documents.length });
  const batches = [...documents, ...transcriptBatches];
  return batches.length ? batches : [empty];
}
