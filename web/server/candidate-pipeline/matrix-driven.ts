import { createHash } from "node:crypto";
import type { Recommendation } from "./types.ts";
import { COVERAGE_FIRST_WORKFLOW_VERSION } from "./recovery-contracts.ts";

export const MATRIX_SCHEMA_VERSION = "vacancy-matrix/v1" as const;
export const MATRIX_WORKFLOW_VERSION = COVERAGE_FIRST_WORKFLOW_VERSION;

export function isMatrixWorkflowVersion(value: string): boolean {
  return value === MATRIX_WORKFLOW_VERSION;
}

export type MatrixOperator = "ALL_OF" | "ANY_OF" | "AT_LEAST_N" | "INFORMATIONAL";
export type MatrixCategory = "required-experience" | "desired-experience" | "competency" | "abc" | "stop-factor" | "access-to-ke" | "risk" | "additional";
export type MatrixDecisionEffect = "stop-factor" | "hard-required" | "required-gap" | "risk" | "caveat" | "informational";
export type MatrixRowState = "Соответствует" | "Не соответствует" | "Подтверждено" | "Частично подтверждено" | "Не подтверждено" | "Недостаточно данных" | "Противоречие источников" | "Не применимо";

export type MatrixCriterionDraft = {
  temporaryId: string;
  sourceRefs: string[];
  sourceText: string;
  interpretation: string;
  category: MatrixCategory;
  required: boolean;
  requiredExplanation: string;
  hardRequired: boolean;
  operator: MatrixOperator;
  atLeast?: number;
  evaluationRule: string;
  expectedEvidence: string[];
  allowedStates: MatrixRowState[];
  decisionEffect: MatrixDecisionEffect;
  missingDataQuestion: string;
  interpretationNotes: string[];
  children?: MatrixCriterionDraft[];
};

export type MatrixCriterion = Omit<MatrixCriterionDraft, "temporaryId" | "children"> & {
  criterionId: string;
  children: MatrixCriterion[];
};

export type VacancyMatrix = {
  schemaVersion: typeof MATRIX_SCHEMA_VERSION;
  profileVersion: string;
  compilerPolicyVersion: string;
  skillVersions: Record<string, string>;
  modelVersions: Record<string, string>;
  criteria: MatrixCriterion[];
  checksum: string;
};

export type CandidateSourceClaim = {
  claimId: string;
  candidateId: string;
  runId: string;
  inputVersion: string;
  profileVersion: string;
  author: string;
  role: "candidate" | "interviewer" | "recruiter" | "unknown";
  roleConfidence?: number;
  text: string;
  locator: string;
  provenanceRef: string;
  criterionIds: string[];
  sourceClass: string;
  directness: "direct" | "indirect";
  relation?: "SUPPORTS" | "CONTRADICTS" | "CONTEXT";
};

export type CandidateMatrixRow = {
  criterionId: string;
  supportingClaimIds: string[];
  contradictingClaimIds: string[];
  checkedSourceIds: string[];
  state: MatrixRowState;
  reason: string;
  conclusion?: string;
  evidence?: CandidateRowEvidence[];
  missingData: string;
  followUpQuestion: string;
  verificationState: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED";
};

export type CandidateRowEvidence = {
  claimId: string;
  sourceRef: string;
  quote: string;
  relation: "SUPPORTS" | "CONTRADICTS" | "CONTEXT";
  explanation: string;
};

export type CriticalVerificationDecision = {
  criterionId: string;
  decision: "VERIFIED" | "REJECTED";
  reason?: string;
  violationIds?: string[];
};

export function applyCriticalVerificationDecisions(
  rows: readonly CandidateMatrixRow[],
  results: readonly CriticalVerificationDecision[],
): CandidateMatrixRow[] {
  const knownIds = new Set(rows.map((row) => row.criterionId));
  const decisions = new Map<string, CriticalVerificationDecision>();
  for (const result of results) {
    if (!knownIds.has(result.criterionId)) throw new Error("MATRIX_CRITICAL_VERIFICATION_UNKNOWN_CRITERION");
    if (decisions.has(result.criterionId)) throw new Error("MATRIX_CRITICAL_VERIFICATION_DUPLICATE_CRITERION");
    if (!['VERIFIED', 'REJECTED'].includes(result.decision)) throw new Error("MATRIX_CRITICAL_VERIFICATION_DECISION_INVALID");
    decisions.set(result.criterionId, result);
  }
  return rows.map((row) => {
    const result = decisions.get(row.criterionId);
    if (!result) return row.verificationState === "PENDING"
      ? { ...row, verificationState: "VERIFIED" }
      : { ...row };
    if (result.decision === "VERIFIED") return { ...row, verificationState: "VERIFIED" };
    const verifierReason = result.reason?.trim();
    return { ...row, verificationState: "REJECTED", reason: verifierReason ? `${row.reason} Проверяющий отметил: ${verifierReason}` : row.reason };
  });
}

