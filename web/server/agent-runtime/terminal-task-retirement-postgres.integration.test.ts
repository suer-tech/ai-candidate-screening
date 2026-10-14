import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { migratePostgres } from "../storage/migrations.ts";
import { createPostgresClient, type PostgresClient } from "../storage/postgres.ts";
import { PostgresAgentRuntimeRepository } from "./postgres-runtime-repository.ts";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
const budgets = { wallTimeMs: 3_600_000, taskAttempts: 100, repairAttempts: 2, replans: 2, llmCalls: 50, tokens: 100_000, costMicrounits: 1_000_000, externalRequests: 200 };
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function fixture(sql: PostgresClient, repository: PostgresAgentRuntimeRepository, candidateId?: number) {
  const runId = randomUUID();
  const candidate = candidateId ?? 1_000_000_000 + Math.floor(Math.random() * 900_000_000);
  if (!candidateId) await sql`INSERT INTO candidates(id,revision,record_json) VALUES (${candidate},1,'{"status":"PROCESSING"}')`;
  await repository.createGoal({ goalId: randomUUID(), runId, candidateId: candidate, goalType: "candidate-analysis-matrix/v1", workflowVersion: "matrix-v3",
    inputVersion: `synthetic-input-${runId}`, profileVersion: `synthetic-profile-${runId}:v1`, policyVersion: "candidate-policy-v1",
    completionCriteriaVersion: "candidate-completion-v1", completionCriteria: ["validated-candidate-report"], budgets, triggerIdentity: `synthetic:${runId}` });
  return { runId, candidateId: candidate, task: (key: string) => `${runId}:plan:1:${key}` };
}

async function tasks(sql: PostgresClient, runId: string) {
  return plain(await sql`SELECT * FROM agent_tasks WHERE run_id=${runId} ORDER BY id`);
}

async function claimDocuments(sql: PostgresClient, repository: PostgresAgentRuntimeRepository, item: Awaited<ReturnType<typeof fixture>>) {
  await sql`UPDATE agent_tasks SET state='SUCCEEDED',output_artifact_id='synthetic-immutable-prefix' WHERE id=${item.task("drive-snapshot")}`;
  await sql`UPDATE agent_tasks SET state='RUNNABLE' WHERE id=${item.task("documents")}`;
  const lease = await repository.claimById({ taskId: item.task("documents"), taskVersion: 1, routingClass: "documents", worker: "synthetic-worker", now: Date.now(), leaseMs: 60_000 });
  assert.ok(lease);
  return { taskId: lease.id, attemptId: lease.attemptId, worker: "synthetic-worker", leaseToken: lease.lease_token };
}

async function retiredEvents(sql: PostgresClient, runId: string) {
  return plain(await sql`SELECT type,safe_payload_json FROM agent_events WHERE run_id=${runId} AND type='TERMINAL_TASK_TAILS_CANCELLED' ORDER BY sequence`);
}

async function liveSnapshot(sql: PostgresClient, item: Awaited<ReturnType<typeof fixture>>) {
  return plain({
    tasks: await tasks(sql, item.runId),
    runs: await sql`SELECT * FROM agent_runs WHERE id=${item.runId}`,
    goals: await sql`SELECT goal.* FROM agent_goals goal JOIN agent_runs run ON run.goal_id=goal.id WHERE run.id=${item.runId}`,
    candidates: await sql`SELECT * FROM candidates WHERE id=${item.candidateId}`,
    attempts: await sql`SELECT attempt.* FROM agent_attempts attempt JOIN agent_tasks task ON task.id=attempt.task_id WHERE task.run_id=${item.runId} ORDER BY attempt.id`,
    dispatch: await sql`SELECT * FROM agent_task_dispatch_outbox WHERE run_id=${item.runId} ORDER BY id`,
    effects: await sql`SELECT * FROM agent_outbox WHERE run_id=${item.runId} ORDER BY id`,
    checkpoints: await sql`SELECT checkpoint.* FROM agent_checkpoints checkpoint JOIN agent_attempts attempt ON attempt.id=checkpoint.attempt_id
      JOIN agent_tasks task ON task.id=attempt.task_id WHERE task.run_id=${item.runId} ORDER BY checkpoint.id`,
    artifacts: await sql`SELECT artifact.* FROM artifact_blobs artifact JOIN agent_tasks task ON task.output_artifact_id=artifact.id
      WHERE task.run_id=${item.runId} ORDER BY artifact.id`,
    budgets: await sql`SELECT * FROM agent_budget_ledger WHERE run_id=${item.runId} ORDER BY id`,
    events: await sql`SELECT * FROM agent_events WHERE run_id=${item.runId} ORDER BY sequence`,
  });
}

