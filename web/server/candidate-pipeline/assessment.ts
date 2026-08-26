import { assertEvidenceGraph, recommendationAsm050, sha256 } from "./core.ts";
import type { AssessmentInputs, EvidenceFact, EvidenceState, Recommendation } from "./types.ts";

export type EvidenceConflict = { id: string; predicate: string; factIds: readonly string[]; resolved: boolean; resolutionFactId?: string };
export type EvidenceGraph = { facts: readonly EvidenceFact[]; conflicts: readonly EvidenceConflict[] };
export type ProfileCriterion = { id: string; title: string; category: "required-experience" | "desired-experience" | "competency" | "access-to-ke" | "risk" | "stop-factor"; predicate: string; required: boolean; expectedValue?: string };
export type CriterionAssessment = { criterionId: string; state: EvidenceState; factIds: readonly string[]; reason: string };
export type AbcDirectionState = { directionId: string; state: "A" | "B" | "C" | "CONFLICT" | "Недостаточно данных"; factIds: readonly string[] };

export function assessAbcDirections(directionIds: readonly string[], graph: EvidenceGraph): readonly AbcDirectionState[] {
  return directionIds.map((directionId) => {
    const facts = graph.facts.filter((fact) => fact.predicate === `abc:${directionId}` && ["A", "B", "C"].includes(fact.value));
    const conflict = graph.conflicts.some((item) => !item.resolved && item.predicate === `abc:${directionId}`);
    if (conflict || new Set(facts.map((fact) => fact.value)).size > 1) return { directionId, state: "CONFLICT" as const, factIds: facts.map((fact) => fact.id) };
    if (!facts.length) return { directionId, state: "Недостаточно данных" as const, factIds: [] };
    return { directionId, state: facts[0].value as "A" | "B" | "C", factIds: facts.map((fact) => fact.id) };
  });
}

export function buildEvidenceGraph(facts: readonly EvidenceFact[], conflicts: readonly EvidenceConflict[]): EvidenceGraph {
  assertEvidenceGraph(facts);
  const factIds = new Set(facts.map((fact) => fact.id));
  for (const conflict of conflicts) {
    if (conflict.factIds.length < 2 || conflict.factIds.some((id) => !factIds.has(id))) throw new Error("INVALID_EVIDENCE_CONFLICT");
    if (conflict.resolved && (!conflict.resolutionFactId || !factIds.has(conflict.resolutionFactId))) throw new Error("INVALID_CONFLICT_RESOLUTION");
  }
  return Object.freeze({ facts: structuredClone(facts), conflicts: structuredClone(conflicts) });
}

export function assessCriteria(graph: EvidenceGraph, profile: readonly ProfileCriterion[]) {
  return profile.map((criterion): CriterionAssessment => {
    const matching = graph.facts.filter((fact) => fact.predicate === criterion.predicate);
    const unresolved = graph.conflicts.find((conflict) => !conflict.resolved && conflict.predicate === criterion.predicate);
    if (unresolved) return { criterionId: criterion.id, state: "Противоречие источников", factIds: unresolved.factIds, reason: "Источники содержат неразрешённое противоречие" };
    if (!matching.length) return { criterionId: criterion.id, state: "Недостаточно данных", factIds: [], reason: "Допустимое доказательство не найдено" };
    const positive = matching.filter((fact) => criterion.expectedValue === undefined || fact.value === criterion.expectedValue);
    if (positive.length === matching.length) return { criterionId: criterion.id, state: "Подтверждено", factIds: positive.map((fact) => fact.id), reason: "Правило подтверждено источниками" };
    if (positive.length) return { criterionId: criterion.id, state: "Частично подтверждено", factIds: matching.map((fact) => fact.id), reason: "Подтверждена только часть наблюдаемых признаков" };
    return { criterionId: criterion.id, state: "Не подтверждено", factIds: matching.map((fact) => fact.id), reason: "Источники подтверждают несоответствие" };
  });
}

