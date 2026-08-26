import assert from "node:assert/strict";
import test from "node:test";
import { compileVacancyMatrix, type MatrixCompilationStore, type MatrixDraftEnvelope } from "./matrix-compilation.ts";
import type { VacancyMatrix } from "./matrix-driven.ts";

const draft: MatrixDraftEnvelope = { schemaVersion: "vacancy-matrix-draft/v1", traceRef: "trace-compiler", model: "model-a", criteria: [{
  temporaryId: "one", sourceRefs: ["profile.one"], sourceText: "Опыт", interpretation: "Проверить опыт", category: "required-experience",
  required: true, requiredExplanation: "Обязательный опыт", hardRequired: false, operator: "ALL_OF", evaluationRule: "Найти пример", expectedEvidence: ["resume"],
  allowedStates: ["Подтверждено", "Недостаточно данных"], decisionEffect: "required-gap", missingDataQuestion: "Какой опыт?", interpretationNotes: [],
}] };

function memoryStore(): MatrixCompilationStore & { matrix?: VacancyMatrix; failed?: string; progress: unknown[] } {
  return {
    progress: [],
    async readMatrix() { return this.matrix ? { matrixId: "matrix-1", matrix: this.matrix, checksum: this.matrix.checksum } : null; },
    async claimCompilation() { return { owner: true, waiting: false, fencingToken: 1 }; },
    async recordCompilationProgress(value) { this.progress.push(value); },
    async publishMatrix(value) { this.matrix = value.matrix; return { matrixId: "matrix-1", checksum: value.matrix.checksum, reused: false }; },
    async failCompilation(value) { this.failed = value.errorCode; },
  };
}

test("compilation executes compile, clean critic and immutable publish", async () => {
  const store = memoryStore(); const seen: string[] = [];
  const result = await compileVacancyMatrix({ profileVersion: "profile-v1", ownerId: "run-1", canonicalProfile: { title: "Role" }, sourceFragments: { "profile.one": "Опыт" }, compilerPolicyVersion: "policy-v1", store, skills: {
    async compile() { seen.push("compile"); return draft; },
    async critique(input) { seen.push("critique"); assert.equal("reasoning" in input, false); return { schemaVersion: "vacancy-matrix-critic/v2", decision: "PASS", changes: [], successor: draft, traceRef: "trace-critic", model: "model-b" }; },
  } });
  assert.equal(result.state, "PUBLISHED"); assert.deepEqual(seen, ["compile", "critique"]);
  if (result.state === "PUBLISHED") assert.equal(result.sameModelCritic, false);
});

test("single critic correction publishes its successor without a repair loop", async () => {
  const store = memoryStore();
  const corrected = { ...draft, criteria: [{ ...draft.criteria[0], interpretation: "Исправленная проверка опыта" }] };
  const result = await compileVacancyMatrix({ profileVersion: "profile-v1", ownerId: "run-1", canonicalProfile: {}, sourceFragments: { "profile.one": "Опыт" }, compilerPolicyVersion: "policy-v1", store, skills: {
    async compile() { return draft; },
    async critique() { return { schemaVersion: "vacancy-matrix-critic/v2", decision: "CORRECTED", changes: [{ changeId: "fix", sourceRefs: ["profile.one"], summary: "fix" }], successor: corrected, traceRef: "trace-critic", model: "model-b" }; },
  } });
  assert.equal(result.state, "PUBLISHED");
  assert.equal(store.matrix?.criteria[0]?.interpretation, "Исправленная проверка опыта");
  if (result.state === "PUBLISHED") assert.deepEqual({ llmCalls: result.llmCalls, repairCycles: result.repairCycles }, { llmCalls: 2, repairCycles: 0 });
});

test("controlled compilation covers repair-to-pass, provider failure, invalid sources and waiters", async () => {
  const repairedStore = memoryStore();
  const repaired = await compileVacancyMatrix({ profileVersion: "profile-v1", ownerId: "run-1", canonicalProfile: {}, sourceFragments: { "profile.one": "Опыт" }, compilerPolicyVersion: "policy-v1", store: repairedStore, skills: {
    async compile() { return draft; },
    async critique() { return { schemaVersion: "vacancy-matrix-critic/v2", decision: "CORRECTED", changes: [{ changeId: "repair", sourceRefs: ["profile.one"], summary: "fix" }], successor: draft, traceRef: "critic-1", model: "critic" }; },
  } });
  assert.equal(repaired.state, "PUBLISHED");

  const unavailableStore = memoryStore();
  const unavailable = await compileVacancyMatrix({ profileVersion: "profile-v2", ownerId: "run-2", canonicalProfile: {}, sourceFragments: { "profile.one": "Опыт" }, compilerPolicyVersion: "policy-v1", store: unavailableStore, skills: { async compile() { throw new Error("MATRIX_PROVIDER_UNAVAILABLE"); }, async critique() { throw new Error("unexpected"); } } });
  assert.deepEqual(unavailable, { state: "FAILED", errorCode: "MATRIX_PROVIDER_UNAVAILABLE" });

  const invalidStore = memoryStore();
  const invalidDraft = { ...draft, criteria: [{ ...draft.criteria[0], sourceRefs: ["profile.missing"] }] };
  const invalid = await compileVacancyMatrix({ profileVersion: "profile-v3", ownerId: "run-3", canonicalProfile: {}, sourceFragments: { "profile.one": "Опыт" }, compilerPolicyVersion: "policy-v1", store: invalidStore, skills: { async compile() { return invalidDraft; }, async critique() { return { schemaVersion: "vacancy-matrix-critic/v2", decision: "PASS", changes: [], successor: invalidDraft, traceRef: "critic", model: "critic" }; } } });
  assert.deepEqual(invalid, { state: "FAILED", errorCode: "MATRIX_SOURCE_REF_INVALID" });

  const waiterStore = { ...memoryStore(), async claimCompilation() { return { owner: false, waiting: true, fencingToken: 1 }; } };
  const waiting = await compileVacancyMatrix({ profileVersion: "profile-v4", ownerId: "run-4", canonicalProfile: {}, sourceFragments: { "profile.one": "Опыт" }, compilerPolicyVersion: "policy-v1", store: waiterStore, skills: { async compile() { throw new Error("unexpected"); }, async critique() { throw new Error("unexpected"); } } });
  assert.deepEqual(waiting, { state: "WAITING", profileVersion: "profile-v4" });
});
