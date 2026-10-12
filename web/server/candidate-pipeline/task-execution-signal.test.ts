import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { PostgresClient } from "../storage/postgres.ts";
import { candidateToolRequiresLeaseSignal, createTaskExecutionSignal } from "./task-execution-signal.ts";

const task = { id: "synthetic-task", runId: "synthetic-run", worker: "synthetic-worker", leaseToken: 3,
  attemptId: "synthetic-attempt", toolKey: "candidate.transcript-media-shard/v1" };
type LeaseRows = { lease_expires_at: number | string }[];
function database(read: (statement: string, parameters: unknown[]) => Promise<LeaseRows>) {
  return { unsafe: read } as unknown as PostgresClient;
}
function whenAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

test("only recording tools require server-side lease monitoring", () => {
  for (const key of [task.toolKey, "candidate.transcription/v1", "candidate.transcript-shard/v1"]) assert.equal(candidateToolRequiresLeaseSignal(key), true);
  for (const key of ["candidate.transcript-submit-shard/v1", "candidate.transcript-normalize-shard/v1", "candidate.row-shard/v1"]) assert.equal(candidateToolRequiresLeaseSignal(key), false);
});

test("initial ownership check binds task, run, worker, token, attempt and tool before permitting work", async () => {
  let calls = 0;
  const guard = await createTaskExecutionSignal(database(async (statement, parameters) => {
    calls++;
    assert.deepEqual(parameters, [task.id, task.runId, task.worker, task.leaseToken, task.attemptId, task.toolKey]);
    assert.match(statement, /task\.state='RUNNING' AND run\.state='ACTIVE'/);
    assert.match(statement, /attempt\.state='RUNNING' AND attempt\.lease_owner=\$3 AND attempt\.lease_token=\$4/);
    return [{ lease_expires_at: String(Date.now() + 2_000) }];
  }), task);
  try { assert.equal(guard.signal.aborted, false); assert.equal(calls, 1); }
  finally { guard.stop(); }
});

test("absent or expired lease fails closed on the initial check", async () => {
  await assert.rejects(createTaskExecutionSignal(database(async () => []), task), /LEASE_LOST/);
  await assert.rejects(createTaskExecutionSignal(database(async () => [{ lease_expires_at: Date.now() - 1 }]), task), /LEASE_EXPIRED/);
});

test("incomplete ownership identity is rejected without querying the database", async () => {
  let calls = 0;
  const db = database(async () => { calls++; return []; });
  for (const field of ["id", "runId", "worker", "leaseToken", "attemptId", "toolKey"]) {
    await assert.rejects(createTaskExecutionSignal(db, { ...task, [field]: undefined }), /TASK_LEASE_SCOPE_INVALID/);
  }
  assert.equal(calls, 0);
});

test("request cancellation aborts server work and removes the polling timer", async () => {
  let calls = 0;
  const request = new AbortController();
  const guard = await createTaskExecutionSignal(database(async () => { calls++; return [{ lease_expires_at: Date.now() + 2_000 }]; }), task, request.signal, { pollMs: 5 });
  request.abort(new Error("synthetic-private-reason"));
  assert.equal(guard.signal.aborted, true);
  assert.equal(guard.signal.reason.message, "TASK_REQUEST_ABORTED");
  const callsAtAbort = calls;
  await delay(25);
  assert.equal(calls, callsAtAbort);
  guard.stop();
});

test("a request already aborted is rejected before the initial query", async () => {
  let calls = 0;
  const request = new AbortController();
  request.abort();
  await assert.rejects(createTaskExecutionSignal(database(async () => { calls++; return []; }), task, request.signal), /TASK_REQUEST_ABORTED/);
  assert.equal(calls, 0);
});

test("changed ownership or terminal run/attempt aborts an active execution", async () => {
  let calls = 0;
  const guard = await createTaskExecutionSignal(database(async () => ++calls === 1 ? [{ lease_expires_at: Date.now() + 1_000 }] : []), task, undefined, { pollMs: 5 });
  await whenAborted(guard.signal);
  assert.equal(guard.signal.reason.message, "LEASE_LOST");
  guard.stop();
});

test("transient database errors never extend the last confirmed expiry", async () => {
  let calls = 0;
  const deadline = Date.now() + 65;
  const guard = await createTaskExecutionSignal(database(async () => {
    if (++calls === 1) return [{ lease_expires_at: deadline }];
    throw new Error("synthetic-private-database-details");
  }), task, undefined, { pollMs: 5 });
  await whenAborted(guard.signal);
  assert.equal(guard.signal.reason.message, "LEASE_EXPIRED");
  assert.ok(calls > 1);
  assert.ok(Date.now() >= deadline);
  guard.stop();
});

test("a hanging query remains single flight and cannot revive an expired execution", async () => {
  let calls = 0;
  let finishQuery!: (rows: LeaseRows) => void;
  const pending = new Promise<LeaseRows>((resolve) => { finishQuery = resolve; });
  const guard = await createTaskExecutionSignal(database(async () => ++calls === 1 ? [{ lease_expires_at: Date.now() + 60 }] : pending), task, undefined, { pollMs: 5 });
  await whenAborted(guard.signal);
  assert.equal(calls, 2, "no overlapping queued queries while one query is pending");
  finishQuery([{ lease_expires_at: Date.now() + 2_000 }]);
  await delay(15);
  assert.equal(guard.signal.aborted, true);
  assert.equal(guard.signal.reason.message, "LEASE_EXPIRED");
  assert.equal(calls, 2);
  guard.stop();
});

test("confirmed heartbeat extensions keep work alive and stop removes all timers", async () => {
  let calls = 0;
  const guard = await createTaskExecutionSignal(database(async () => { calls++; return [{ lease_expires_at: Date.now() + 100 }]; }), task, undefined, { pollMs: 5 });
  try {
    await delay(160);
    assert.equal(guard.signal.aborted, false);
    assert.ok(calls > 10);
    guard.stop();
    const callsAtStop = calls;
    await delay(120);
    assert.equal(calls, callsAtStop);
    assert.equal(guard.signal.aborted, false);
  } finally { guard.stop(); }
});

test("initial database outage fails with a safe error before execution", async () => {
  await assert.rejects(createTaskExecutionSignal(database(async () => { throw new Error("synthetic-private-content"); }), task), /TASK_LEASE_CHECK_UNAVAILABLE/);
});

test("initial hanging query times out and its late reply starts no polling", async () => {
  let calls = 0;
  let finishQuery!: (rows: LeaseRows) => void;
  const db = database(() => {
    calls++;
    return new Promise((resolve) => { finishQuery = resolve; });
  });
  await assert.rejects(createTaskExecutionSignal(db, task, undefined, { pollMs: 5, initialTimeoutMs: 15 }), /TASK_LEASE_CHECK_TIMEOUT/);
  finishQuery([{ lease_expires_at: Date.now() + 2_000 }]);
  await delay(25);
  assert.equal(calls, 1);
});
