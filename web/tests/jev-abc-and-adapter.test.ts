import assert from "node:assert/strict";
import test from "node:test";
import { callRouterAiJev, protectedJevTrace, reviewAbcDirectionWithJev } from "../server/candidate-pipeline/jev-decisions.ts";
import { candidateFailureMessage, taskFailurePolicy } from "../server/agent-runtime/failure-policy.ts";

const keys = ["A", "B", "C", "insufficient"];
const answer = (choice: string, confidence = 0.96) => ({ model: "typesafe/jev-1.13-20260917", answers: {
  abcLevel: { type: "choice" as const, choice, confidence,
    probabilities: Object.fromEntries(keys.map((key) => [key, key === choice ? 0.97 : 0.01])) },
} });

test("ABC Jev review uses only the selected direction, approved scale and cited source fragments", async () => {
  const direction = { id: "autonomy", name: "Автономность", gradeA: "Самостоятельно планирует и улучшает работу", gradeB: "Самостоятельно выполняет задачи", gradeC: "Нуждается в сопровождении" };
  const assessed = { directionId: "autonomy", level: "B", evidenceLocatorIds: ["claim-1"], reason: "Стабильное выполнение" };
  const claims = [{ claimId: "claim-1", text: "Я сам распределял задачи на неделю", locator: "synthetic:line-1" },
    { claimId: "claim-2", text: "Секретный несвязанный материал", locator: "synthetic:line-2" }];
  let calls = 0;
  const result = await reviewAbcDirectionWithJev(direction, assessed, claims, async (request) => {
    calls += 1;
    assert.deepEqual(Object.keys(request.questions.abcLevel.criteria), keys);
    const state = JSON.stringify(request.state);
    assert.match(state, /Я сам распределял задачи/u);
    assert.doesNotMatch(state, /Секретный несвязанный материал/u);
    assert.doesNotMatch(state, /Стабильное выполнение/u);
    return answer("B");
  });
  assert.equal(calls, 1);
  assert.equal(result.warning, undefined);
});

test("ABC Jev review rejects confident disagreement, but records only a categorical uncertainty", async () => {
  const direction = { name: "Автономность", gradeA: "A", gradeB: "B", gradeC: "C" };
  const assessed = { level: "B", evidenceLocatorIds: ["claim-1"] };
  const claims = [{ claimId: "claim-1", text: "Пример", locator: "synthetic:1" }];
  await assert.rejects(reviewAbcDirectionWithJev(direction, assessed, claims, async () => answer("C")), /JEV_ABC_DISAGREEMENT/);
  const uncertain = await reviewAbcDirectionWithJev(direction, assessed, claims, async () => answer("C", 0.3));
  assert.equal(uncertain.warning, "JEV_ABC_UNCERTAIN");
  assert.doesNotMatch(JSON.stringify(uncertain), /confidence|0\.3/u);
  await assert.rejects(reviewAbcDirectionWithJev(direction, assessed,
    [{ claimId: "claim-1", text: "Пример", locator: "" }], async () => answer("B")), /JEV_ABC_EVIDENCE_INVALID/);
});

test("RouterAI Jev adapter uses its decisions endpoint with the existing RouterAI key and rejects malformed output", async () => {
  const request = { state: { document: "synthetic" }, questions: { abcLevel: { type: "choice" as const, instructions: "grade?",
    criteria: { A: "A", B: "B", C: "C", insufficient: "none" } } } };
  let calls = 0;
  const good = await callRouterAiJev(request, "synthetic-key", async (url, init) => {
    calls += 1;
    assert.equal(url, "https://routerai.ru/api/v1/decisions");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-key");
    assert.equal(JSON.parse(String(init?.body)).model, "typesafe/jev-1.13");
    return Response.json(answer("B"));
  });
  assert.equal(calls, 1);
  assert.equal(good.answers.abcLevel.choice, "B");
  await assert.rejects(callRouterAiJev(request, "synthetic-key", async () => Response.json(answer("invented"))), /JEV_RESPONSE_INVALID/);
});

test("protected Jev trace preserves decision context for 30 days without numeric model confidence", () => {
  const request = { state: { evidence: "synthetic candidate statement" }, questions: { abcLevel: { type: "choice" as const,
    instructions: "grade?", criteria: { A: "A", B: "B", C: "C", insufficient: "none" } } } };
  const trace = protectedJevTrace({ traceId: "trace-synthetic", callId: "call-synthetic", attemptId: "attempt-synthetic",
    attemptNumber: 1, workflowRunId: "run-synthetic", workflowStage: "jev-abc" }, request, answer("B"), new Date("2026-09-25T00:00:00.000Z"));
  assert.equal(trace.choices.abcLevel, "B");
  assert.equal(Date.parse(trace.expiresAt) - Date.parse(trace.createdAt), 30 * 24 * 60 * 60 * 1000);
  assert.doesNotMatch(JSON.stringify(trace), /confidence|probabilities|synthetic-key/u);
});

test("Jev transport failures retry durably while a confident disagreement asks for investigation", () => {
  assert.equal(taskFailurePolicy("candidate.abc-shard/v1", "JEV_HTTP_429", 1).retry, true);
  assert.equal(taskFailurePolicy("candidate.abc-shard/v1", "JEV_TIMEOUT", 1).retry, true);
  assert.equal(taskFailurePolicy("candidate.assessment-join/v1", "JEV_TRACE_WRITE_FAILED", 1).retry, true);
  assert.equal(taskFailurePolicy("candidate.abc-shard/v1", "JEV_ABC_DISAGREEMENT", 1).retry, false);
  assert.match(candidateFailureMessage("JEV_ABC_DISAGREEMENT"), /проверка ABC/u);
});
