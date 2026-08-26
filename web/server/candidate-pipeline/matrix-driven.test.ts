import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryVacancyMatrixRegistry,
  assessAbcConditionCoverage,
  canonicalizeVacancyMatrix,
  decisionSafeText,
  deriveMatrixRecommendation,
  isMatrixWorkflowVersion,
  validateCandidateMatrixRows,
  type MatrixCriterionDraft,
} from "./matrix-driven.ts";

const sourceFragments = { "profile.one": "Первое требование", "profile.two": "Второе требование" };
const draft = (temporaryId: string, sourceRef: string): MatrixCriterionDraft => ({
  temporaryId, sourceRefs: [sourceRef], sourceText: sourceFragments[sourceRef as keyof typeof sourceFragments] ?? "unknown",
  interpretation: "Проверяемое требование", category: "required-experience", required: true, requiredExplanation: "Требование обязательно по смыслу профиля", hardRequired: false,
  operator: "ALL_OF", evaluationRule: "Найти пример", expectedEvidence: ["resume"],
  allowedStates: ["Подтверждено", "Недостаточно данных"], decisionEffect: "required-gap",
  missingDataQuestion: "Приведите пример", interpretationNotes: [],
});

test("validation recognizes pinned matrix workflow versions without accepting legacy or malformed values", () => {
  assert.equal(isMatrixWorkflowVersion("matrix-v1"), true);
  assert.equal(isMatrixWorkflowVersion("matrix-v2"), true);
  assert.equal(isMatrixWorkflowVersion("matrix-v2-shadow"), true);
  assert.equal(isMatrixWorkflowVersion("legacy-v1"), false);
  assert.equal(isMatrixWorkflowVersion("matrix-v2-unknown"), false);
  assert.equal(isMatrixWorkflowVersion("matrix-v"), false);
});

test("canonical matrix preserves profile order and has a stable checksum", () => {
  const input = { profileVersion: "profile-v1", compilerPolicyVersion: "policy-v1", skillVersions: { critic: "v1", compiler: "v1" }, sourceFragments, criteria: [draft("one", "profile.one"), draft("two", "profile.two")] };
  const first = canonicalizeVacancyMatrix(input);
  const second = canonicalizeVacancyMatrix({ ...input, skillVersions: { compiler: "v1", critic: "v1" } });
  assert.deepEqual(first.criteria.map((item) => item.sourceRefs[0]), ["profile.one", "profile.two"]);
  assert.equal(first.checksum, second.checksum);
  assert.deepEqual(first.criteria.map((item) => item.criterionId), ["criterion-001", "criterion-002"]);
});

test("canonical matrix rejects unknown sources and hard-required outside stop factors", () => {
  assert.throws(() => canonicalizeVacancyMatrix({ profileVersion: "p", compilerPolicyVersion: "c", skillVersions: { compiler: "v1" }, sourceFragments, criteria: [draft("bad", "profile.missing")] }), /MATRIX_SOURCE_REF_INVALID/);
  assert.throws(() => canonicalizeVacancyMatrix({ profileVersion: "p", compilerPolicyVersion: "c", skillVersions: { compiler: "v1" }, sourceFragments, criteria: [{ ...draft("bad", "profile.one"), hardRequired: true }] }), /MATRIX_HARD_REQUIRED_SOURCE_MISMATCH/);
});

test("registry fences stale publishers and never creates a second matrix", () => {
  const registry = new InMemoryVacancyMatrixRegistry();
  const first = registry.claim("profile-v1", "one", 0, 10);
  const recovered = registry.claim("profile-v1", "two", 11, 10);
  const matrix = canonicalizeVacancyMatrix({ profileVersion: "profile-v1", compilerPolicyVersion: "c", skillVersions: { compiler: "v1" }, sourceFragments, criteria: [draft("one", "profile.one")] });
  assert.throws(() => registry.publish("profile-v1", "one", first.fencingToken, matrix), /MATRIX_STALE_FENCING_TOKEN/);
  registry.publish("profile-v1", "two", recovered.fencingToken, matrix);
  assert.equal(registry.claim("profile-v1", "three", 100, 10).matrix?.checksum, matrix.checksum);
});

test("row, ABC, recommendation and sensitive guards are deterministic", () => {
  const validation = validateCandidateMatrixRows(["one", "two"], [{ criterionId: "one" } as never]);
  assert.deepEqual(validation.missingCriterionIds, ["two"]);
  assert.equal(assessAbcConditionCoverage(["one", "two"], ["one"], 1).rowState, "Недостаточно данных");
  assert.equal(deriveMatrixRecommendation({ hardRequiredMismatches: ["hard"] }).recommendation, "Не рекомендовать");
  assert.equal(deriveMatrixRecommendation({ normalRequiredMismatches: ["normal"] }).recommendation, "Не рекомендовать");
  assert.equal(deriveMatrixRecommendation({ verifiedCriticalUnmappedRisks: ["risk"] }).selectedBranch, "CRITICAL_UNMAPPED_RISK");
  assert.equal(decisionSafeText("39 лет, двое детей, православная, инвалидность").includes("39 лет"), false);
});
