import assert from "node:assert/strict";
import test from "node:test";
import { assessmentInputsFromStructured, groundStructuredAssessment, validateAbcAssessmentSemantics } from "./production-runtime.ts";

test("automatic KE admission requires every required condition, not one confirmed condition", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    name: `Условие ${index + 1}`,
    required: true,
    state: index < 2 ? "Подтверждено" : "Недостаточно данных",
    reason: index < 2 ? "Есть факт" : "Нет факта",
    factIds: index < 2 ? [`fact-${index + 1}`] : [],
  }));
  const partial = assessmentInputsFromStructured({ observations: [], competencies: [], accessToKe: items, risks: [], stopFactors: [], abcStates: {} }, []);
  assert.equal(partial.accessToKePositive, false);
  assert.equal(partial.requiredItemsInsufficient.length, 8);
  const complete = assessmentInputsFromStructured({ observations: [], competencies: [], accessToKe: items.map((item) => ({ ...item, state: "Подтверждено" })), risks: [], stopFactors: [], abcStates: {} }, []);
  assert.equal(complete.accessToKePositive, true);
  const requiredOnly = assessmentInputsFromStructured({ observations: [], competencies: [], accessToKe: items.map((item, index) => ({ ...item, required: index < 2, state: index < 2 ? "Подтверждено" : "Не подтверждено" })), risks: [], stopFactors: [], abcStates: {} }, []);
  assert.equal(requiredOnly.accessToKePositive, true, "optional conditions do not block admission");
});

test("assessment grounding rejects unsupported grades, risks and stop factors", () => {
  const grounded = groundStructuredAssessment({
    observations: [{ criterionId: "direction-supported", state: "Подтверждено", factIds: ["fact-1"] }],
    abcStates: { "direction-supported": "A", "direction-invented": "C" },
    abcEvidence: { "direction-supported": { factIds: ["fact-1"] } },
    competencies: [{ name: "supported", state: "Подтверждено", factIds: ["fact-1"] }, { name: "invented", state: "Подтверждено" }],
    accessToKe: [{ state: "Подтверждено", factIds: ["fact-missing"] }],
    risks: [{ name: "supported", factIds: ["fact-1"] }, { name: "invented" }],
    stopFactors: [{ name: "supported", state: "Подтверждено", factIds: ["fact-1"] }, { name: "invented", state: "Подтверждено" }],
  }, [{ id: "fact-1" }]);
  assert.deepEqual(grounded.abcStates, { "direction-supported": "A", "direction-invented": "Недостаточно данных" });
  assert.equal(grounded.risks.length, 1);
  assert.equal(grounded.stopFactors.length, 1);
  assert.equal(grounded.competencies[1].state, "Недостаточно данных");
  assert.equal(grounded.accessToKe[0].state, "Недостаточно данных");
});

test("ABC semantic validator rejects A selected from a partial match", () => {
  const output = {
    abcStates: { productivity: "A" },
    abcEvidence: { productivity: { factIds: ["fact-1"], reason: "Подтверждена только фиксация статусов", levels: {
      A: { definition: "A", matchedConditions: ["Ведёт актуальный список поручений"], missingConditions: ["Соблюдает сроки", "Заранее сообщает о рисках"], contradictingFactIds: [] },
      B: { definition: "B", matchedConditions: ["Обновляет статусы"], missingConditions: [], contradictingFactIds: [] },
      C: { definition: "C", matchedConditions: [], missingConditions: [], contradictingFactIds: ["fact-1"] },
    } } },
  };
  assert.throws(() => validateAbcAssessmentSemantics(output, [{ id: "productivity", gradeA: "A", gradeB: "B", gradeC: "C" }]), /ABC_GRADE_A_INCOMPLETE:productivity/);
  output.abcStates.productivity = "B";
  assert.doesNotThrow(() => validateAbcAssessmentSemantics(output, [{ id: "productivity", gradeA: "A", gradeB: "B", gradeC: "C" }]));
});

test("ABC semantic validator rejects a lower grade when a higher grade is eligible and unknown fact references", () => {
  const directions = [{ id: "initiative", gradeA: "A rule", gradeB: "B rule", gradeC: "C rule" }];
  const assessment = {
    abcStates: { initiative: "B" },
    abcEvidence: { initiative: { factIds: ["fact-1"], reason: "Выбран уровень B", levels: {
      A: { definition: "A rule", matchedConditions: ["A выполнен"], missingConditions: [], contradictingFactIds: [] },
      B: { definition: "B rule", matchedConditions: ["B выполнен"], missingConditions: [], contradictingFactIds: [] },
      C: { definition: "C rule", matchedConditions: [], missingConditions: ["C не выбран"], contradictingFactIds: [] },
    } } },
  };
  assert.throws(() => validateAbcAssessmentSemantics(assessment, directions, new Set(["fact-1"])), /ABC_HIGHER_GRADE_ELIGIBLE/);
  assessment.abcEvidence.initiative.levels.A.missingConditions = ["Нет обязательного результата"];
  assessment.abcEvidence.initiative.factIds = ["unknown-fact"];
  assert.throws(() => validateAbcAssessmentSemantics(assessment, directions, new Set(["fact-1"])), /ABC_UNKNOWN_FACT_REFERENCE/);
});

test("ABC grounding requires A, B or C for grounded facts and allows only evidence-backed conflicts", () => {
  assert.throws(() => groundStructuredAssessment({
    observations: [],
    abcStates: { initiative: "Недостаточно данных" },
    abcEvidence: { initiative: { factIds: ["fact-1"], reason: "Факт описывает наблюдаемое поведение" } },
    competencies: [], accessToKe: [], risks: [], stopFactors: [],
  }, [{ id: "fact-1" }]), /ABC_EXACT_GRADE_REQUIRED:initiative/);

  const conflicted = groundStructuredAssessment({
    observations: [],
    abcStates: { initiative: "CONFLICT" },
    abcEvidence: { initiative: { factIds: ["fact-1", "fact-2"] } },
    competencies: [], accessToKe: [], risks: [], stopFactors: [],
  }, [{ id: "fact-1" }, { id: "fact-2" }], [{ factIds: ["fact-1", "fact-2"], resolved: false }]);
  assert.deepEqual(conflicted.abcStates, { initiative: "CONFLICT" });

  assert.throws(() => groundStructuredAssessment({
    observations: [],
    abcStates: { initiative: "CONFLICT" },
    abcEvidence: { initiative: { factIds: ["fact-1"] } },
    competencies: [], accessToKe: [], risks: [], stopFactors: [],
  }, [{ id: "fact-1" }]), /ABC_CONFLICT_EVIDENCE_REQUIRED:initiative/);

  const grounded = groundStructuredAssessment({
    observations: [],
    abcStates: { initiative: "B", autonomy: "A", productivity: "C" },
    abcEvidence: {
      initiative: { factIds: ["fact-1"] }, autonomy: { factIds: ["fact-1"] }, productivity: { factIds: ["fact-1"] },
    },
    competencies: [], accessToKe: [], risks: [], stopFactors: [],
  }, [{ id: "fact-1" }]);
  assert.deepEqual(grounded.abcStates, { initiative: "B", autonomy: "A", productivity: "C" });
});