integration("terminal task retirement through the real PostgreSQL runtime boundary", async (suite) => {
  const sql = createPostgresClient({ url: url!, max: 1 });
  const repository = new PostgresAgentRuntimeRepository(sql);
  try {
    await migratePostgres(sql);
    await suite.test("terminal outcome retires safe siblings and dispatches, preserving effects and other active work", async () => {
      const current = await fixture(sql, repository);
      const unrelated = await fixture(sql, repository);
      const lease = await claimDocuments(sql, repository, current);
      const artifact = randomUUID();
      const checksum = createHash("sha256").update(Buffer.from([1, 2, 3])).digest("hex");
      await sql`INSERT INTO artifact_blobs(id,scope,kind,checksum,mime_type,byte_size,content,protected,created_at_utc)
        VALUES (${artifact},'synthetic','synthetic-prefix',${checksum},'application/octet-stream',3,${Buffer.from([1, 2, 3])},true,${new Date().toISOString()})`;
      await sql`UPDATE agent_tasks SET output_artifact_id=${artifact} WHERE id=${current.task("drive-snapshot")}`;
      const prefixArtifact = plain(await sql`SELECT * FROM artifact_blobs WHERE id=${artifact}`);
      await sql`UPDATE agent_tasks SET state='WAITING' WHERE id=${current.task("transcription")}`;
      await sql`UPDATE agent_tasks SET state='RUNNING',lease_owner='synthetic-parallel-worker',lease_expires_at=${Date.now() + 3_600_000} WHERE id=${current.task("context-read")}`;
      await sql`UPDATE agent_tasks SET state='UNKNOWN_OUTCOME' WHERE id=${current.task("claims")}`;
      await sql`UPDATE agent_tasks SET lease_owner='synthetic-lease',lease_expires_at=${Date.now() + 3_600_000} WHERE id=${current.task("global-evidence")}`;
      await sql`INSERT INTO agent_task_dispatch_outbox(id,task_id,run_id,task_version,dispatch_generation,routing_class,state,created_at)
        VALUES (${`${current.runId}:published`},${current.task("context-search")},${current.runId},1,99,'control','PUBLISHED',${new Date().toISOString()})`;
      const before = await tasks(sql, current.runId);
      const otherBefore = await tasks(sql, unrelated.runId);
      const oldAttempts = plain(await sql`SELECT * FROM agent_attempts WHERE task_id<>${lease.taskId} ORDER BY id`);
      const published = plain(await sql`SELECT * FROM agent_task_dispatch_outbox WHERE id=${`${current.runId}:published`}`);
      await repository.outcome({ ...lease, outcome: "FAILED", errorCode: "CORRUPT_FILE" });
      const after = await tasks(sql, current.runId);
      const eligible = before.filter((row) => ["PENDING", "RUNNABLE", "WAITING"].includes(String(row.state)) && row.lease_owner == null && row.lease_expires_at == null);
      assert.ok(eligible.length > 0);
      for (const row of eligible) {
        const changed = after.find((item) => item.id === row.id)!;
        assert.equal(changed.state, "CANCELLED", "Terminal failure must cancel every safe pending sibling");
        assert.equal(changed.revision, Number(row.revision) + 1);
        assert.equal(changed.lease_token, Number(row.lease_token) + 1);
        assert.equal(Number(changed.available_at), 0);
      }
      for (const row of before.filter((item) => !eligible.some((target) => target.id === item.id) && item.id !== lease.taskId)) {
        assert.deepEqual(after.find((item) => item.id === row.id), row, "Successful, executing, leased or uncertain task changed");
      }
      assert.equal(after.find((item) => item.id === lease.taskId)?.state, "FAILED");
      const [run] = await sql`SELECT state FROM agent_runs WHERE id=${current.runId}`;
      assert.equal(run.state, "FAILED");
      const [attempt] = await sql`SELECT state,error_code FROM agent_attempts WHERE id=${lease.attemptId}`;
      assert.equal(attempt.state, "FAILED"); assert.equal(attempt.error_code, "CORRUPT_FILE");
      assert.deepEqual(await tasks(sql, unrelated.runId), otherBefore);
      assert.deepEqual(plain(await sql`SELECT * FROM artifact_blobs WHERE id=${artifact}`), prefixArtifact, "Successful prefix artifact bytes changed");
      assert.deepEqual(plain(await sql`SELECT * FROM agent_attempts WHERE task_id<>${lease.taskId} ORDER BY id`), oldAttempts);
      assert.deepEqual(plain(await sql`SELECT * FROM agent_task_dispatch_outbox WHERE id=${`${current.runId}:published`}`), published);
      const [dispatch] = await sql`SELECT state,last_error_code FROM agent_task_dispatch_outbox WHERE task_id=${current.task("matrix")} AND task_version=1`;
      assert.equal(dispatch.state, "FAILED"); assert.equal(dispatch.last_error_code, "RUN_TERMINATED");
      const audit = await retiredEvents(sql, current.runId);
      assert.equal(audit.length, 1);
      const payload = JSON.parse(String(audit[0].safe_payload_json));
      assert.ok(Object.values(payload).includes(eligible.length), "Retirement audit must contain the affected task count");
      assert.ok(!JSON.stringify(payload).includes(current.runId), "Audit payload must contain counts, not task/run identities");
    });

    for (const recover of ["recoverStale", "reconcileDispatch"] as const) await suite.test(`${recover} retires terminal historical tails while a successor and another candidate are ACTIVE`, async () => {
      const historical = await Promise.all(["FAILED", "CANCELLED", "SUPERSEDED"].map(async (state) => {
        const item = await fixture(sql, repository);
        await sql`UPDATE agent_runs SET state=${state} WHERE id=${item.runId}`;
        await sql`UPDATE agent_tasks SET state='WAITING' WHERE id=${item.task("transcription")}`;
        return item;
      }));
      const successor = await fixture(sql, repository, historical[0].candidateId);
      const unrelated = await fixture(sql, repository);
      const successorBefore = await tasks(sql, successor.runId);
      const unrelatedBefore = await tasks(sql, unrelated.runId);
      const candidatesBefore = plain(await sql`SELECT * FROM candidates WHERE id IN (${successor.candidateId},${unrelated.candidateId}) ORDER BY id`);
      const runsBefore = plain(await sql`SELECT * FROM agent_runs WHERE id IN (${historical[0].runId},${historical[1].runId},${historical[2].runId}) ORDER BY id`);
      const now = Date.now();
      const reconciler = new PostgresAgentRuntimeRepository(sql);
      await reconciler[recover](now);
      for (const item of historical) {
        const rows = await tasks(sql, item.runId);
        assert.ok(rows.every((row) => row.state === "CANCELLED"), "Periodic reconciliation must retire terminal tails even during other ACTIVE work");
        assert.equal((await retiredEvents(sql, item.runId)).length, 1);
      }
      assert.deepEqual(await tasks(sql, successor.runId), successorBefore);
      assert.deepEqual(await tasks(sql, unrelated.runId), unrelatedBefore);
      assert.deepEqual(plain(await sql`SELECT * FROM candidates WHERE id IN (${successor.candidateId},${unrelated.candidateId}) ORDER BY id`), candidatesBefore);
      assert.deepEqual(plain(await sql`SELECT * FROM agent_runs WHERE id IN (${historical[0].runId},${historical[1].runId},${historical[2].runId}) ORDER BY id`), runsBefore);
      const stable = await Promise.all(historical.map((item) => tasks(sql, item.runId)));
      await reconciler[recover](now + 1_000);
      assert.deepEqual(await Promise.all(historical.map((item) => tasks(sql, item.runId))), stable);
      for (const item of historical) assert.equal((await retiredEvents(sql, item.runId)).length, 1, "Reconciliation must not spam audit events");
    });

    await suite.test("periodic retirement preserves all leased live candidate state and their subsequent success/retry processing", async () => {
      const historical = await fixture(sql, repository);
      const oldLease = await claimDocuments(sql, repository, historical);
      await sql`UPDATE agent_runs SET state='FAILED' WHERE id=${historical.runId}`;
      await sql`UPDATE agent_tasks SET state='UNKNOWN_OUTCOME' WHERE id=${historical.task("claims")}`;
      await sql`UPDATE agent_tasks SET state='WAITING' WHERE id=${historical.task("transcription")}`;
      const historicalBefore = await liveSnapshot(sql, historical);
      const liveSuccess = await fixture(sql, repository);
      const liveRetry = await fixture(sql, repository);
      const successLease = await claimDocuments(sql, repository, liveSuccess);
      const retryLease = await claimDocuments(sql, repository, liveRetry);
      for (const lease of [successLease, retryLease]) {
        const authorization = await repository.authorizeTool({ taskId: lease.taskId, operation: "execute", sideEffectClass: "idempotent-write", now: Date.now() });
        assert.ok(authorization.allowed && authorization.grantId);
        const [task] = await sql`SELECT idempotency_identity FROM agent_tasks WHERE id=${lease.taskId}`;
        await repository.prepareExternalEffect({ ...lease, grantId: authorization.grantId, operation: "execute",
          operationIdentity: String(task.idempotency_identity), sideEffectClass: "idempotent-write", now: Date.now() });
        const artifactId = randomUUID();
        const content = Buffer.from(`synthetic-running-checkpoint-only:${artifactId}`);
        const checksum = createHash("sha256").update(content).digest("hex");
        await sql`INSERT INTO artifact_blobs(id,scope,kind,checksum,mime_type,byte_size,content,protected,created_at_utc)
          VALUES (${artifactId},'synthetic','synthetic-running-checkpoint',${checksum},'application/octet-stream',${content.length},${content},true,${new Date().toISOString()})`;
        await repository.checkpoint({ ...lease, kind: "artifact", identity: "synthetic-checkpoint", artifactIdentity: artifactId, checksum });
      }
      const successBefore = await liveSnapshot(sql, liveSuccess);
      const retryBefore = await liveSnapshot(sql, liveRetry);
      assert.equal(successBefore.effects.length, 1);
      assert.equal(retryBefore.effects.length, 1);
      assert.equal(successBefore.artifacts.length, 1);
      assert.equal(retryBefore.artifacts.length, 1);
      const reconciler = new PostgresAgentRuntimeRepository(sql);
      await reconciler.reconcileDispatch(Date.now());
      assert.deepEqual(await liveSnapshot(sql, liveSuccess), successBefore, "Retirement changed a different candidate's executing work");
      assert.deepEqual(await liveSnapshot(sql, liveRetry), retryBefore, "Retirement changed live leases, attempts, queues, budgets or projection");
      const historicalAfter = await liveSnapshot(sql, historical);
      for (const row of historicalBefore.tasks.filter((task) => ["RUNNING", "UNKNOWN_OUTCOME", "SUCCEEDED"].includes(String(task.state)))) {
        assert.deepEqual(historicalAfter.tasks.find((task) => task.id === row.id), row, "Historical executing/uncertain/finished task changed");
      }
      const eligible = historicalBefore.tasks.filter((task) => ["PENDING", "RUNNABLE", "WAITING"].includes(String(task.state)));
      assert.ok(eligible.length > 0);
      for (const row of eligible) assert.equal(historicalAfter.tasks.find((task) => task.id === row.id)?.state, "CANCELLED");
      assert.deepEqual(historicalAfter.runs, historicalBefore.runs);
      assert.deepEqual(historicalAfter.candidates, historicalBefore.candidates);
      assert.deepEqual(historicalAfter.attempts, historicalBefore.attempts);
      assert.equal((await sql`SELECT state FROM agent_attempts WHERE id=${oldLease.attemptId}`)[0].state, "RUNNING");
      await repository.outcome({ ...successLease, outcome: "SUCCEEDED" });
      await repository.outcome({ ...retryLease, outcome: "FAILED", errorCode: "HTTP_503" });
      assert.equal((await sql`SELECT state FROM agent_attempts WHERE id=${successLease.attemptId}`)[0].state, "SUCCEEDED");
      assert.equal((await sql`SELECT state FROM agent_attempts WHERE id=${retryLease.attemptId}`)[0].state, "FAILED");
      assert.equal((await sql`SELECT state FROM agent_outbox WHERE run_id=${liveSuccess.runId}`)[0].state, "SENT");
      const [retry] = await sql`SELECT * FROM agent_tasks WHERE id=${retryLease.taskId}`;
      assert.equal(retry.state, "RUNNABLE", "Transient failure of live candidate must retain normal retry policy");
      assert.ok(Number(retry.available_at) > Date.now());
      const [delivery] = await sql`SELECT state FROM agent_task_dispatch_outbox WHERE task_id=${retryLease.taskId} AND task_version=${retry.revision}`;
      assert.equal(delivery.state, "PENDING");
      const retryClaim = await repository.claimById({ taskId: retryLease.taskId, taskVersion: Number(retry.revision), routingClass: "documents",
        worker: "synthetic-retry-worker", now: Number(retry.available_at) + 1, leaseMs: 60_000 });
      assert.ok(retryClaim, "Live retry must remain claimable after retirement");
      await repository.outcome({ taskId: retryClaim.id, attemptId: retryClaim.attemptId, worker: "synthetic-retry-worker", leaseToken: retryClaim.lease_token, outcome: "SUCCEEDED" });
      assert.equal((await sql`SELECT state FROM agent_outbox WHERE run_id=${liveRetry.runId}`)[0].state, "SENT");
      assert.deepEqual((await liveSnapshot(sql, liveSuccess)).artifacts, successBefore.artifacts);
      assert.deepEqual((await liveSnapshot(sql, liveRetry)).artifacts, retryBefore.artifacts);
      for (const item of [liveSuccess, liveRetry]) {
        assert.equal((await sql`SELECT state FROM agent_runs WHERE id=${item.runId}`)[0].state, "ACTIVE");
        assert.equal((await sql`SELECT state FROM agent_tasks WHERE id=${item.task("documents")}`)[0].state, "SUCCEEDED");
        assert.equal((await sql`SELECT state FROM agent_tasks WHERE id=${item.task("transcription")}`)[0].state, "RUNNABLE");
        assert.equal((await retiredEvents(sql, item.runId)).length, 0);
      }
      assert.equal((await retiredEvents(sql, historical.runId)).length, 1);
    });

    await suite.test("concurrent reconcilers skip a locked terminal run and retire other candidates without duplicate audit", async () => {
      const terminal = await Promise.all([0, 1, 2].map(async () => {
        const item = await fixture(sql, repository);
        await sql`UPDATE agent_runs SET state='FAILED' WHERE id=${item.runId}`;
        return item;
      }));
      const lockedBefore = await tasks(sql, terminal[0].runId);
      const before = await Promise.all(terminal.map((item) => tasks(sql, item.runId)));
      const locker = createPostgresClient({ url: url!, max: 1 });
      const workerA = createPostgresClient({ url: url!, max: 1 });
      const workerB = createPostgresClient({ url: url!, max: 1 });
      const reconcileAt = Date.now();
      try {
        await workerA`SET statement_timeout='3s'`;
        await workerB`SET statement_timeout='3s'`;
        await locker.begin(async (transaction) => {
          await transaction`SELECT id FROM agent_runs WHERE id=${terminal[0].runId} FOR UPDATE`;
          await Promise.all([new PostgresAgentRuntimeRepository(workerA).reconcileDispatch(reconcileAt),
            new PostgresAgentRuntimeRepository(workerB).reconcileDispatch(reconcileAt)]);
          assert.deepEqual(await tasks(sql, terminal[0].runId), lockedBefore, "Another transaction's locked run must be skipped");
          for (const item of terminal.slice(1)) {
            const progressed = (await tasks(sql, item.runId)).filter((task) => task.state === "CANCELLED").length;
            assert.ok(progressed > 0, "Locked candidate must not prevent progress on another candidate");
          }
        });
        // SKIP LOCKED can legitimately leave rows transiently held by the other
        // reconciler. The contract promises bounded periodic progress, not an
        // all-or-nothing whole-run batch during overlapping scans.
        await new PostgresAgentRuntimeRepository(sql).reconcileDispatch(reconcileAt + 60_001);
        for (const [index, item] of terminal.entries()) {
          const after = await tasks(sql, item.runId);
          assert.ok(after.every((task) => task.state === "CANCELLED"));
          for (const row of after) {
            const original = before[index].find((task) => task.id === row.id)!;
            assert.equal(row.revision, Number(original.revision) + 1, "Concurrent scans retired one task more than once");
            assert.equal(row.lease_token, Number(original.lease_token) + 1);
          }
          const audit = await retiredEvents(sql, item.runId);
          const counts = audit.map((event) => JSON.parse(String(event.safe_payload_json)).cancelledTasks);
          assert.ok(counts.every((count) => Number.isInteger(count) && count > 0));
          assert.equal(counts.reduce((sum, count) => sum + count, 0), before[index].length, "Audit counts duplicated or omitted a retired task");
          await new PostgresAgentRuntimeRepository(sql).reconcileDispatch(Date.now());
          assert.deepEqual(await retiredEvents(sql, item.runId), audit, "No-op reconciliation added audit spam");
        }
      } finally {
        await Promise.all([locker.end({ timeout: 2 }), workerA.end({ timeout: 2 }), workerB.end({ timeout: 2 })]);
      }
    });

    await suite.test("periodic retirement is bounded to 2000 tasks and drains remaining tails without touching active processing", async () => {
      const historical = await fixture(sql, repository);
      const active = await fixture(sql, repository);
      await claimDocuments(sql, repository, active);
      const activeBefore = await liveSnapshot(sql, active);
      await sql`UPDATE agent_runs SET state='CANCELLED' WHERE id=${historical.runId}`;
      await sql`INSERT INTO agent_tasks (id,run_id,plan_version_id,task_key,tool_key,state,revision,attempt_count,lease_token,idempotency_identity,preconditions_json,expected_outputs_json)
        SELECT ${historical.runId}||':synthetic-bulk:'||series,${historical.runId},${`${historical.runId}:plan:1`},'synthetic-bulk-'||series,
          'candidate.document-extraction/v1','PENDING',1,0,0,${historical.runId}||':bulk-operation:'||series,'[]','[]' FROM generate_series(1,2005) series`;
      const before = await tasks(sql, historical.runId);
      assert.ok(before.length > 2000);
      const [globalBefore] = await sql`SELECT
        count(*) FILTER (WHERE task.state='CANCELLED')::integer cancelled,
        count(*) FILTER (WHERE run.state IN ('FAILED','CANCELLED','SUPERSEDED') AND task.state IN ('PENDING','RUNNABLE','WAITING')
          AND task.lease_owner IS NULL AND task.lease_expires_at IS NULL)::integer eligible
        FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id`;
      const reconciler = new PostgresAgentRuntimeRepository(sql);
      const now = Date.now();
      await reconciler.reconcileDispatch(now);
      const partial = await tasks(sql, historical.runId);
      const [globalAfter] = await sql`SELECT count(*)::integer cancelled FROM agent_tasks WHERE state='CANCELLED'`;
      const globalDelta = Number(globalAfter.cancelled) - Number(globalBefore.cancelled);
      assert.equal(globalDelta, Math.min(2000, Number(globalBefore.eligible)), "One reconciliation must obey the global batch bound");
      assert.ok(globalDelta <= 2000);
      const ownCancelled = partial.filter((task) => task.state === "CANCELLED").length;
      const otherEligible = Number(globalBefore.eligible) - before.length;
      assert.ok(ownCancelled > 0 && ownCancelled <= 2000);
      assert.ok(ownCancelled >= Math.max(0, globalDelta - otherEligible), "Target count does not match the known eligible leftovers");
      assert.equal(partial.filter((task) => task.state !== "CANCELLED").length, before.length - ownCancelled);
      assert.deepEqual(await liveSnapshot(sql, active), activeBefore);
      await reconciler.reconcileDispatch(now + 60_001);
      const drained = await tasks(sql, historical.runId);
      assert.ok(drained.every((task) => task.state === "CANCELLED"));
      for (const row of drained) {
        const original = before.find((task) => task.id === row.id)!;
        assert.equal(row.revision, Number(original.revision) + 1);
        assert.equal(row.lease_token, Number(original.lease_token) + 1);
      }
      const audit = await retiredEvents(sql, historical.runId);
      assert.equal(audit.length, 2, "Each affected batch has one audit event for its run");
      const counts = audit.map((event) => JSON.parse(String(event.safe_payload_json)).cancelledTasks);
      assert.equal(counts.reduce((sum, count) => sum + count, 0), before.length);
      await reconciler.reconcileDispatch(now + 120_002);
      assert.deepEqual(await tasks(sql, historical.runId), drained);
      assert.deepEqual(await retiredEvents(sql, historical.runId), audit);
      assert.deepEqual(await liveSnapshot(sql, active), activeBefore);
    });

    await suite.test("late terminal-run outcomes preserve history without retries, promotion or overwriting newer READY", async () => {
      for (const { outcome, errorCode } of [
        { outcome: "FAILED", errorCode: "HTTP_503" },
        { outcome: "FAILED", errorCode: "CORRUPT_FILE" },
        { outcome: "SUCCEEDED", errorCode: undefined },
      ] as const) {
        const old = await fixture(sql, repository);
        const lease = await claimDocuments(sql, repository, old);
        await sql`UPDATE agent_runs SET state='FAILED' WHERE id=${old.runId}`;
        const successor = await fixture(sql, repository, old.candidateId);
        await sql`UPDATE agent_runs SET state='SUCCEEDED' WHERE id=${successor.runId}`;
        await sql`UPDATE candidates SET record_json='{"status":"READY","progress":100,"resultVersion":"synthetic-success"}' WHERE id=${old.candidateId}`;
        const [candidate] = await sql`SELECT * FROM candidates WHERE id=${old.candidateId}`;
        const successorBefore = await tasks(sql, successor.runId);
        const [countBefore] = await sql`SELECT count(*)::integer n FROM agent_task_dispatch_outbox WHERE run_id=${old.runId}`;
        await repository.outcome({ ...lease, outcome, errorCode });
        const [attempt] = await sql`SELECT state FROM agent_attempts WHERE id=${lease.attemptId}`;
        assert.equal(attempt.state, outcome, "Late attempt result is retained as history");
        const [oldTask] = await sql`SELECT state FROM agent_tasks WHERE id=${lease.taskId}`;
        assert.equal(oldTask.state, outcome, "Terminal run must not schedule a retry for a late transient failure");
        const [countAfter] = await sql`SELECT count(*)::integer n FROM agent_task_dispatch_outbox WHERE run_id=${old.runId}`;
        assert.equal(countAfter.n, countBefore.n, "Late result enqueued or promoted terminal work");
        assert.deepEqual((await sql`SELECT * FROM candidates WHERE id=${old.candidateId}`)[0], candidate, "Newer READY projection was overwritten");
        assert.deepEqual(await tasks(sql, successor.runId), successorBefore);
        assert.deepEqual(await repository.promote(old.runId), [], "Direct promote boundary must reject terminal runs");
      }
    });

    await suite.test("promotion waits for a concurrent terminal transition and cannot enqueue after it commits", async () => {
      const item = await fixture(sql, repository);
      await sql`UPDATE agent_tasks SET state='PENDING' WHERE id=${item.task("matrix")}`;
      const before = await tasks(sql, item.runId);
      const deliveriesBefore = plain(await sql`SELECT * FROM agent_task_dispatch_outbox WHERE run_id=${item.runId} ORDER BY id`);
      const label = `synthetic-promote-${randomUUID()}`;
      await sql`SELECT set_config('application_name',${label},false)`;
      const locker = createPostgresClient({ url: url!, max: 1 });
      let pending: Promise<string[]> | undefined;
      try {
        await locker.begin(async (transaction) => {
          await transaction`UPDATE agent_runs SET state='FAILED' WHERE id=${item.runId}`;
          let settled = false;
          pending = repository.promote(item.runId);
          void pending.then(() => { settled = true; }, () => { settled = true; });
          let observedWait = false;
          for (let probe = 0; probe < 100 && !settled; probe++) {
            await transaction`SELECT pg_stat_clear_snapshot()`;
            const [row] = await transaction`SELECT count(*)::integer n FROM pg_stat_activity WHERE application_name=${label} AND wait_event_type='Lock'`;
            if (Number(row.n) > 0) { observedWait = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.ok(observedWait, "Promotion must serialize on the run lock, not a stale ACTIVE snapshot");
        });
        assert.deepEqual(await pending, []);
        assert.deepEqual(await tasks(sql, item.runId), before);
        assert.deepEqual(plain(await sql`SELECT * FROM agent_task_dispatch_outbox WHERE run_id=${item.runId} ORDER BY id`), deliveriesBefore);
      } finally {
        await pending?.catch(() => undefined);
        await locker.end({ timeout: 2 });
        await sql`SELECT set_config('application_name','',false)`;
      }
    });

    await suite.test("audit failure rolls back terminal outcome, attempt and sibling retirement in one transaction", async () => {
      const item = await fixture(sql, repository);
      const lease = await claimDocuments(sql, repository, item);
      const before = {
        tasks: await tasks(sql, item.runId),
        run: plain(await sql`SELECT * FROM agent_runs WHERE id=${item.runId}`),
        attempt: plain(await sql`SELECT * FROM agent_attempts WHERE id=${lease.attemptId}`),
        candidate: plain(await sql`SELECT * FROM candidates WHERE id=${item.candidateId}`),
        dispatch: plain(await sql`SELECT * FROM agent_task_dispatch_outbox WHERE run_id=${item.runId} ORDER BY id`),
      };
      const functionName = `synthetic_retirement_failure_${randomUUID().replaceAll("-", "")}`;
      await sql.unsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.run_id='${item.runId}' AND NEW.type='TERMINAL_TASK_TAILS_CANCELLED' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_WRITE_FAILURE'; END IF; RETURN NEW; END $$`);
      await sql.unsafe(`CREATE TRIGGER ${functionName} BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      try {
        await assert.rejects(repository.outcome({ ...lease, outcome: "FAILED", errorCode: "CORRUPT_FILE" }), /SYNTHETIC_AUDIT_WRITE_FAILURE/);
        assert.deepEqual(await tasks(sql, item.runId), before.tasks);
        assert.deepEqual(plain(await sql`SELECT * FROM agent_runs WHERE id=${item.runId}`), before.run);
        assert.deepEqual(plain(await sql`SELECT * FROM agent_attempts WHERE id=${lease.attemptId}`), before.attempt);
        assert.deepEqual(plain(await sql`SELECT * FROM candidates WHERE id=${item.candidateId}`), before.candidate);
        assert.deepEqual(plain(await sql`SELECT * FROM agent_task_dispatch_outbox WHERE run_id=${item.runId} ORDER BY id`), before.dispatch);
      } finally {
        await sql.unsafe(`DROP TRIGGER ${functionName} ON agent_events`);
        await sql.unsafe(`DROP FUNCTION ${functionName}()`);
      }
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
});
