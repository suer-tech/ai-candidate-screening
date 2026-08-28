import type { CandidateMatrixRow, MatrixCriterion } from "./matrix-driven.ts";

export type CoverageEvidence = {
  relation: "SUPPORTS" | "CONTRADICTS" | "CONTEXT";
  quote: string;
  locator: string;
  utteranceIds: string[];
};

export type BatchCoverageEntry = {
  criterionId: string;
  scanResult: "FOUND" | "NOT_FOUND_IN_BATCH";
  evidence: CoverageEvidence[];
};

export function matrixCriterionIds(criteria: readonly MatrixCriterion[]): string[] {
  const result: string[] = [];
  const visit = (items: readonly MatrixCriterion[]) => items.forEach((criterion) => {
    result.push(criterion.criterionId);
    visit(criterion.children);
  });
  visit(criteria);
  return result;
}

export function validateExactCriterionCoverage(requested: readonly string[], returned: readonly BatchCoverageEntry[]) {
  const allowed = new Set(requested);
  const observed = new Set<string>();
  const duplicateIds: string[] = [];
  const unknownIds: string[] = [];
  for (const entry of returned) {
    if (observed.has(entry.criterionId)) duplicateIds.push(entry.criterionId);
    observed.add(entry.criterionId);
    if (!allowed.has(entry.criterionId)) unknownIds.push(entry.criterionId);
  }
  return {
    complete: duplicateIds.length === 0 && unknownIds.length === 0 && requested.every((id) => observed.has(id)),
    missingIds: requested.filter((id) => !observed.has(id)),
    duplicateIds,
    unknownIds,
  };
}

export function deduplicateCoverageEvidence(entries: readonly BatchCoverageEntry[]): BatchCoverageEntry[] {
  const byCriterion = new Map<string, CoverageEvidence[]>();
  for (const entry of entries) {
    const current = byCriterion.get(entry.criterionId) ?? [];
    for (const evidence of entry.evidence) {
      const identity = `${evidence.relation}\u0000${evidence.locator}\u0000${[...evidence.utteranceIds].sort().join(",")}`;
      if (!current.some((item) => `${item.relation}\u0000${item.locator}\u0000${[...item.utteranceIds].sort().join(",")}` === identity)) current.push(evidence);
    }
    byCriterion.set(entry.criterionId, current);
  }
  return [...byCriterion].map(([criterionId, evidence]) => ({ criterionId, scanResult: evidence.length ? "FOUND" : "NOT_FOUND_IN_BATCH", evidence }));
}

export function technicalFallbackRow(criterionId: string, reason = "Не удалось завершить автоматическую оценку этого пункта после точечного повтора."): CandidateMatrixRow {
  return {
    criterionId,
    supportingClaimIds: [],
    contradictingClaimIds: [],
    checkedSourceIds: [],
    state: "Недостаточно данных",
    reason,
    missingData: "Технический fallback: требуется ручная проверка материалов по этому пункту.",
    followUpQuestion: "Уточните соответствие кандидата этому требованию.",
    verificationState: "NOT_REQUIRED",
  };
}
