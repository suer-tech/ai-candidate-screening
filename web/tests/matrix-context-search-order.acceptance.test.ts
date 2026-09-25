import assert from "node:assert/strict";
import test from "node:test";
import { registerCanonicalCandidatePipeline } from "../server/candidate-pipeline/goal.ts";
import { createSyntheticRegistries } from "../server/agent-runtime/registry.ts";
import { DurableAgentRuntime } from "../server/agent-runtime/runtime.ts";
import { emptyUsage, type GoalInput } from "../server/agent-runtime/types.ts";

for (const workflowVersion of ["matrix-v3", "matrix-v4-rabbit-parallel"]) {
  test(`MDA-001/WF-030: ${workflowVersion} waits for successful matrix compilation before context search is runnable`, () => {
    const registries = createSyntheticRegistries();
    registerCanonicalCandidatePipeline(registries.tools, registries.goals);
    const goal: GoalInput = {
      goalType: "candidate-analysis-matrix/v1", goalId: `goal-${workflowVersion}`, runId: `run-${workflowVersion}`,
      candidateId: "synthetic-candidate", inputVersion: "synthetic-input-v1", profileVersion: "synthetic-profile-v1",
      workflowVersion, policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1",
      completionCriteria: ["validated-candidate-report"],
      budgets: Object.fromEntries(Object.keys(emptyUsage()).map((key) => [key, 100])) as GoalInput["budgets"],
    };
    const runtime = new DurableAgentRuntime(registries.tools, registries.goals);
    const created = runtime.createGoal(goal);
    const materialDependencies = workflowVersion === "matrix-v4-rabbit-parallel"
      ? ["documents-join", "transcripts-join"] : ["documents", "transcription"];

    // Simulate completed material branches while the shared compiler is still running.
    runtime.command(created.revision, "SYNTHETIC_MATERIALS_READY", "test", {}, (state) => {
      for (const key of materialDependencies) state.tasks.find((task) => task.key === key)!.state = "SUCCEEDED";
      const matrix = state.tasks.find((task) => task.key === "matrix")!;
      matrix.state = "RUNNING";
      matrix.leaseOwner = "synthetic-compiler";
      matrix.leaseToken = 1;
    });
    runtime.promoteEligible();
    assert.equal(runtime.exportSnapshot().tasks.find((task) => task.key === "context-search")?.state, "PENDING",
      "context search must wait even when both candidate material branches have completed");

    const matrix = runtime.exportSnapshot().tasks.find((task) => task.key === "matrix")!;
    runtime.complete(matrix.id, "synthetic-compiler", 1, { id: `matrix-${workflowVersion}`, checksum: "synthetic-checksum" });
    assert.equal(runtime.exportSnapshot().tasks.find((task) => task.key === "context-search")?.state, "RUNNABLE",
      "context search becomes runnable after successful matrix compilation");
  });
}
