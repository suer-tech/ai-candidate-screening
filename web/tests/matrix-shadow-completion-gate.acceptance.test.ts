import assert from "node:assert/strict";
import test from "node:test";
import { GoalRegistry, ToolRegistry, validatePlan } from "../server/agent-runtime/registry.ts";
import type { GoalInput } from "../server/agent-runtime/types.ts";
import { registerCanonicalCandidatePipeline } from "../server/candidate-pipeline/goal.ts";

test("MATRIX-SHADOW-GATE-RED-001: shadow validation is the validated-assessment completion gate and the plan validates", () => {
  const tools = new ToolRegistry();
  const goals = new GoalRegistry();
  registerCanonicalCandidatePipeline(tools, goals);
  const goal: GoalInput = {
    goalType: "candidate-analysis-matrix-shadow/v1",
    goalId: "goal-shadow-gate-synthetic",
    runId: "run-shadow-gate-synthetic",
    candidateId: "candidate-shadow-gate-synthetic",
    inputVersion: "input-shadow-gate-v1",
    profileVersion: "profile-shadow-gate-v1",
    policyVersion: "candidate-policy-v1",
    completionCriteriaVersion: "candidate-completion-v1",
    completionCriteria: ["validated-assessment"],
    budgets: {
      wallTimeMs: 1,
      taskAttempts: 1,
      repairAttempts: 1,
      replans: 1,
      llmCalls: 1,
      tokens: 1,
      costMicrounits: 1,
      externalRequests: 1,
    },
  };
  const plan = goals.createPlan(goal);
  const failures: string[] = [];
  const validation = plan.find((task) => task.key === "validation");
  if (validation?.completionGate !== "validated-assessment") {
    failures.push(`validation completionGate expected validated-assessment; actual=${JSON.stringify(validation?.completionGate)}`);
  }
  try {
    assert.equal(validatePlan(goal, plan, tools, {
      inputVersion: goal.inputVersion,
      profileVersion: goal.profileVersion,
    }), true);
  } catch (error) {
    failures.push(`validatePlan must accept the shadow plan; actual=${error instanceof Error ? error.message : "UNKNOWN_ERROR"}`);
  }
  assert.deepEqual(failures, []);
});
