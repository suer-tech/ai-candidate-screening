import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { canonicalJoin, createFanoutDescriptor, fanoutGroupId, fanoutRecoveryFingerprint, fanoutShardTaskId } from "./fanout.ts";
import { assertToolRouting, createRabbitTaskEnvelope, parseRabbitTaskEnvelope, RABBIT_TASK_ROUTING_REGISTRY, routingClassForTool } from "./rabbitmq-contracts.ts";
import { createSyntheticRegistries, validatePlan } from "./registry.ts";
import { registerCanonicalCandidatePipeline } from "../candidate-pipeline/goal.ts";
import { emptyUsage } from "./types.ts";
import { recoveryArtifactSchema } from "../candidate-pipeline/recovery-contracts.ts";
import { confirmPublish } from "./rabbitmq.ts";
import { RabbitTaskWorker } from "./rabbitmq-worker.ts";

test("mandatory Rabbit publish rejects a broker return even when publisher confirm succeeds", async () => {
  const envelope = createRabbitTaskEnvelope({ taskId: "task-return", runId: "run-return", taskVersion: 1, routingClass: "control", attemptHint: 0 });
  const channel = new EventEmitter() as EventEmitter & { publish: (...args: any[]) => boolean };
  channel.publish = (...args: any[]) => {
    const options = args[3];
    const callback = args[4];
    channel.emit("return", { properties: { messageId: options.messageId } });
    callback(null);
    return true;
  };
  await assert.rejects(() => confirmPublish(channel as any, envelope, "dispatch-return"), /RABBIT_PUBLISH_UNROUTABLE/);
});

test("server-side consumer cancellation terminates the worker connection for supervised restart", async () => {
  const worker = new RabbitTaskWorker({} as any, new Map());
  let rejected = "";
  let closed = false;
  (worker as any).rejectConsumerCancellation = (error: Error) => { rejected = error.message; };
  (worker as any).connection = { close: async () => { closed = true; } };
  (worker as any).onMessage(null);
  await Promise.resolve();
  assert.equal(rejected, "RABBIT_CONSUMER_CANCELLED");
  assert.equal(closed, true);
});

test("Rabbit envelope contains technical allowlisted fields only", () => {
  const envelope = createRabbitTaskEnvelope({ taskId: "task-1", runId: "run-1", taskVersion: 2, routingClass: "llm", attemptHint: 0 });
  assert.equal(parseRabbitTaskEnvelope(envelope).taskId, "task-1");
  for (const field of ["candidateName", "documentText", "transcript", "prompt", "secret", "signedUrl"]) {
    assert.throws(() => parseRabbitTaskEnvelope({ ...envelope, [field]: "forbidden" }), /RABBIT_ENVELOPE_FIELDS_REJECTED/);
  }
  assert.throws(() => assertToolRouting("candidate.row-shard/v1", "documents"), /RABBIT_TASK_ROUTE_MISMATCH/);
  assert.equal(routingClassForTool("candidate.transcript-shard/v1"), "transcription");
  assert.throws(
    () => routingClassForTool("candidate.matrix-unregistered-future-tool/v99"),
    /RABBIT_TASK_ROUTE_UNKNOWN/,
    "routing is an exact registry: a prefix match must not authorize an unregistered task",
  );
});

test("fan-out identity and canonical join are deterministic and exact", () => {
  const descriptor = createFanoutDescriptor({ workflowVersion: "matrix-v4-rabbit-parallel", runId: "run-1", planVersion: 1, groupKey: "documents", kind: "documents",
    inputFingerprint: "input-1", profileFingerprint: "profile-1", configFingerprint: "config-1",
    shards: [{ identity: "source-b" }, { identity: "source-a" }] });
  assert.deepEqual(descriptor.shards.map((item) => item.identity), ["source-a", "source-b"]);
  assert.equal(fanoutGroupId(descriptor), fanoutGroupId(structuredClone(descriptor)));
  assert.equal(fanoutShardTaskId(fanoutGroupId(descriptor), "source-a"), fanoutShardTaskId(fanoutGroupId(descriptor), "source-a"));
  assert.deepEqual(canonicalJoin(descriptor.shards, [{ shardIdentity: "source-b", value: 2 }, { shardIdentity: "source-a", value: 1 }]).map((item) => item.value), [1, 2]);
  assert.throws(() => canonicalJoin(descriptor.shards, [{ shardIdentity: "source-a" }]), /FANOUT_REQUIRED_SHARD_MISSING/);
  assert.throws(() => canonicalJoin(descriptor.shards, [{ shardIdentity: "source-a" }, { shardIdentity: "source-a" }]), /FANOUT_DUPLICATE_SHARD_RESULT/);
  assert.throws(() => createFanoutDescriptor({ workflowVersion: "matrix-v4-rabbit-parallel", runId: "run-1", planVersion: 1, groupKey: "bad", kind: "bad",
    inputFingerprint: "input-1", profileFingerprint: "profile-1", configFingerprint: "config-1",
    shards: [{ identity: "collect", dependsOn: ["missing-submit"] }] }), /FANOUT_SHARD_DEPENDENCY_UNKNOWN/);
});

