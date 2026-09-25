import assert from "node:assert/strict";
import test from "node:test";
import { compileVacancyMatrix, type MatrixCompilationStore, type MatrixDraftEnvelope } from "../server/candidate-pipeline/matrix-compilation.ts";

test("MDA-002: an unrepresented populated vacancy field cannot produce a published matrix", async () => {
  const sourceFragments = {
    "profile.requiredExperience": "Опыт сопровождения корпоративных клиентов",
    "profile.keyCompetencies": "Умение разрешать конфликтные обращения",
  };
  const draft: MatrixDraftEnvelope = {
    schemaVersion: "vacancy-matrix-draft/v1",
    traceRef: "synthetic-compiler-trace",
    model: "synthetic-compiler",
    criteria: [{
      temporaryId: "client-experience",
      sourceRefs: ["profile.requiredExperience"],
      sourceText: sourceFragments["profile.requiredExperience"],
      interpretation: "Проверить опыт сопровождения корпоративных клиентов",
      category: "required-experience",
      required: true,
      requiredExplanation: "В профиле указан обязательный опыт",
      hardRequired: false,
      operator: "ALL_OF",
      evaluationRule: "Найти конкретный пример сопровождения клиента",
      expectedEvidence: ["resume", "interview"],
      allowedStates: ["Подтверждено", "Недостаточно данных"],
      decisionEffect: "required-gap",
      missingDataQuestion: "Какой клиентский опыт можете описать?",
      interpretationNotes: [],
    }],
  };
  const published: unknown[] = [];
  const failures: string[] = [];
  const store: MatrixCompilationStore = {
    async readMatrix() { return null; },
    async claimCompilation() { return { owner: true, waiting: false, fencingToken: 1 }; },
    async recordCompilationProgress() {},
    async publishMatrix(input) {
      published.push(input.matrix);
      return { matrixId: "synthetic-matrix", checksum: input.matrix.checksum, reused: false };
    },
    async failCompilation(input) { failures.push(input.errorCode); },
  };

  const result = await compileVacancyMatrix({
    profileVersion: "synthetic-profile-v1",
    ownerId: "synthetic-run-v1",
    canonicalProfile: {
      requiredExperience: sourceFragments["profile.requiredExperience"],
      keyCompetencies: sourceFragments["profile.keyCompetencies"],
    },
    sourceFragments,
    compilerPolicyVersion: "synthetic-matrix-policy-v1",
    store,
    skills: {
      async compile() { return draft; },
      async critique() {
        return {
          schemaVersion: "vacancy-matrix-critic/v2", decision: "PASS", changes: [], successor: draft,
          traceRef: "synthetic-critic-trace", model: "synthetic-critic",
        };
      },
    },
  });

  assert.equal(result.state, "FAILED", "the populated keyCompetencies field is missing from the matrix");
  assert.equal(published.length, 0, "no incomplete matrix may be published");
  assert.equal(failures.length, 1, "compilation failure must be recorded");
});
