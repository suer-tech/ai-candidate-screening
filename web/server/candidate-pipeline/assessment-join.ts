import type { CandidateMatrixRow } from "./matrix-driven.ts";
import { normalizeMatrixCapabilityOutput, type MatrixCapability } from "./matrix-schemas.ts";
import { jevDecisionOutcome, type JevChoiceCall } from "./jev-decisions.ts";

interface AssessmentJoinInput {
  matrix: unknown;
  matrixId: string;
  evidenceRef: string;
  evidence: Record<string, unknown>;
  rows: { rows?: CandidateMatrixRow[]; coverageSummary?: unknown; warnings?: string[]; traceRefs?: string[] };
  abc: { directions?: unknown[]; warnings?: string[]; traceRefs?: string[] };
}

type SummaryCall = (capability: MatrixCapability, context: Record<string, unknown>, suffix: string) => Promise<{ output: Record<string, unknown>; traceRef: string }>;

const RECOMMENDATION_KEYS = {
  "Рекомендовать": "recommend",
  "Рекомендовать с оговорками": "caveats",
  "Не рекомендовать": "reject",
  "Недостаточно данных": "insufficient",
} as const;

export async function buildAssessmentJoin(input: AssessmentJoinInput, call: SummaryCall, jevChoice?: JevChoiceCall) {
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
  let jevWarning: string | undefined;
  let jevTraceRef: string | undefined;
  if (jevChoice) {
    const criteriaById = new Map<string, Record<string, unknown>>();
    const matrix = input.matrix && typeof input.matrix === "object" && !Array.isArray(input.matrix) ? input.matrix as Record<string, unknown> : {};
    const visit = (items: unknown) => {
      if (!Array.isArray(items)) return;
      for (const item of items) if (item && typeof item === "object" && !Array.isArray(item)) {
        const criterion = item as Record<string, unknown>;
        if (typeof criterion.criterionId === "string") criteriaById.set(criterion.criterionId, criterion);
        visit(criterion.children);
      }
    };
    visit(matrix.criteria);
    const review = await jevChoice({
      state: {
        rows: (rows.rows ?? []).map((row) => {
          const criterion = criteriaById.get(row.criterionId) ?? {};
          return { criterionId: row.criterionId, requirement: criterion.interpretation, category: criterion.category,
            required: criterion.required, hardRequired: criterion.hardRequired, state: row.state,
            reason: row.reason, conclusion: row.conclusion, missingData: row.missingData,
            citedClaimCount: row.supportingClaimIds.length + row.contradictingClaimIds.length };
        }),
        abc: (abc.directions ?? []).map((value) => {
          const direction = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
          return { directionId: direction.directionId, level: direction.level, reason: direction.reason };
        }),
      },
      questions: { recommendation: {
        type: "choice",
        instructions: "Какую итоговую HR-рекомендацию подтверждают уже проверенные строки матрицы и ABC? Не игнорируй обязательные критерии и подтверждённые стоп-факторы. Не предполагай отсутствующие доказательства.",
        criteria: {
          recommend: "Рекомендовать: все существенные требования подтверждены, существенных рисков нет.",
          caveats: "Рекомендовать с оговорками: есть ограничения или риски, но они не требуют отказа.",
          reject: "Не рекомендовать: подтверждённый стоп-фактор или существенное несоответствие.",
          insufficient: "Недостаточно данных: по существенным обязательным условиям нет подтверждения для решения.",
        },
      } },
    });
    if (!review.answers?.recommendation) throw new Error("JEV_RESPONSE_INVALID");
    jevTraceRef = review.traceRef;
    const outcome = jevDecisionOutcome(review.answers.recommendation,
      RECOMMENDATION_KEYS[summary.recommendation as keyof typeof RECOMMENDATION_KEYS], "RECOMMENDATION");
    if (outcome === "UNCERTAIN") jevWarning = "JEV_RECOMMENDATION_UNCERTAIN";
  }
  // The model never supplies replacement rows or ABC decisions at this boundary.
  return {
    schemaVersion: "candidate-matrix-rows-bundle/v3", matrixId: input.matrixId,
    evidenceRef: input.evidenceRef, rows: rows.rows ?? [], abcDirections: abc.directions ?? [],
    recommendation: summary.recommendation, recommendationReason: summary.recommendationReason,
    recommendationPromptVersion: "summarize-matrix-assessment/v1",
    recommendationSchemaVersion: "candidate-assessment-summary/v1",
    coverageSummary: rows.coverageSummary,
    warnings: [...(rows.warnings ?? []), ...(abc.warnings ?? []), ...(jevWarning ? [jevWarning] : [])],
    traceRefs: [...(rows.traceRefs ?? []), ...(abc.traceRefs ?? []), holistic.traceRef, ...(jevTraceRef ? [jevTraceRef] : [])],
  };
}
