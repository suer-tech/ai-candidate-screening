import type { CandidateMatrixRow } from "./matrix-driven.ts";
import { normalizeMatrixCapabilityOutput, type MatrixCapability } from "./matrix-schemas.ts";

interface AssessmentJoinInput {
  matrix: unknown;
  matrixId: string;
  evidenceRef: string;
  evidence: Record<string, unknown>;
  rows: { rows?: CandidateMatrixRow[]; coverageSummary?: unknown; warnings?: string[]; traceRefs?: string[] };
  abc: { directions?: unknown[]; warnings?: string[]; traceRefs?: string[] };
}

type SummaryCall = (capability: MatrixCapability, context: Record<string, unknown>, suffix: string) => Promise<{ output: Record<string, unknown>; traceRef: string }>;

export async function buildAssessmentJoin(input: AssessmentJoinInput, call: SummaryCall) {
  if (!input.evidenceRef) throw new Error("ASSESSMENT_JOIN_EVIDENCE_MISSING");
  const { rows, abc } = input;
  const holistic = await call("matrix_assessment_summary", {
    matrix: input.matrix, evidence: input.evidence,
    preEvaluatedRows: rows.rows ?? [], abcDirections: abc.directions ?? [],
    policy: { aggregateOnly: true, preservePreEvaluatedRows: true, chooseHolisticRecommendation: true,
      allowedRecommendations: ["Рекомендовать", "Рекомендовать с оговорками", "Не рекомендовать", "Недостаточно данных"],
      stopFactorsAlwaysReject: true, materialNonStopGapsMayReject: true },
  }, "assessment-join");
  const summary = normalizeMatrixCapabilityOutput("matrix_assessment_summary", holistic.output);
  // The model never supplies replacement rows or ABC decisions at this boundary.
  return {
    schemaVersion: "candidate-matrix-rows-bundle/v3", matrixId: input.matrixId,
    evidenceRef: input.evidenceRef, rows: rows.rows ?? [], abcDirections: abc.directions ?? [],
    recommendation: summary.recommendation, recommendationReason: summary.recommendationReason,
    recommendationPromptVersion: "summarize-matrix-assessment/v1",
    recommendationSchemaVersion: "candidate-assessment-summary/v1",
    coverageSummary: rows.coverageSummary,
    warnings: [...(rows.warnings ?? []), ...(abc.warnings ?? [])],
    traceRefs: [...(rows.traceRefs ?? []), ...(abc.traceRefs ?? []), holistic.traceRef],
  };
}
