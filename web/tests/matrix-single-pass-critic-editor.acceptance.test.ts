import assert from "node:assert/strict";
import test from "node:test";
import { compileVacancyMatrix } from "../server/candidate-pipeline/matrix-compilation.ts";
import type { MatrixCriterionDraft, VacancyMatrix } from "../server/candidate-pipeline/matrix-driven.ts";

const inventedCriterion: MatrixCriterionDraft = {
  temporaryId: "response-speed",
  sourceRefs: ["profile.resultImage.responseSpeed"],
  sourceText: "Коммуникации готовятся заранее",
  interpretation: "Ответить не позднее чем за 15 минут",
  category: "competency",
  required: true,
  requiredExplanation: "Требование является частью образа результата",
  hardRequired: false,
  operator: "ALL_OF",
  evaluationRule: "Проверить соблюдение порога 15 минут",
  expectedEvidence: ["interview"],
  allowedStates: ["Подтверждено", "Недостаточно данных"],
  decisionEffect: "required-gap",
  missingDataQuestion: "Как быстро вы отвечаете?",
  interpretationNotes: ["Компилятор добавил отсутствующий числовой порог"],
};

const correctedCriterion: MatrixCriterionDraft = {
  ...inventedCriterion,
  interpretation: "Готовить важные коммуникации заблаговременно, а не в последний момент",
  evaluationRule: "Найти проверяемый пример заблаговременной подготовки коммуникации без придуманного срока",
  interpretationNotes: ["Качественная формулировка сохранена без числового порога"],
};

function memoryStore() {
  const state: {
    published?: VacancyMatrix;
    failed?: string;
    progress: Array<{ repairCycles: number; llmCalls: number }>;
    protectedTraceRefs?: string[];
  } = { progress: [] };
  return {
    state,
    store: {
      async readMatrix() { return null; },
      async claimCompilation() { return { owner: true, waiting: false, fencingToken: 17 }; },
      async recordCompilationProgress(input: { repairCycles: number; llmCalls: number }) { state.progress.push(input); },
      async publishMatrix(input: { matrix: VacancyMatrix; protectedTraceRefs: string[] }) {
        state.published = input.matrix;
        state.protectedTraceRefs = input.protectedTraceRefs;
        return { matrixId: "matrix-single-editor-v1", checksum: input.matrix.checksum, reused: false };
      },
      async failCompilation(input: { errorCode: string }) { state.failed = input.errorCode; },
    },
  };
}

test("MDA-004-RED-013.1: one critic-editor correction is the published successor without repair or re-critique", async () => {
  const fixture = memoryStore();
  const calls = { compile: 0, criticEditor: 0, repair: 0 };
  const compilerDraft = {
    schemaVersion: "vacancy-matrix-draft/v1" as const,
    criteria: [inventedCriterion],
    traceRef: "trace-compiler-once",
    model: "synthetic-compiler",
  };
  const correctedSuccessor = {
    schemaVersion: "vacancy-matrix-draft/v1" as const,
    criteria: [correctedCriterion],
    traceRef: "trace-critic-editor-successor",
    model: "synthetic-critic-editor",
  };

  const result = await compileVacancyMatrix({
    profileVersion: "profile-single-editor-v1",
    ownerId: "candidate-run-1",
    canonicalProfile: { resultImage: { responseSpeed: "Коммуникации готовятся заранее" } },
    sourceFragments: { "profile.resultImage.responseSpeed": "Коммуникации готовятся заранее" },
    compilerPolicyVersion: "matrix-compiler-policy/v2",
    store: fixture.store,
    skills: {
      async compile() {
        calls.compile += 1;
        return compilerDraft;
      },
      async critique(input: Record<string, unknown>) {
        calls.criticEditor += 1;
        assert.equal("reasoning" in input, false, "critic-editor context must not contain compiler reasoning");
        return {
          schemaVersion: "vacancy-matrix-critic/v2",
          decision: "CORRECTED",
          successor: correctedSuccessor,
          changes: [{
            changeId: "remove-invented-threshold",
            sourceRefs: ["profile.resultImage.responseSpeed"],
            summary: "Удалён придуманный порог 15 минут; сохранено качественное требование",
          }],
          // Kept only to expose the legacy loop: a v2 coordinator must publish
          // successor directly and must not route these audit details to repair.
          violations: [{
            violationId: "INVENTED_THRESHOLD",
            severity: "error",
            sourceRefs: ["profile.resultImage.responseSpeed"],
            expectedChange: "Use the corrected successor returned by this editor call",
          }],
          traceRef: "trace-critic-editor-once",
          model: "synthetic-critic-editor",
        };
      },
      async repair() {
        calls.repair += 1;
        return correctedSuccessor;
      },
    },
  } as any);

  const failures: string[] = [];
  if (calls.compile !== 1) failures.push(`compiler calls expected 1; actual=${calls.compile}`);
  if (calls.criticEditor !== 1) failures.push(`critic-editor calls expected 1; actual=${calls.criticEditor}`);
  if (calls.repair !== 0) failures.push(`separate matrix repair calls expected 0; actual=${calls.repair}`);
  if (result.state !== "PUBLISHED") failures.push(`corrected successor expected PUBLISHED; actual=${JSON.stringify(result)}`);
  if (result.state === "FAILED" && ["MATRIX_REPAIR_BUDGET_EXHAUSTED", "MATRIX_REPEATED_OBSTACLE", "MATRIX_LLM_CALL_BUDGET_EXHAUSTED"].includes(result.errorCode)) {
    failures.push(`semantic correction must not terminate via legacy repair-loop budget; actual=${result.errorCode}`);
  }
  if (fixture.state.failed) failures.push(`compilation must not record terminal failure; actual=${fixture.state.failed}`);
  if (!fixture.state.published) failures.push("critic-editor successor was not canonicalized and published");
  const publishedCriterion = fixture.state.published?.criteria[0];
  if (publishedCriterion?.interpretation !== correctedCriterion.interpretation) {
    failures.push(`published interpretation must come from corrected successor; actual=${JSON.stringify(publishedCriterion?.interpretation)}`);
  }
  if (publishedCriterion?.interpretation.includes("15 минут")) failures.push("published successor retained the invented threshold");
  if (fixture.state.progress.some((entry) => entry.repairCycles > 0)) failures.push(`repair progress must stay empty/zero; actual=${JSON.stringify(fixture.state.progress)}`);
  if (result.state === "PUBLISHED" && (result.llmCalls !== 2 || result.repairCycles !== 0)) {
    failures.push(`published attempt expected llmCalls=2 and repairCycles=0; actual=${result.llmCalls}/${result.repairCycles}`);
  }
  if (fixture.state.protectedTraceRefs && JSON.stringify(fixture.state.protectedTraceRefs) !== JSON.stringify(["trace-compiler-once", "trace-critic-editor-once"])) {
    failures.push(`publish provenance must contain exactly compiler+editor traces; actual=${JSON.stringify(fixture.state.protectedTraceRefs)}`);
  }
  assert.deepEqual(failures, []);
});
