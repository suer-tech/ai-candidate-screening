import assert from "node:assert/strict";
import test from "node:test";
import { buildAssessmentJoin } from "../server/candidate-pipeline/assessment-join.ts";

const choiceKeys = ["recommend", "caveats", "reject", "insufficient"] as const;

type ChoiceRequest = {
  state: unknown;
  questions: { recommendation: { type: "choice"; criteria: Record<string, unknown> } };
};
type ChoiceResponse = { model: string; answers: { recommendation: {
  type: "choice"; choice: string; confidence: number; probabilities: Record<string, number>;
} } };
type JoinWithJev = (
  input: Parameters<typeof buildAssessmentJoin>[0],
  summaryCall: Parameters<typeof buildAssessmentJoin>[1],
  jevChoice: (request: ChoiceRequest) => Promise<ChoiceResponse>,
) => ReturnType<typeof buildAssessmentJoin>;
const joinWithJev = buildAssessmentJoin as unknown as JoinWithJev;

function syntheticInput(): Parameters<typeof buildAssessmentJoin>[0] {
  const evidence = { claimId: "synthetic-claim-1", sourceRef: "synthetic-transcript:line-2",
    quote: "Я составлял редакционный план", relation: "SUPPORTS" as const, explanation: "Пример опыта" };
  return {
    matrixId: "synthetic-matrix-v1",
    matrix: { profileVersion: "synthetic-vacancy-v1", criteria: [{ criterionId: "synthetic-criterion-1" }] },
    evidenceRef: "artifact://synthetic/evidence",
    evidence: { claims: [{ claimId: evidence.claimId, sourceRef: evidence.sourceRef, text: evidence.quote }] },
    rows: {
      rows: [{ criterionId: "synthetic-criterion-1", supportingClaimIds: [evidence.claimId], contradictingClaimIds: [],
        checkedSourceIds: [evidence.sourceRef], state: "Соответствует", reason: "Пример подтверждён",
        evidence: [evidence], missingData: "", followUpQuestion: "", verificationState: "NOT_REQUIRED" }],
      coverageSummary: { criterionCount: 1, coveredCount: 1 },
      warnings: [], traceRefs: ["synthetic-row-trace"],
    },
    abc: { directions: [{ directionId: "synthetic-productivity", level: "B", reason: "Стабильный результат",
      evidenceLocatorIds: [evidence.claimId] }], warnings: [], traceRefs: ["synthetic-abc-trace"] },
  };
}

function summaryCall() {
  return Promise.resolve({
    output: { schemaVersion: "candidate-assessment-summary/v1", recommendation: "Рекомендовать",
      recommendationReason: "Подтверждены результаты и опыт по синтетическим материалам." },
    traceRef: "synthetic-summary-trace",
  });
}

function choice(choiceKey: typeof choiceKeys[number], confidence: number): ChoiceResponse {
  return { model: "synthetic-jev", answers: { recommendation: { type: "choice", choice: choiceKey, confidence,
    probabilities: Object.fromEntries(choiceKeys.map((option) => [option, option === choiceKey ? confidence : (1 - confidence) / 3])) } } };
}

function assertClosedChoiceRequest(request: ChoiceRequest) {
  assert.equal(request.questions?.recommendation?.type, "choice");
  assert.deepEqual(new Set(Object.keys(request.questions.recommendation.criteria)), new Set(choiceKeys),
    "Jev must choose from four closed ASCII keys mapped to the exact product recommendation values");
  assert.ok(request.state && typeof request.state === "object", "Jev receives synthetic assessment context");
  assert.doesNotMatch(JSON.stringify(request.state), /Я составлял редакционный план/u,
    "Jev state must use compact reasons and references, not the full raw evidence quote");
}

test("matrix-v4 assessment join invokes closed Jev Choice and preserves evidence, rows and ABC on agreement", async () => {
  const input = syntheticInput();
  const before = structuredClone(input);
  let jevCalls = 0;
  const result = await joinWithJev(input, async () => summaryCall(), async (request) => {
    jevCalls += 1;
    assertClosedChoiceRequest(request);
    return choice("recommend", 0.96);
  });
  assert.equal(jevCalls, 1, "one Jev Choice must verify the holistic recommendation");
  assert.equal(result.recommendation, "Рекомендовать");
  assert.equal(result.matrixId, before.matrixId);
  assert.equal(result.evidenceRef, before.evidenceRef);
  assert.deepEqual(result.rows, before.rows.rows);
  assert.deepEqual(result.abcDirections, before.abc.directions);
  assert.deepEqual(result.coverageSummary, before.rows.coverageSummary);
  for (const ref of ["synthetic-row-trace", "synthetic-abc-trace", "synthetic-summary-trace"])
    assert.ok(result.traceRefs.includes(ref), `provenance ${ref} must survive the Jev check`);
  assert.deepEqual(input, before, "Jev review must not mutate durable inputs");
});

test("matrix-v4 assessment join blocks high-confidence Jev disagreement before publication", async () => {
  const input = syntheticInput();
  let jevCalls = 0;
  await assert.rejects(joinWithJev(input, async () => summaryCall(), async (request) => {
    jevCalls += 1;
    assertClosedChoiceRequest(request);
    return choice("reject", 0.95);
  }), /JEV_RECOMMENDATION_DISAGREEMENT/);
  assert.equal(jevCalls, 1);
});

test("matrix-v4 assessment join retains LLM result but marks uncertain Jev review without persisting a numeric confidence", async () => {
  const input = syntheticInput();
  let jevCalls = 0;
  const result = await joinWithJev(input, async () => summaryCall(), async (request) => {
    jevCalls += 1;
    assertClosedChoiceRequest(request);
    return choice("recommend", 0.3);
  });
  assert.equal(jevCalls, 1);
  assert.equal(result.recommendation, "Рекомендовать");
  assert.ok(result.warnings.includes("JEV_RECOMMENDATION_UNCERTAIN"));
  assert.deepEqual(result.rows, input.rows.rows);
  assert.deepEqual(result.abcDirections, input.abc.directions);
  assert.equal(result.evidenceRef, input.evidenceRef);
  assert.doesNotMatch(JSON.stringify(result), /"confidence"\s*:\s*0\.3\b/u,
    "ASM-015 forbids publishing a numerical confidence on the decision artifact");
});
