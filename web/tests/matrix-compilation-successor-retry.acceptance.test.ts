import assert from "node:assert/strict";
import test from "node:test";
import { compileVacancyMatrix, type MatrixCompilationSkills, type MatrixDraftEnvelope } from "../server/candidate-pipeline/matrix-compilation.ts";
import { canonicalizeVacancyMatrix } from "../server/candidate-pipeline/matrix-driven.ts";

const draft: MatrixDraftEnvelope = {
  schemaVersion: "vacancy-matrix-draft/v1",
  traceRef: "trace-successor-compiler",
  model: "synthetic-compiler",
  criteria: [{
    temporaryId: "criterion-successor",
    sourceRefs: ["profile.requiredExperience"],
    sourceText: "Опыт обязателен",
    interpretation: "Проверить обязательный опыт",
    category: "required-experience",
    required: true,
    requiredExplanation: "Требование обязательно по смыслу профиля",
    hardRequired: false,
    operator: "ALL_OF",
    evaluationRule: "Найти допустимое доказательство опыта",
    expectedEvidence: ["resume"],
    allowedStates: ["Подтверждено", "Недостаточно данных"],
    decisionEffect: "required-gap",
    missingDataQuestion: "Какой опыт подтверждает требование?",
    interpretationNotes: [],
  }],
};

function skills(counter: { calls: number }): MatrixCompilationSkills {
  return {
    async compile() { counter.calls += 1; return draft; },
    async critique() {
      counter.calls += 1;
      return { schemaVersion: "vacancy-matrix-critic/v2", decision: "PASS", changes: [], successor: draft, traceRef: "trace-successor-critic", model: "synthetic-critic" };
    },
  };
}

function failedStore() {
  const state = { attempt: 1, claimInputs: [] as Array<{ allowRetry?: boolean }>, published: false };
  return {
    state,
    store: {
      async readMatrix() { return null; },
      async claimCompilation(input: { allowRetry?: boolean }) {
        state.claimInputs.push(input);
        if (input.allowRetry !== true) return { owner: false, waiting: false, fencingToken: 7, attempt: state.attempt, terminalErrorCode: "MATRIX_PROVIDER_UNAVAILABLE" };
        state.attempt += 1;
        return { owner: true, waiting: false, fencingToken: 8, attempt: state.attempt };
      },
      async recordCompilationProgress() {},
      async publishMatrix(input: { matrix: { checksum: string } }) {
        state.published = true;
        return { matrixId: "matrix-successor-v2", checksum: input.matrix.checksum, reused: false };
      },
      async failCompilation() {},
    },
  };
}

function compilationInput(store: unknown, skillSet: MatrixCompilationSkills, allowRetry: boolean) {
  return {
    profileVersion: "profile-successor-v1",
    ownerId: allowRetry ? "run-manual-reprocess-v2" : "run-automatic-v2",
    canonicalProfile: { requiredExperience: "Опыт обязателен" },
    sourceFragments: { "profile.requiredExperience": "Опыт обязателен" },
    compilerPolicyVersion: "matrix-compiler-policy/v1",
    skills: skillSet,
    store,
    allowRetry,
  } as any;
}

test("MATRIX-SUCCESSOR-RED-001: manual-reprocess retries terminal FAILED compilation as the next attempt", async () => {
  const fixture = failedStore();
  const counter = { calls: 0 };
  const result = await compileVacancyMatrix(compilationInput(fixture.store, skills(counter), true));
  const failures: string[] = [];
  if (fixture.state.claimInputs[0]?.allowRetry !== true) failures.push(`manual successor claim allowRetry expected true; actual=${JSON.stringify(fixture.state.claimInputs[0]?.allowRetry)}`);
  if (fixture.state.attempt !== 2) failures.push(`manual successor attempt expected 2; actual=${fixture.state.attempt}`);
  if (result.state !== "PUBLISHED") failures.push(`manual successor result expected PUBLISHED; actual=${result.state}`);
  if (!fixture.state.published || counter.calls !== 2) failures.push(`manual successor must compile, critique and publish; published=${fixture.state.published}, skillCalls=${counter.calls}`);
  assert.deepEqual(failures, []);
});

test("MATRIX-SUCCESSOR-002: ordinary automatic run cannot retry terminal FAILED compilation", async () => {
  const fixture = failedStore();
  const counter = { calls: 0 };
  const result = await compileVacancyMatrix(compilationInput(fixture.store, skills(counter), false));
  assert.notEqual(fixture.state.claimInputs[0]?.allowRetry, true);
  assert.equal(fixture.state.attempt, 1);
  assert.deepEqual(result, { state: "FAILED", errorCode: "MATRIX_PROVIDER_UNAVAILABLE" });
  assert.equal(fixture.state.published, false);
  assert.equal(counter.calls, 0);
});

test("MATRIX-SUCCESSOR-003: published matrix remains immutable and manual retry reuses it without a new claim", async () => {
  const published = canonicalizeVacancyMatrix({
    profileVersion: "profile-successor-v1",
    compilerPolicyVersion: "matrix-compiler-policy/v1",
    skillVersions: { compiler: "compile-vacancy-matrix/v1" },
    sourceFragments: { "profile.requiredExperience": "Опыт обязателен" },
    criteria: draft.criteria,
  });
  let claims = 0;
  const counter = { calls: 0 };
  const store = {
    async readMatrix() { return { matrixId: "matrix-published-v1", matrix: published, checksum: published.checksum }; },
    async claimCompilation() { claims += 1; throw new Error("PUBLISHED_MATRIX_MUST_NOT_BE_RECLAIMED"); },
    async recordCompilationProgress() {},
    async publishMatrix() { throw new Error("PUBLISHED_MATRIX_MUST_NOT_BE_REPUBLISHED"); },
    async failCompilation() {},
  };
  const result = await compileVacancyMatrix(compilationInput(store, skills(counter), true));
  assert.equal(result.state, "REUSED");
  assert.equal(result.checksum, published.checksum);
  assert.equal(claims, 0);
  assert.equal(counter.calls, 0);
});
