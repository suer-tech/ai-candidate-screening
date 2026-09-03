import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createFanoutDescriptor } from "./fanout.ts";
import { PostgresAgentRuntimeRepository } from "./postgres-runtime-repository.ts";
import { createPostgresClient } from "../storage/postgres.ts";
import { migratePostgres } from "../storage/migrations.ts";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;

integration("transactional fan-out is idempotent, fair, and promotes an exact join", async () => {
  const sql = createPostgresClient({ url: url!, max: 8 });
  await migratePostgres(sql);
  const candidateId = 1_000_000_000 + Math.floor(Math.random() * 900_000_000);
  const runId = randomUUID(); const goalId = randomUUID();
  const repository = new PostgresAgentRuntimeRepository(sql);
  try {
    await sql`INSERT INTO candidates(id,revision,record_json) VALUES (${candidateId},1,'{}')`;
    await repository.createGoal({ goalId, runId, candidateId, goalType: "candidate-analysis-matrix/v1", workflowVersion: "matrix-v4-rabbit-parallel",
      inputVersion: `input-${runId}`, profileVersion: `profile-${runId}:v1`, policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1",
      completionCriteria: ["validated-candidate-report"], budgets: { wallTimeMs: 3_600_000, taskAttempts: 100, repairAttempts: 2, replans: 2, llmCalls: 50, tokens: 100_000, costMicrounits: 1_000_000, externalRequests: 200 }, triggerIdentity: `integration:${runId}` });
    const coordinatorId = `${runId}:plan:1:documents-plan`; const joinId = `${runId}:plan:1:documents-join`;
    await sql`UPDATE agent_tasks SET state='RUNNABLE' WHERE id=${coordinatorId}`;
    await sql`UPDATE agent_tasks SET state='WAITING' WHERE run_id=${runId} AND id<>${coordinatorId} AND state='RUNNABLE'`;
    assert.equal(await repository.claim({ worker: "postgres-rollback-probe", now: Date.now(), leaseMs: 30_000 }), null,
      "PostgreSQL rollback consumer must not claim a stale RUNNABLE task whose dependency is incomplete");
    await assert.rejects(
      () => repository.claimById({ taskId: coordinatorId, taskVersion: 1, routingClass: "control", worker: "dependency-probe", now: Date.now(), leaseMs: 30_000 }),
      /RABBIT_DEPENDENCY_NOT_READY/,
      "claimById must re-check dependencies even if stale state says RUNNABLE",
    );
    await sql`UPDATE agent_tasks SET state='SUCCEEDED' WHERE id=${`${runId}:plan:1:drive-snapshot`}`;
    const claimed = await repository.claimById({ taskId: coordinatorId, taskVersion: 1, routingClass: "control", worker: "integration-worker", now: Date.now(), leaseMs: 30_000 });
    assert.ok(claimed);
    const descriptor = createFanoutDescriptor({ workflowVersion: "matrix-v4-rabbit-parallel", runId, planVersion: 1, groupKey: "documents", kind: "documents",
      inputFingerprint: `input-${runId}`, profileFingerprint: `profile-${runId}:v1`, configFingerprint: "integration-config",
      shards: ["a", "b", "c"].map((identity) => ({ identity, payload: { sourceFileId: identity } })) });
    const first = await repository.materializeFanout({ coordinatorTaskId: coordinatorId, joinTaskId: joinId, descriptor, shardToolKey: "candidate.document-shard/v1", expectedOutputs: ["document"] });
    const second = await repository.materializeFanout({ coordinatorTaskId: coordinatorId, joinTaskId: joinId, descriptor, shardToolKey: "candidate.document-shard/v1", expectedOutputs: ["document"] });
    assert.equal(first.created, true); assert.equal(second.created, false); assert.deepEqual(second.shardTaskIds, first.shardTaskIds);
    await repository.outcome({ taskId: coordinatorId, attemptId: claimed!.attemptId, worker: "integration-worker", leaseToken: claimed!.lease_token, outcome: "SUCCEEDED" });
    const shards = await sql<{ state: string; count: number }[]>`SELECT state,count(*)::integer AS count FROM agent_tasks WHERE fanout_group_id=${first.groupId} GROUP BY state`;
    assert.equal(shards.length, 1); assert.equal(shards[0].state, "RUNNABLE"); assert.equal(shards[0].count, 3);
    const republishNow = Date.now();
    await sql`UPDATE agent_task_dispatch_outbox SET state='PUBLISHED',confirmed_at=${new Date(republishNow - 10_000).toISOString()} WHERE task_id=${first.shardTaskIds[2]}`;
    const reconciled = await repository.reconcileDispatch(republishNow, 1_000);
    assert.ok(reconciled.includes(first.shardTaskIds[2]), "a confirmed delivery for a still-runnable task must be rehydrated after the safety interval");
    const [rehydrated] = await sql<{ state: string; last_error_code: string }[]>`SELECT state,last_error_code FROM agent_task_dispatch_outbox WHERE task_id=${first.shardTaskIds[2]}`;
    assert.equal(rehydrated.state, "PENDING"); assert.equal(rehydrated.last_error_code, "DELIVERY_REPUBLISH_TIMEOUT");
    const [one, two] = await Promise.all(first.shardTaskIds.slice(0, 2).map((taskId, index) => repository.claimById({ taskId, taskVersion: 2, routingClass: "documents", worker: `worker-${index}`, now: Date.now(), leaseMs: 30_000, maxPerRun: 2 })));
    assert.ok(one); assert.ok(two);
    await assert.rejects(() => repository.claimById({ taskId: first.shardTaskIds[2], taskVersion: 2, routingClass: "documents", worker: "worker-3", now: Date.now(), leaseMs: 30_000, maxPerRun: 2 }), /RABBIT_RUN_CONCURRENCY_LIMIT/);
    const deferredAt = Date.now();
    await repository.defer({ taskId: first.shardTaskIds[0], attemptId: one!.attemptId, worker: "worker-0", leaseToken: one!.lease_token,
      now: deferredAt, retryAfterMs: 15_000, reason: "PROVIDER_RESULT_PENDING" });
    const [deferred] = await sql<{ state: string; revision: number; available_at: number; attempt_count: number }[]>`SELECT state,revision,available_at,attempt_count FROM agent_tasks WHERE id=${first.shardTaskIds[0]}`;
    assert.equal(deferred.state, "RUNNABLE");
    assert.equal(Number(deferred.available_at), deferredAt + 15_000);
    assert.equal(deferred.attempt_count, 1);
    await assert.rejects(
      () => repository.claimById({ taskId: first.shardTaskIds[0], taskVersion: deferred.revision, routingClass: "documents", worker: "worker-0", now: deferredAt + 1_000, leaseMs: 30_000 }),
      /RABBIT_TASK_NOT_YET_AVAILABLE/,
    );
    const [dispatch] = await sql<{ state: string; available_at: number }[]>`SELECT state,available_at FROM agent_task_dispatch_outbox WHERE task_id=${first.shardTaskIds[0]} AND task_version=${deferred.revision}`;
    assert.equal(dispatch.state, "PENDING");
    assert.equal(Number(dispatch.available_at), deferredAt + 15_000);

    for (const [index, taskId] of first.shardTaskIds.entries()) {
      const artifactRef = `synthetic-artifact-${runId}-${index}`;
      const memoryId = `synthetic-memory-${runId}-${index}`;
      await sql`UPDATE agent_tasks SET state='SUCCEEDED',output_artifact_id=${artifactRef},lease_owner=NULL,lease_expires_at=NULL WHERE id=${taskId}`;
      await sql`INSERT INTO agent_memory_entries
        (id,goal_id,run_id,candidate_id,input_version,profile_version,kind,provenance,sensitivity,purpose,payload_json,immutable)
        VALUES (${memoryId},${goalId},${runId},${candidateId},${`input-${runId}`},${`profile-${runId}:v1`},'artifact','candidate.document-shard/v1','personal','candidate-pipeline-stage:matrix-v4-rabbit-parallel',NULL,true)`;
      await sql`INSERT INTO agent_artifact_refs (id,memory_entry_id,storage_class,storage_identity,checksum,schema_version)
        VALUES (${`${memoryId}:ref`},${memoryId},'postgres-blob',${artifactRef},${`checksum-${index}`},${index === 0 ? "wrong-schema/v1" : "document-bundle/v1"})`;
    }
    await assert.rejects(() => repository.readFanout({ joinTaskId: joinId, groupKey: "documents" }), /FANOUT_SHARD_ARTIFACT_INVALID:a/,
      "join must reject a successful member whose artifact schema is incompatible");
    await sql`UPDATE agent_artifact_refs SET schema_version='document-bundle/v1' WHERE storage_identity=${`synthetic-artifact-${runId}-0`}`;
    const exact = await repository.readFanout({ joinTaskId: joinId, groupKey: "documents" });
    assert.deepEqual(exact.members.map((member) => member.shard_identity), ["a", "b", "c"]);

    const transcriptCoordinatorId = `${runId}:plan:1:transcripts-plan`;
    const transcriptJoinId = `${runId}:plan:1:transcripts-join`;
    await sql`UPDATE agent_tasks SET state='RUNNABLE' WHERE id=${transcriptCoordinatorId}`;
    const [{ revision: transcriptRevision }] = await sql<{ revision: number }[]>`SELECT revision FROM agent_tasks WHERE id=${transcriptCoordinatorId}`;
    const transcriptCoordinator = await repository.claimById({ taskId: transcriptCoordinatorId, taskVersion: transcriptRevision, routingClass: "control", worker: "transcript-planner", now: Date.now(), leaseMs: 30_000 });
    assert.ok(transcriptCoordinator);
    const source = "interview-a:v1";
    const transcriptDescriptor = createFanoutDescriptor({ workflowVersion: "matrix-v4-rabbit-parallel", runId, planVersion: 1, groupKey: "transcripts", kind: "transcripts",
      inputFingerprint: `input-${runId}`, profileFingerprint: `profile-${runId}:v1`, configFingerprint: "integration-config",
      shards: [
        { identity: `${source}:media`, toolKey: "candidate.transcript-media-shard/v1" },
        { identity: `${source}:submit`, toolKey: "candidate.transcript-submit-shard/v1", dependsOn: [`${source}:media`] },
        { identity: `${source}:collect`, toolKey: "candidate.transcript-collect-shard/v1", dependsOn: [`${source}:submit`] },
      ] });
    const transcriptGroup = await repository.materializeFanout({ coordinatorTaskId: transcriptCoordinatorId, joinTaskId: transcriptJoinId,
      descriptor: transcriptDescriptor, shardToolKey: "candidate.transcript-shard/v1", expectedOutputs: ["transcript"] });
    await repository.outcome({ taskId: transcriptCoordinatorId, attemptId: transcriptCoordinator!.attemptId, worker: "transcript-planner", leaseToken: transcriptCoordinator!.lease_token, outcome: "SUCCEEDED" });
    const transcriptTasks = await sql<{ shard_identity: string; tool_key: string; routing_class: string; state: string }[]>`SELECT shard_identity,tool_key,routing_class,state FROM agent_tasks WHERE fanout_group_id=${transcriptGroup.groupId} ORDER BY shard_identity`;
    assert.deepEqual(transcriptTasks.map((item) => [item.shard_identity, item.tool_key, item.routing_class, item.state]), [
      [`${source}:collect`, "candidate.transcript-collect-shard/v1", "transcription", "PENDING"],
      [`${source}:media`, "candidate.transcript-media-shard/v1", "media", "RUNNABLE"],
      [`${source}:submit`, "candidate.transcript-submit-shard/v1", "transcription", "PENDING"],
    ]);
    const phaseEdges = await sql<{ task_identity: string; dependency_identity: string }[]>`SELECT task.shard_identity AS task_identity,dependency.shard_identity AS dependency_identity
      FROM agent_task_dependencies edge JOIN agent_tasks task ON task.id=edge.task_id JOIN agent_tasks dependency ON dependency.id=edge.depends_on_task_id
      WHERE task.fanout_group_id=${transcriptGroup.groupId} AND dependency.fanout_group_id=${transcriptGroup.groupId} ORDER BY task.shard_identity`;
    assert.deepEqual(phaseEdges.map((edge) => ({ ...edge })), [
      { task_identity: `${source}:collect`, dependency_identity: `${source}:submit` },
      { task_identity: `${source}:submit`, dependency_identity: `${source}:media` },
    ]);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
