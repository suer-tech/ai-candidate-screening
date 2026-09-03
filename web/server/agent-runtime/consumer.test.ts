import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntimeConsumer } from "./consumer.ts";

test("worker error includes command and only a safe server code", async () => {
  const worker = new AgentRuntimeConsumer(
    { endpoint: "http://runtime.invalid", token: "synthetic-token", workerId: "worker-1", pollingMs: 1, heartbeatMs: 10, leaseMs: 100 },
    new Map(),
    async () => Response.json({ error: "LEASE_TOKEN_MISMATCH" }, { status: 422 }),
  );
  await assert.rejects(worker.start(), /RUNTIME_API_422:recover:LEASE_TOKEN_MISMATCH/);
});

test("worker never reflects an unsafe server error body", async () => {
  const worker = new AgentRuntimeConsumer(
    { endpoint: "http://runtime.invalid", token: "synthetic-token", workerId: "worker-1", pollingMs: 1, heartbeatMs: 10, leaseMs: 100 },
    new Map(),
    async () => Response.json({ error: "secret value with spaces" }, { status: 500 }),
  );
  await assert.rejects(worker.start(), /RUNTIME_API_500:recover:RUNTIME_COMMAND_REJECTED/);
});

test("stale outcome for a removed run does not terminate the durable worker", async () => {
  let claims = 0;
  let executions = 0;
  const adapter = {
    operation: "execute",
    sideEffectClass: "read-only" as const,
    async execute() {
      executions += 1;
      if (executions === 2) await worker.stop();
      return { outcome: executions === 1 ? "FAILED" as const : "SUCCEEDED" as const, errorCode: executions === 1 ? "SYNTHETIC_FAILURE" : undefined };
    },
  };
  const worker = new AgentRuntimeConsumer(
    { endpoint: "http://runtime.invalid", token: "synthetic-token", workerId: "worker-1", pollingMs: 1, heartbeatMs: 10, leaseMs: 100 },
    new Map([["candidate.drive-snapshot/v1", adapter]]),
    async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { command?: string };
      if (body.command === "recover") return Response.json([]);
      if (body.command === "claim") {
        claims += 1;
        return Response.json({ task: { id: `task-${claims}`, run_id: `run-${claims}`, lease_token: claims, lease_owner: "worker-1", attemptId: `attempt-${claims}`, tool_key: "candidate.drive-snapshot/v1", idempotency_identity: `identity-${claims}` } });
      }
      if (body.command === "authorize") return Response.json({ allowed: true, grantId: "grant-1" });
      if (body.command === "fail" && executions === 1) return Response.json({ error: "TASK_NOT_FOUND" }, { status: 409 });
      return Response.json({ accepted: true });
    },
  );
  await worker.start();
  assert.equal(executions, 2);
  assert.equal(claims, 2);
});

test("idle worker periodically recovers expired leases instead of only recovering at startup", async () => {
  let recoveries = 0;
  const worker = new AgentRuntimeConsumer(
    { endpoint: "http://runtime.invalid", token: "synthetic-token", workerId: "worker-1", pollingMs: 1, heartbeatMs: 2, leaseMs: 5 },
    new Map(),
    async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { command?: string };
      if (body.command === "recover") {
        recoveries += 1;
        if (recoveries === 2) await worker.stop();
        return Response.json({ taskIds: [] });
      }
      return Response.json({ task: null });
    },
  );
  await worker.start();
  assert.equal(recoveries, 2);
});

test("graceful stop aborts every concurrently executing Rabbit task", async () => {
  let started = 0;
  let releaseStarted!: () => void;
  const bothStarted = new Promise<void>((resolve) => { releaseStarted = resolve; });
  const adapter = {
    operation: "execute",
    sideEffectClass: "read-only" as const,
    async execute(_task: unknown, signal: AbortSignal) {
      started += 1;
      if (started === 2) releaseStarted();
      return await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  };
  const worker = new AgentRuntimeConsumer(
    { endpoint: "http://runtime.invalid", token: "synthetic-token", workerId: "worker-parallel", pollingMs: 1, heartbeatMs: 1_000, leaseMs: 10_000 },
    new Map([["candidate.document-shard/v1", adapter]]),
    async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { command?: string };
      if (body.command === "authorize") return Response.json({ allowed: true, grantId: "grant-parallel" });
      return Response.json({ accepted: true });
    },
  );
  const task = (id: string) => ({ id, run_id: "run-parallel", lease_token: 1, attemptId: `attempt-${id}`, tool_key: "candidate.document-shard/v1" });
  const executions = [worker.executeClaimedTask(task("a")), worker.executeClaimedTask(task("b"))];
  await bothStarted;
  await worker.stop();
  const results = await Promise.allSettled(executions);
  assert.equal(results.filter((result) => result.status === "rejected").length, 2);
});