export type CriticalUnmappedRisk = {
  riskId: string;
  signalIds: string[];
  title: string;
  reason: string;
  roleImpact: string;
  evidenceLocators: string[];
  assessmentDecision: "PROPOSE_CRITICAL" | "CAVEAT" | "INFORMATIONAL";
  verificationDecision: "VERIFIED_CRITICAL" | "NOT_CRITICAL" | "REJECTED";
  assessmentTraceRef: string;
  verificationTraceRef: string;
};

export type UnmappedRiskSignal = {
  signalId: string;
  text: string;
  locator: string;
  sourceClass: string;
  decisionEffect: string;
};

export function projectUnmappedRiskEvidence(matrix: unknown, signals: readonly UnmappedRiskSignal[]) {
  return {
    matrix,
    signals: signals.map((signal) => ({
      signalId: signal.signalId,
      text: signal.text,
      locator: signal.locator,
      sourceClass: signal.sourceClass,
      decisionEffect: signal.decisionEffect,
    })),
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function matrixChecksum(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function requiredText(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

export function sourceRefIsStopFactor(sourceRef: string) {
  return /(?:stop[\s_.-]*factor|стоп[\s_.-]*фактор)/iu.test(sourceRef);
}

function validateDraftNode(node: MatrixCriterionDraft, sourceFragments: Record<string, string>, path: number[], ids: Set<string>): MatrixCriterion {
  requiredText(node.temporaryId, "MATRIX_TEMPORARY_ID_INVALID");
  if (ids.has(node.temporaryId)) throw new Error("MATRIX_TEMPORARY_ID_DUPLICATE");
  ids.add(node.temporaryId);
  if (!Array.isArray(node.sourceRefs) || !node.sourceRefs.length || node.sourceRefs.some((ref) => !Object.prototype.hasOwnProperty.call(sourceFragments, ref))) throw new Error("MATRIX_SOURCE_REF_INVALID");
  const sourceText = requiredText(node.sourceText, "MATRIX_SOURCE_TEXT_INVALID");
  if (!node.sourceRefs.some((ref) => sourceFragments[ref].includes(sourceText))) throw new Error("MATRIX_FIDELITY_VIOLATION");
  const sourceNumbers = new Set(node.sourceRefs.flatMap((ref) => sourceFragments[ref].match(/\d+(?:[.,]\d+)?/g) ?? []));
  const generatedNumbers = `${node.interpretation} ${node.evaluationRule}`.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (generatedNumbers.some((value) => !sourceNumbers.has(value))) throw new Error("MATRIX_INVENTED_THRESHOLD");
  if (!Array.isArray(node.allowedStates) || !node.allowedStates.length) throw new Error("MATRIX_ALLOWED_STATES_INVALID");
  const stopFactorRefs = node.sourceRefs.map(sourceRefIsStopFactor);
  if (stopFactorRefs.some(Boolean) && !stopFactorRefs.every(Boolean)) throw new Error("MATRIX_STOP_FACTOR_SOURCE_MIXED");
  const fromStopFactor = stopFactorRefs.every(Boolean);
  if (Boolean(node.hardRequired) !== fromStopFactor) throw new Error("MATRIX_HARD_REQUIRED_SOURCE_MISMATCH");
  if (node.hardRequired && (!node.required || node.category !== "stop-factor" || node.decisionEffect !== "stop-factor")) throw new Error("MATRIX_STOP_FACTOR_SEMANTICS_INVALID");
  if (node.operator === "AT_LEAST_N" && (!Number.isInteger(node.atLeast) || Number(node.atLeast) < 1)) throw new Error("MATRIX_AT_LEAST_N_INVALID");
  const children = (node.children ?? []).map((child, index) => validateDraftNode(child, sourceFragments, [...path, index + 1], ids));
  return Object.freeze({
    criterionId: `criterion-${path.map((part) => String(part).padStart(3, "0")).join(".")}`,
    sourceRefs: [...node.sourceRefs],
    sourceText,
    interpretation: requiredText(node.interpretation, "MATRIX_INTERPRETATION_INVALID"),
    category: node.category,
    required: Boolean(node.required),
    requiredExplanation: requiredText(node.requiredExplanation, "MATRIX_REQUIRED_EXPLANATION_INVALID"),
    hardRequired: Boolean(node.hardRequired),
    operator: node.operator,
    ...(node.atLeast === undefined ? {} : { atLeast: node.atLeast }),
    evaluationRule: requiredText(node.evaluationRule, "MATRIX_EVALUATION_RULE_INVALID"),
    expectedEvidence: [...node.expectedEvidence],
    allowedStates: [...node.allowedStates],
    decisionEffect: node.decisionEffect,
    missingDataQuestion: requiredText(node.missingDataQuestion, "MATRIX_MISSING_QUESTION_INVALID"),
    interpretationNotes: [...node.interpretationNotes],
    children,
  });
}

export function canonicalizeVacancyMatrix(input: {
  profileVersion: string;
  compilerPolicyVersion: string;
  skillVersions: Record<string, string>;
  modelVersions?: Record<string, string>;
  sourceFragments: Record<string, string>;
  criteria: MatrixCriterionDraft[];
}): VacancyMatrix {
  requiredText(input.profileVersion, "MATRIX_PROFILE_VERSION_INVALID");
  if (!Array.isArray(input.criteria) || !input.criteria.length) throw new Error("MATRIX_CRITERIA_EMPTY");
  const ids = new Set<string>();
  const topLevelSourcePoints = new Set<string>();
  for (const criterion of input.criteria) for (const sourceRef of criterion.sourceRefs ?? []) {
    const sourcePoint = `${sourceRef}\u0000${String(criterion.sourceText ?? "").trim()}`;
    if (topLevelSourcePoints.has(sourcePoint)) throw new Error("MATRIX_OVER_SPLIT");
    topLevelSourcePoints.add(sourcePoint);
  }
  const criteria = input.criteria.map((criterion, index) => validateDraftNode(criterion, input.sourceFragments, [index + 1], ids));
  const body = {
    schemaVersion: MATRIX_SCHEMA_VERSION,
    profileVersion: input.profileVersion,
    compilerPolicyVersion: requiredText(input.compilerPolicyVersion, "MATRIX_POLICY_VERSION_INVALID"),
    skillVersions: Object.fromEntries(Object.entries(input.skillVersions).sort(([left], [right]) => left.localeCompare(right))),
    modelVersions: Object.fromEntries(Object.entries(input.modelVersions ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    criteria,
  };
  return Object.freeze({ ...body, checksum: matrixChecksum(body) });
}

type CompilationRecord = {
  profileVersion: string;
  owner: string;
  fencingToken: number;
  leaseExpiresAt: number;
  matrix?: VacancyMatrix;
};

export class InMemoryVacancyMatrixRegistry {
  private readonly records = new Map<string, CompilationRecord>();

  claim(profileVersion: string, owner: string, now: number, leaseMs: number) {
    const current = this.records.get(profileVersion);
    if (current?.matrix) return { owner: false, waiting: false, fencingToken: current.fencingToken, matrix: structuredClone(current.matrix) };
    if (current && current.leaseExpiresAt > now && current.owner !== owner) return { owner: false, waiting: true, fencingToken: current.fencingToken };
    const next: CompilationRecord = { profileVersion, owner, fencingToken: (current?.fencingToken ?? 0) + 1, leaseExpiresAt: now + leaseMs };
    this.records.set(profileVersion, next);
    return { owner: true, waiting: false, fencingToken: next.fencingToken, recovered: Boolean(current) };
  }

  publish(profileVersion: string, owner: string, fencingToken: number, matrix: VacancyMatrix) {
    const current = this.records.get(profileVersion);
    if (!current || current.owner !== owner || current.fencingToken !== fencingToken) throw new Error("MATRIX_STALE_FENCING_TOKEN");
    if (current.matrix && current.matrix.checksum !== matrix.checksum) throw new Error("MATRIX_ALREADY_PUBLISHED");
    current.matrix = structuredClone(matrix);
    return structuredClone(current.matrix);
  }

  read(profileVersion: string) {
    const value = this.records.get(profileVersion)?.matrix;
    return value ? structuredClone(value) : null;
  }
}

export function validateCandidateMatrixRows(criterionIds: readonly string[], rows: readonly CandidateMatrixRow[], claims?: readonly CandidateSourceClaim[]) {
  const allowed = new Set(criterionIds);
  const observed = new Set<string>();
  const duplicateIds: string[] = [];
  const unknownIds: string[] = [];
  const invalidEvidenceIds: string[] = [];
  const claimById = claims ? new Map(claims.map((claim) => [claim.claimId, claim])) : undefined;
  for (const row of rows) {
    if (observed.has(row.criterionId)) duplicateIds.push(row.criterionId);
    observed.add(row.criterionId);
    if (!allowed.has(row.criterionId)) unknownIds.push(row.criterionId);
    if (claimById) {
      const evidence = Array.isArray(row.evidence) ? row.evidence : [];
      const verdictNeedsEvidence = row.state === "Соответствует" || row.state === "Не соответствует";
      const insufficientIsExplained = row.state !== "Недостаточно данных" || (Boolean(row.missingData?.trim()) && Boolean(row.followUpQuestion?.trim()));
      const evidenceIsGrounded = evidence.every((item) => {
        const claim = claimById.get(item.claimId);
        return Boolean(claim
          && claim.criterionIds.includes(row.criterionId)
          && item.sourceRef === claim.locator
          && item.quote.trim().length > 0
          && claim.text.includes(item.quote.trim())
          && item.relation === (claim.relation ?? "CONTEXT")
          && item.explanation.trim().length > 0);
      });
      if ((verdictNeedsEvidence && evidence.length === 0) || !insufficientIsExplained || !evidenceIsGrounded) invalidEvidenceIds.push(row.criterionId);
    }
  }
  const missingCriterionIds = criterionIds.filter((id) => !observed.has(id));
  return { decision: missingCriterionIds.length || duplicateIds.length || unknownIds.length || invalidEvidenceIds.length ? "REJECTED" as const : "PASS" as const, missingCriterionIds, duplicateIds, unknownIds, invalidEvidenceIds };
}

export function assessAbcConditionCoverage(definingConditions: readonly string[], coveredConditions: readonly string[], admissibleLocatorCount: number) {
  const covered = new Set(coveredConditions);
  const coverageComplete = definingConditions.length > 0 && definingConditions.every((condition) => covered.has(condition));
  return {
    admissibleLocatorCount,
    coverageComplete,
    assignedLevel: admissibleLocatorCount > 0 && coverageComplete ? "A" as const : null,
    rowState: admissibleLocatorCount > 0 && coverageComplete ? "Подтверждено" as const : "Недостаточно данных" as const,
  };
}

export type MatrixRecommendationInputs = {
  confirmedStopFactors?: readonly string[];
  hardRequiredMismatches?: readonly string[];
  requiredUnknown?: readonly string[];
  requiredMismatches?: readonly string[];
  normalRequiredMismatches?: readonly string[];
  verifiedCriticalUnmappedRisks?: readonly string[];
  risks?: readonly string[];
  limitations?: readonly string[];
  partialMatches?: readonly string[];
};

export function deriveMatrixRecommendation(input: MatrixRecommendationInputs): { recommendation: Recommendation; selectedBranch: string } {
  if (input.confirmedStopFactors?.length) return { recommendation: "Не рекомендовать", selectedBranch: "STOP_FACTOR" };
  if (input.hardRequiredMismatches?.length) return { recommendation: "Не рекомендовать", selectedBranch: "HARD_REQUIRED" };
  if (input.requiredMismatches?.length || input.normalRequiredMismatches?.length) return { recommendation: "Не рекомендовать", selectedBranch: "REQUIRED_MISMATCH" };
  if (input.verifiedCriticalUnmappedRisks?.length) return { recommendation: "Не рекомендовать", selectedBranch: "CRITICAL_UNMAPPED_RISK" };
  if (input.requiredUnknown?.length) return { recommendation: "Недостаточно данных", selectedBranch: "REQUIRED_UNKNOWN" };
  if (input.risks?.length || input.limitations?.length || input.partialMatches?.length) return { recommendation: "Рекомендовать с оговорками", selectedBranch: "CAVEAT" };
  return { recommendation: "Рекомендовать", selectedBranch: "ALL_CLEAR" };
}

const SENSITIVE_PATTERNS = [
  /\d{1,3}\s*(?:лет|года|год)/giu,
  /(?:дата\s+рождения|родил(?:ся|ась)|возраст)\s*[:—-]?\s*[^,;\n]+/giu,
  /(?:мужчина|женщина|мужской\s+пол|женский\s+пол)/giu,
  /(?:женат|замужем|не\s+женат|не\s+замужем|семейное\s+положение)\p{L}*/giu,
  /(?:двое|трое|четверо|пятеро|один|одна|два|две)\s+дет(?:ей|и|ёнок|енка)/giu,
  /(?:национальност\p{L}*|этническ\p{L}*|гражданин\p{L}*)\s*[:—-]?\s*[^,;\n]+/giu,
  /(?:фотографи\p{L}*|внешност\p{L}*|рост|вес)\s*[:—-]?\s*[^,;\n]+/giu,
  /(?:здоровь\p{L}*|диагноз\p{L}*|болезн\p{L}*)\s*[:—-]?\s*[^,;\n]+/giu,
  /(?:православн\p{L}*|мусульман\p{L}*|иуде\p{L}*|атеист\p{L}*)/giu,
  /(?:политическ\p{L}*|партийн\p{L}*)\s*[:—-]?\s*[^,;\n]+/giu,
  /(?:инвалидност\p{L}*|инвалид\p{L}*)/giu,
];

export function decisionSafeText(text: string) {
  let safe = text;
  for (const pattern of SENSITIVE_PATTERNS) safe = safe.replace(pattern, "[СКРЫТО]");
  return safe;
}

export function decisionSafeJson<T>(value: T): T {
  if (typeof value === "string") return decisionSafeText(value) as T;
  if (Array.isArray(value)) return value.map((item) => decisionSafeJson(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decisionSafeJson(item)]),
    ) as T;
  }
  return value;
}

export function candidateClaimIsDecisionAdmissible(claim: CandidateSourceClaim) {
  if (claim.role === "interviewer" || claim.role === "unknown") return false;
  return claim.roleConfidence === undefined || claim.roleConfidence >= 0.75;
}

export function detectGlobalClaimConflicts(claims: readonly (CandidateSourceClaim & { predicate: string; value: string })[]) {
  const byPredicate = new Map<string, Array<CandidateSourceClaim & { predicate: string; value: string }>>();
  for (const claim of claims) byPredicate.set(claim.predicate, [...(byPredicate.get(claim.predicate) ?? []), claim]);
  return [...byPredicate.entries()].flatMap(([predicate, values]) => new Set(values.map((item) => item.value)).size > 1 ? [{
    conflictId: `conflict-${matrixChecksum([predicate, values.map((item) => item.claimId)]).slice(0, 16)}`,
    predicate,
    claimIds: values.map((item) => item.claimId),
    followUpQuestion: `Уточните противоречащие сведения по критерию ${predicate}`,
  }] : []);
}

export function criticalVerificationKinds() {
  return ["stopFactor", "hardRequired", "required", "conflict", "criticalUnmappedRisk", "recommendation-changing"] as const;
}

export function evaluateShadowQuality(input: { criterionCoverage: number; inventedStopFactors: number; invalidDecisionLocators: number; oneSidedConflicts: number; unverifiedCriticalRows: number; invalidRequiredness?: number; hardRequiredSourceMismatches?: number; unverifiedCriticalRisks?: number; formulaMatches: boolean }) {
  const violations = [
    ...(input.criterionCoverage === 1 ? [] : ["CRITERION_COVERAGE_INCOMPLETE"]),
    ...((input.invalidRequiredness ?? 0) === 0 ? [] : ["REQUIREDNESS_INVALID"]),
    ...((input.hardRequiredSourceMismatches ?? 0) === 0 ? [] : ["HARD_REQUIRED_SOURCE_MISMATCH"]),
    ...(input.inventedStopFactors === 0 ? [] : ["INVENTED_STOP_FACTOR"]),
    ...(input.invalidDecisionLocators === 0 ? [] : ["DECISION_LOCATOR_INVALID"]),
    ...(input.oneSidedConflicts === 0 ? [] : ["CONFLICT_SIDE_MISSING"]),
    ...(input.unverifiedCriticalRows === 0 ? [] : ["CRITICAL_ROW_UNVERIFIED"]),
    ...((input.unverifiedCriticalRisks ?? 0) === 0 ? [] : ["CRITICAL_UNMAPPED_RISK_UNVERIFIED"]),
    ...(input.formulaMatches ? [] : ["FORMULA_MISMATCH"]),
  ];
  return { decision: violations.length ? "BLOCK" as const : "PASS" as const, violations };
}

export function requiredReleaseSuites() {
  return ["matrix-driven-acceptance", "E2E-VAC-001", "E2E-TRN-001", "E2E-ABC-001", "E2E-RESULT-001"] as const;
}