test("matrix-v4 graph keeps every required join ahead of recommendation", () => {
  const registries = createSyntheticRegistries(); registerCanonicalCandidatePipeline(registries.tools, registries.goals);
  const goal = { goalType: "candidate-analysis-matrix/v1", goalId: "goal-1", runId: "run-1", candidateId: "1", inputVersion: "input-1", profileVersion: "profile-1",
    workflowVersion: "matrix-v4-rabbit-parallel", policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1", completionCriteria: ["validated-candidate-report"],
    budgets: { ...emptyUsage(), wallTimeMs: 1, taskAttempts: 1, repairAttempts: 1, replans: 1, llmCalls: 1, tokens: 1, costMicrounits: 1, externalRequests: 1 } };
  const plan = registries.goals.createPlan(goal);
  assert.equal(validatePlan(goal, plan, registries.tools, goal), true);
  const byKey = new Map(plan.map((item) => [item.key, item]));
  assert.deepEqual(byKey.get("context-search")?.dependencies.sort(), ["documents-join", "transcripts-join"]);
  assert.deepEqual(byKey.get("assessment-join")?.dependencies.sort(), ["abc-join", "rows-join"]);
  assert.deepEqual(byKey.get("recommendation")?.dependencies, ["critical-join"]);

  const planToolKeys = plan.map((task) => task.tool);
  const registeredShardKeys = [...registries.tools.tools.values()].map((definition) => definition.key)
    .filter((key) => key.startsWith("candidate.") && key.endsWith("-shard/v1"));
  const canonicalToolKeys = [...new Set([...planToolKeys, ...registeredShardKeys])].sort();
  for (const key of canonicalToolKeys) {
    assert.equal(registries.tools.get(key).key, key);
    assert.equal(routingClassForTool(key), RABBIT_TASK_ROUTING_REGISTRY[key], `exact Rabbit route for ${key}`);
  }
  for (const key of Object.keys(RABBIT_TASK_ROUTING_REGISTRY)) {
    assert.doesNotThrow(() => registries.tools.get(key), `Rabbit alias without ToolRegistry definition: ${key}`);
  }
});

test("parallel recovery fingerprint and schemas reject incompatible checkpoints", () => {
  const base = createFanoutDescriptor({ workflowVersion: "matrix-v4-rabbit-parallel", runId: "run-a", planVersion: 1, groupKey: "evidence", kind: "evidence",
    inputFingerprint: "input-1", profileFingerprint: "profile-1", configFingerprint: "config-1", shards: [{ identity: "batch-a", payload: { criterionIds: ["criterion-a"] } }] });
  const successor = { ...structuredClone(base), runId: "run-b", planVersion: 2 };
  assert.equal(fanoutRecoveryFingerprint(base), fanoutRecoveryFingerprint(successor), "run/plan identity may change during compatible recovery");
  assert.notEqual(fanoutRecoveryFingerprint(base), fanoutRecoveryFingerprint({ ...successor, configFingerprint: "config-2" }));
  for (const key of ["candidate.document-shard/v1", "candidate.transcript-shard/v1", "candidate.transcript-normalize-shard/v1", "candidate.transcript-media-shard/v1",
    "candidate.transcript-submit-shard/v1", "candidate.transcript-collect-shard/v1", "candidate.evidence-shard/v1", "candidate.row-shard/v1", "candidate.abc-shard/v1", "candidate.critical-shard/v1"]) {
    assert.ok(recoveryArtifactSchema("matrix-v4-rabbit-parallel", key), `recovery schema for ${key}`);
  }
});
