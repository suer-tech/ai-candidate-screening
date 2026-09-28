import assert from "node:assert/strict";
import test from "node:test";
import { taskFailurePolicy } from "../server/agent-runtime/failure-policy.ts";
import { reviewAbcDirectionWithJev } from "../server/candidate-pipeline/jev-decisions.ts";

const toolKey = "candidate.abc-shard/v1";
const code = "JEV_ABC_EVIDENCE_UNKNOWN";
const direction = { id: "autonomy", name: "Автономность", gradeA: "Самостоятельно улучшает процесс",
  gradeB: "Самостоятельно выполняет задачи", gradeC: "Требуется сопровождение" };
const claims = [{ claimId: "claim-known", text: "Я самостоятельно планировал задачи на неделю.", locator: "synthetic:line-2" }];

test("ABC review rejects an invented evidence ID before the independent decision call", async () => {
  let jevCalls = 0;
  await assert.rejects(reviewAbcDirectionWithJev(direction,
    { directionId: direction.id, level: "B", evidenceLocatorIds: ["claim-invented"] }, claims,
    async () => { jevCalls += 1; throw new Error("JEV_MUST_NOT_BE_CALLED"); }),
  { message: code });
  assert.equal(jevCalls, 0, "an unknown claim must never be admitted to the Jev context");
});

test("JEV_ABC_EVIDENCE_UNKNOWN retries only the ABC shard once, after five seconds", () => {
  assert.deepEqual(taskFailurePolicy(toolKey, code, 1), { retry: true, delayMs: 5_000, maxAttempts: 2 });
  assert.deepEqual(taskFailurePolicy(toolKey, code, 2), { retry: false, delayMs: 0, maxAttempts: 2 });
  assert.deepEqual(taskFailurePolicy(toolKey, code, 3), { retry: false, delayMs: 0, maxAttempts: 2 });
  for (const upstream of ["candidate.evidence-shard/v1", "candidate.matrix-conflict-submit/v1", "candidate.row-shard/v1"]) {
    assert.equal(taskFailurePolicy(upstream, code, 1).retry, false,
      `${upstream} must not restart because one ABC assessment invented a claim ID`);
  }
});

test("a second unknown ID remains a failure rather than an accepted ABC assessment", async () => {
  let jevCalls = 0;
  for (const attempt of [1, 2]) {
    await assert.rejects(reviewAbcDirectionWithJev(direction,
      { directionId: direction.id, level: "B", evidenceLocatorIds: [`claim-invented-${attempt}`] }, claims,
      async () => { jevCalls += 1; throw new Error("JEV_MUST_NOT_BE_CALLED"); }),
    { message: code });
  }
  assert.equal(taskFailurePolicy(toolKey, code, 2).retry, false);
  assert.equal(jevCalls, 0);
});

test("a corrected ABC assessment can complete on the second attempt using the pinned claims", async () => {
  let jevCalls = 0;
  const assess = (evidenceLocatorIds: string[]) => reviewAbcDirectionWithJev(direction,
    { directionId: direction.id, level: "B", evidenceLocatorIds }, claims,
    async (request) => {
      jevCalls += 1;
      assert.deepEqual(request.state && (request.state as { citedEvidence: unknown[] }).citedEvidence,
        [{ text: claims[0].text, locator: claims[0].locator }]);
      return { model: "typesafe/jev-1.13-synthetic", answers: { abcLevel: { type: "choice", choice: "B",
        confidence: 0.96, probabilities: { A: 0.01, B: 0.97, C: 0.01, insufficient: 0.01 } } } };
    });
  await assert.rejects(assess(["claim-invented"]), { message: code });
  const reviewed = await assess(["claim-known"]);
  assert.equal(reviewed.warning, undefined);
  assert.equal(jevCalls, 1);
});
