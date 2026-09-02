import assert from "node:assert/strict";
import test from "node:test";
import { GoalRegistry, ToolRegistry, validatePlan } from "../agent-runtime/registry.ts";
import type { GoalInput } from "../agent-runtime/types.ts";
import { StabilityTracker, classifyMaterials, estimateRemainingDuration, snapshotDrive } from "./core.ts";
import { registerCanonicalCandidatePipeline } from "./goal.ts";

const object = (fileId: string, mimeType: string, size = 10) => ({ fileId, parentFolderId: "folder-1", version: "1", name: fileId, mimeType, size, modifiedTime: "2026-08-20T00:00:00Z" });

test("Drive stability requires three unchanged complete comparisons and ignores failed intervals", () => {
  const tracker = new StabilityTracker();
  const first = snapshotDrive("folder-1", [object("resume", "application/pdf")], "2026-08-20T00:00:00Z");
  assert.equal(tracker.observe(first).stable, false);
  assert.equal(tracker.observe({ complete: false }).skippedProviderError, true);
  assert.equal(tracker.observe(first).stableComparisons, 1);
  assert.equal(tracker.observe(first).stableComparisons, 2);
  assert.equal(tracker.observe(first).stable, true);
  const changed = snapshotDrive("folder-1", [object("resume", "application/pdf", 11)], "2026-08-20T00:04:00Z");
  assert.equal(tracker.observe(changed).stableComparisons, 0);
});

test("material manifest excludes Results and requires a resume plus at least one interview", () => {
  const manifest = classifyMaterials([
    object("resume", "application/pdf"),
    object("interview", "video/mp4"),
    { ...object("result", "application/pdf"), inResultsSubtree: true },
  ]);
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.resumeIds, ["resume"]);
  assert.deepEqual(manifest.interviewIds, ["interview"]);
});

test("ready text transcripts and recordings are all accepted as interview sources", () => {
  const ready = { ...object("transcript", "text/plain"), name: "Стенограмма интервью.txt" };
  const manifest = classifyMaterials([object("resume", "application/pdf"), ready]);
  assert.equal(manifest.complete, true);
  assert.equal(manifest.entries.find((entry) => entry.fileId === "transcript")?.interviewSource, "ready-transcript");
  const multiple = classifyMaterials([object("resume", "application/pdf"), ready, object("recording", "audio/mpeg")]);
  assert.equal(multiple.complete, true);
  assert.deepEqual(multiple.interviewIds, ["transcript", "recording"]);
  assert.deepEqual(multiple.ambiguities, []);
});

test("ETA stays unavailable below ten comparable successful runs", () => {
  assert.equal(estimateRemainingDuration(Array(9).fill(60000)).available, false);
  assert.equal(estimateRemainingDuration(Array(10).fill(60000)).available, true);
});

test("canonical goal graph is registered against durable runtime tools", () => {
  const tools = new ToolRegistry();
  const goals = new GoalRegistry();
  registerCanonicalCandidatePipeline(tools, goals);
  const goal: GoalInput = { goalType: "candidate-analysis-matrix/v1", goalId: "goal-1", runId: "run-1", candidateId: "1", inputVersion: "input-1", profileVersion: "profile-1", policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1", completionCriteria: ["validated-candidate-report", "ready-after-report-publication"], budgets: { wallTimeMs: 1, taskAttempts: 1, repairAttempts: 1, replans: 1, llmCalls: 1, tokens: 1, costMicrounits: 1, externalRequests: 1 } };
  const plan = goals.createPlan(goal);
  assert.equal(validatePlan(goal, plan, tools, { inputVersion: "input-1", profileVersion: "profile-1" }), true);
  assert.equal(plan.at(-1)?.key, "notification");
  const cleanupGoal: GoalInput = { ...goal, goalType: "candidate-cleanup/v1", goalId: "cleanup-goal", runId: "cleanup-run", completionCriteriaVersion: "candidate-cleanup-completion-v1", completionCriteria: ["all-cleanup-confirmations-persisted"] };
  const cleanup = goals.createPlan(cleanupGoal);
  assert.equal(validatePlan(cleanupGoal, cleanup, tools, { inputVersion: "input-1", profileVersion: "profile-1" }), true);
  assert.equal(cleanup.at(-1)?.key, "tombstone");
});