export function assessmentInputs(profile: readonly ProfileCriterion[], assessments: readonly CriterionAssessment[], abcStates: AssessmentInputs["abcStates"]): AssessmentInputs {
  const byId = new Map(assessments.map((item) => [item.criterionId, item]));
  const confirmedStopFactors = profile.filter((item) => item.category === "stop-factor" && byId.get(item.id)?.state === "Подтверждено").map((item) => item.id);
  const requiredItemsInsufficient = profile.filter((item) => item.required && ["Недостаточно данных", "Противоречие источников"].includes(byId.get(item.id)?.state ?? "Недостаточно данных")).map((item) => item.id);
  const limitations = profile.filter((item) => item.category !== "risk" && item.category !== "stop-factor" && ["Не подтверждено", "Частично подтверждено"].includes(byId.get(item.id)?.state ?? "")).map((item) => item.id);
  const risks = profile.filter((item) => item.category === "risk" && byId.get(item.id)?.state === "Подтверждено").map((item) => item.id);
  const partiallyConfirmedCompetencies = profile.filter((item) => item.category === "competency" && byId.get(item.id)?.state === "Частично подтверждено").map((item) => item.id);
  const requiredExperience = profile.filter((item) => item.category === "required-experience" && item.required);
  const access = profile.filter((item) => item.category === "access-to-ke" && item.required);
  return {
    confirmedStopFactors,
    requiredItemsInsufficient,
    requiredExperienceConfirmed: requiredExperience.length > 0 && requiredExperience.every((item) => byId.get(item.id)?.state === "Подтверждено"),
    accessToKePositive: access.length > 0 && access.every((item) => byId.get(item.id)?.state === "Подтверждено"),
    unresolvedConflicts: assessments.filter((item) => item.state === "Противоречие источников").map((item) => item.criterionId),
    limitations,
    risks,
    partiallyConfirmedCompetencies,
    abcStates,
  };
}

export type AssessmentSnapshot = Readonly<{
  id: string;
  predecessorId?: string;
  attempt: number;
  inputVersion: string;
  profileVersion: string;
  toolVersions: Readonly<Record<string, string>>;
  modelVersion: string;
  schemaVersion: "assessment/v1";
  policyVersion: string;
  evidenceGraphChecksum: string;
  criteria: readonly CriterionAssessment[];
  inputs: AssessmentInputs;
  recommendation: Recommendation;
}>;

export function createAssessmentSnapshot(input: Omit<AssessmentSnapshot, "id" | "recommendation" | "schemaVersion">): AssessmentSnapshot {
  const recommendation = recommendationAsm050(input.inputs);
  const body = { ...input, schemaVersion: "assessment/v1" as const, recommendation };
  return Object.freeze({ ...structuredClone(body), id: `assessment-${sha256(body).slice(0, 24)}` });
}

export function validateAssessmentSnapshot(snapshot: AssessmentSnapshot, graph: EvidenceGraph, profile: readonly ProfileCriterion[]) {
  const violations: string[] = [];
  try { assertEvidenceGraph(graph.facts); } catch { violations.push("EVIDENCE_LOCATOR_INVALID"); }
  const factIds = new Set(graph.facts.map((fact) => fact.id));
  if (snapshot.criteria.some((criterion) => criterion.factIds.some((id) => !factIds.has(id)))) violations.push("EVIDENCE_REFERENCE_INVALID");
  if (snapshot.criteria.length !== profile.length) violations.push("PROFILE_CRITERIA_INCOMPLETE");
  if (recommendationAsm050(snapshot.inputs) !== snapshot.recommendation) violations.push("ASM_050_MISMATCH");
  if (snapshot.inputVersion === "" || snapshot.profileVersion === "" || snapshot.policyVersion === "" || !Object.keys(snapshot.toolVersions).length) violations.push("PROVENANCE_INCOMPLETE");
  return { decision: violations.length ? "REPAIRABLE" as const : "PASS" as const, violations };
}

export function repairAssessment(predecessor: AssessmentSnapshot, corrected: { criteria: readonly CriterionAssessment[]; inputs: AssessmentInputs }, violationIds: readonly string[]) {
  if (!violationIds.length || predecessor.attempt >= 2) throw new Error("BOUNDED_REPAIR_EXHAUSTED");
  return createAssessmentSnapshot({ predecessorId: predecessor.id, attempt: predecessor.attempt + 1, inputVersion: predecessor.inputVersion, profileVersion: predecessor.profileVersion, toolVersions: predecessor.toolVersions, modelVersion: predecessor.modelVersion, policyVersion: predecessor.policyVersion, evidenceGraphChecksum: predecessor.evidenceGraphChecksum, criteria: corrected.criteria, inputs: corrected.inputs });
}
