import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticRegistries, validatePlan } from "./registry.ts";
import { classifyObstacle, DurableAgentRuntime, RuntimeConflictError } from "./runtime.ts";
import { validateAgentRuntimeConfiguration } from "./configuration.ts";
import type { GoalInput } from "./types.ts";

function goal(): GoalInput {
  return {
    goalType: "synthetic-candidate-processing/v1", goalId: "goal-1", runId: "run-1", candidateId: "candidate-1",
    inputVersion: "input-v1", profileVersion: "profile-v1", policyVersion: "agent-policy-v1",
    completionCriteriaVersion: "synthetic-completion-v1", completionCriteria: ["done"],
    budgets: { wallTimeMs: 10_000, taskAttempts: 4, repairAttempts: 1, replans: 1, llmCalls: 2, tokens: 100, costMicrounits: 100, externalRequests: 2 },
  };
}

test("plan validation rejects cycles, unsupported tools, stale scopes and missing gates", () => {
  const registries = createSyntheticRegistries();
  const valid = registries.goals.createPlan(goal());
  assert.equal(validatePlan(goal(), valid, registries.tools, goal()), true);
  assert.throws(() => validatePlan(goal(), valid.map((item) => ({ ...item, completionGate: undefined })), registries.tools, goal()), /MISSING_COMPLETION_GATE/);
  assert.throws(() => validatePlan(goal(), [{ key: "a", tool: "synthetic.evaluate/v1", dependencies: ["a"], expectedOutputs: [], completionGate: "done" }], registries.tools, goal()), /PLAN_CYCLE/);
  assert.throws(() => validatePlan(goal(), [{ key: "a", tool: "unknown", dependencies: [], expectedOutputs: [], completionGate: "done" }], registries.tools, goal()), /UNSUPPORTED_TOOL/);
  assert.throws(() => validatePlan(goal(), valid, registries.tools, { inputVersion: "stale", profileVersion: goal().profileVersion }), /STALE_INPUT_VERSION/);
});

test("lease fencing rejects late acknowledgement and duplicate triggers remain idempotent", () => {
  const runtime = new DurableAgentRuntime();
  runtime.createGoal(goal());
  assert.equal(runtime.ingestTrigger("input-ready", "trigger-1", goal()).accepted, true);
  assert.equal(runtime.ingestTrigger("input-ready", "trigger-1", goal()).duplicate, true);
  const first = runtime.claim("worker-a", 1, 0)!;
  runtime.operationOutcomes.set(first.idempotencyIdentity, { state: "ABSENT" });
  runtime.recoverStaleLeases(2);
  runtime.reconcileUnknown(first.id);
  const second = runtime.claim("worker-b", 10, 2)!;
  assert.throws(() => runtime.complete(first.id, "worker-a", first.leaseToken!), (error) => error instanceof RuntimeConflictError && error.code === "STALE_LEASE_TOKEN");
  runtime.complete(second.id, "worker-b", second.leaseToken!, { id: "artifact-1", checksum: "sha256:1" });
  assert.equal(runtime.exportSnapshot().tasks[0].state, "SUCCEEDED");
});

test("grant and budget denials happen before provider calls and survive restart", () => {
  const runtime = new DurableAgentRuntime();
  runtime.createGoal(goal());
  runtime.reserve({ externalRequests: 2 });
  runtime.commitReservation({ externalRequests: 2 });
  const restarted = new DurableAgentRuntime(undefined, undefined, runtime.exportSnapshot());
  assert.throws(() => restarted.reserve({ externalRequests: 1 }), /BUDGET_EXHAUSTED/);
  const intent = restarted.createIntent("publication-1", "reversible-write");
  const denied = restarted.executeIntent(intent.operationIdentity, () => ({ state: "CONFIRMED" }), { grantId: "missing", toolKey: "synthetic.publish-pdf/v1", operation: "execute", sideEffectClass: "reversible-write" });
  assert.equal(denied.called, false);
  assert.equal(restarted.providerCalls.size, 0);
  assert.equal(restarted.timeline().some((line) => line.includes("TOOL_POLICY_DENIED")), true);
});

test("context manifests are purpose- and run-scoped and never expose payloads", () => {
  const runtime = new DurableAgentRuntime();
  runtime.createGoal(goal());
  runtime.addMemory({ kind: "working", purpose: "locator-repair", provenance: "claim-1", sensitivity: "confidential", immutable: false, payload: { secret: "not-in-manifest" } });
  runtime.addMemory({ kind: "working", purpose: "unrelated", provenance: "claim-2", sensitivity: "confidential", immutable: false, payload: { content: "excluded" } });
  const manifest = runtime.contextManifest({ candidateId: goal().candidateId, runId: goal().runId, purpose: "locator-repair", allowSensitivities: ["confidential"] });
  assert.equal(manifest.length, 1);
  assert.equal("payload" in manifest[0], false);
  assert.throws(() => runtime.contextManifest({ candidateId: "candidate-2", runId: goal().runId, purpose: "locator-repair", allowSensitivities: ["confidential"] }), /CONTEXT_SCOPE_DENIED/);
});

test("archive and delete stop tasks, revoke grants and remove personal payloads", () => {
  const runtime = new DurableAgentRuntime();
  runtime.createGoal(goal());
  const task = runtime.exportSnapshot().tasks[0];
  const grant = runtime.issueGrant({ toolKey: task.tool, candidateId: goal().candidateId, runId: goal().runId, inputVersion: goal().inputVersion, policyVersion: goal().policyVersion, sideEffectClass: "idempotent-write", operations: ["execute"], budgetLink: goal().runId, expiresAt: Date.now() + 60_000 });
  runtime.addMemory({ kind: "working", purpose: "analysis", provenance: "test", sensitivity: "personal", immutable: false, payload: { personal: true } });
  runtime.deleteCandidateRuntime();
  const state = runtime.exportSnapshot();
  assert.equal(state.deleted, true);
  assert.equal(state.tasks.every((item) => item.state === "CANCELLED"), true);
  assert.ok(state.grants.find((item) => item.id === grant.id)?.revokedAt);
  assert.equal(state.memory.some((item) => item.sensitivity !== "non-personal-policy"), false);
});

test("runtime configuration requires every hard budget and safe worker cadence", () => {
  const valid = { version: "runtime-policy-v1", budgets: goal().budgets, leaseMs: 30_000, heartbeatMs: 10_000, pollingMs: 1_000, flags: { synthetic: true, shadow: false, acceptNewGoals: true, toolRouting: { transcription: "legacy" as const } } };
  assert.equal(validateAgentRuntimeConfiguration(valid).version, valid.version);
  assert.throws(() => validateAgentRuntimeConfiguration({ ...valid, budgets: { ...valid.budgets, tokens: 0 } }), /BUDGET_INVALID:tokens/);
  assert.throws(() => validateAgentRuntimeConfiguration({ ...valid, heartbeatMs: valid.leaseMs }), /HEARTBEAT_MUST_PRECEDE/);
});

test("obstacles are classified before retry, repair, replan or escalation", () => {
  assert.equal(classifyObstacle({ code: "NETWORK", retryable: true }), "transient");
  assert.equal(classifyObstacle({ code: "SCHEMA", repairable: true }), "repairable");
  assert.equal(classifyObstacle({ code: "PLAN", recoveryTemplate: "alternate" }), "replan-required");
  assert.equal(classifyObstacle({ code: "FILE", humanActions: ["replace-file"] }), "human-required");
  assert.equal(classifyObstacle({ code: "POLICY", policyTerminal: true }), "terminal");
});
