import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate as turn } from "node:timers/promises";
import { AgentRuntimeConsumer, type ClaimedTask, type RuntimeToolAdapter } from "./consumer.ts";

/**
 * Independent author/executor: Codex acceptance-only task, not the runtime implementer.
 * Oracle: owner-requested heartbeat regression, RBQ-003/OPS-009 active change,
 * and main SEC-006. Synthetic application-boundary tests, NOT real-broker/E2E proof.
 * Preconditions/data: injected transport/adapter, fake time, synthetic IDs/errors.
 * Steps/expected results: named cases below. Evidence/status: node:test output.
 * Cleanup: release adapter and pending requests, stop worker, reset mock timers/logs.
 */
const epoch = 1_800_000_000_000;
const heartbeatMs = 1_000;
const leaseMs = 12_000;
const sensitive = "SYNTHETIC_PRIVATE_MESSAGE candidate@example.invalid token=not-a-real-secret";
type Result = Awaited<ReturnType<RuntimeToolAdapter["execute"]>>;
type Command = { command: string; input?: Record<string, unknown>; runId?: string };
type Heartbeat = (init: RequestInit, body: Command) => Response | Promise<Response>;
const accepted = () => Response.json({ accepted: true });
const outcomeCommands = new Set(["fail", "complete", "unknown", "defer", "wait-for-human", "promote"]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(t: TestContext, heartbeat: Heartbeat, initialLeaseMs = leaseMs) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: epoch });
  const logs: unknown[][] = [];
  for (const method of ["info", "warn", "error", "log"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  }
  const task: ClaimedTask & { lease_expires_at: number } = {
    id: "synthetic-heartbeat-task", run_id: "synthetic-heartbeat-run",
    attemptId: "synthetic-heartbeat-attempt", tool_key: "synthetic.read/v1",
    lease_token: 7, lease_owner: "synthetic-worker", lease_expires_at: epoch + initialLeaseMs,
  };
  const calls: Command[] = [];
  const started = deferred<AbortSignal>();
  const result = deferred<Result>();
  const adapter: RuntimeToolAdapter = {
    operation: "execute", sideEffectClass: "read-only",
    async execute(_task, signal) { started.resolve(signal); return result.promise; },
  };
  const worker = new AgentRuntimeConsumer({
    endpoint: "https://runtime.invalid", token: "synthetic-token", workerId: task.lease_owner!,
    pollingMs: 100, heartbeatMs, leaseMs,
  }, adapter, async (_url, init) => {
    assert.ok(init);
    const body = JSON.parse(String(init.body)) as Command;
    calls.push(body);
    if (body.command === "heartbeat") return heartbeat(init, body);
    if (body.command === "authorize") return Response.json({ allowed: true, grantId: "synthetic-grant" });
    return accepted();
  });
  // Attach a rejection handler immediately: cancellation may legitimately reject execution.
  const execution = worker.executeClaimedTask(task).then(
    () => ({ rejected: false }), () => ({ rejected: true }),
  );
  t.after(async () => {
    result.resolve({ outcome: "FAILED", errorCode: "SYNTHETIC_CLEANUP" });
    await worker.stop();
    await turn();
    t.mock.timers.reset();
  });
  return {
    task, calls, logs, worker, execution, started: started.promise,
    finish: (value: Result) => result.resolve(value),
    outcomes: () => calls.filter((call) => outcomeCommands.has(call.command)).map((call) => call.command),
    async advanceTo(elapsedMs: number) {
      const target = epoch + elapsedMs;
      assert.ok(target >= Date.now(), "test clock must not run backwards");
      while (Date.now() < target) {
        t.mock.timers.tick(Math.min(100, target - Date.now()));
        // A real event-loop turn drains promise/Response.json work, without a timed sleep.
        await turn();
      }
    },
  };
}

function hangingTransport(t: TestContext) {
  const requests: { signal: AbortSignal | null | undefined; pending: boolean; release: () => void }[] = [];
  let maxPending = 0;
  const heartbeat: Heartbeat = (init) => new Promise<Response>((resolve, reject) => {
    const request = { signal: init.signal, pending: true, release: () => finish() };
    const finish = (error?: unknown) => {
      if (!request.pending) return;
      request.pending = false;
      init.signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(accepted());
    };
    const abort = () => finish(new DOMException("Synthetic cancellation", "AbortError"));
    requests.push(request);
    maxPending = Math.max(maxPending, requests.filter((entry) => entry.pending).length);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
  });
  t.after(async () => { requests.forEach((request) => request.release()); await turn(); });
  return { heartbeat, requests, maxPending: () => maxPending };
}

for (const status of [422, 409, 503]) {
  test(`HB-001 RBQ-003: three HTTP ${status} CONNECTION_CLOSED failures do not cancel a valid lease`, async (t) => {
    let attempts = 0;
    const f = fixture(t, () => ++attempts <= 3
      ? Response.json({ error: "CONNECTION_CLOSED", message: sensitive }, { status }) : accepted());
    const signal = await f.started;
    await f.advanceTo(4_000);
    assert.ok(attempts >= 4, "heartbeats must retry and recover while the lease is valid");
    assert.equal(signal.aborted, false, "three transient failures are not evidence of lease loss");
    f.finish({ outcome: "SUCCEEDED" });
    assert.equal((await f.execution).rejected, false);
    assert.deepEqual(f.outcomes(), ["complete", "promote"]);
  });
}

test("HB-002 RBQ-003: three rejected transport requests do not cancel a valid lease", async (t) => {
  let attempts = 0;
  const f = fixture(t, () => {
    if (++attempts <= 3) throw Object.assign(new Error(sensitive), { code: "ECONNRESET" });
    return accepted();
  });
  const signal = await f.started;
  await f.advanceTo(4_000);
  assert.ok(attempts >= 4);
  assert.equal(signal.aborted, false, "transport failure count must not replace the confirmed lease deadline");
  f.finish({ outcome: "SUCCEEDED" });
  await f.execution;
  assert.deepEqual(f.outcomes(), ["complete", "promote"]);
});

for (const status of [409, 422]) {
  for (const outcome of ["FAILED", "SUCCEEDED", "UNKNOWN_OUTCOME", "RETRY_LATER", "WAITING_FOR_HUMAN"] as const) {
    test(`HB-003 OPS-009: HTTP ${status} STALE_LEASE_TOKEN cancels and fences adapter ${outcome}`, async (t) => {
      const f = fixture(t, () => Response.json({ error: "STALE_LEASE_TOKEN" }, { status }));
      const signal = await f.started;
      await f.advanceTo(heartbeatMs);
      assert.equal(signal.aborted, true, "an explicit stale token must cancel the adapter immediately");
      f.finish({ outcome, errorCode: "SYNTHETIC_ADAPTER_CANCELLED" });
      await f.execution;
      assert.deepEqual(f.outcomes(), [], "no fail/complete/unknown/defer/wait/promote may follow lease loss");
    });
  }
}

test("HB-004 OPS-009: a hung heartbeat stays single-flight and each request is bounded", async (t) => {
  const hanging = hangingTransport(t);
  const f = fixture(t, hanging.heartbeat);
  await f.started;
  await f.advanceTo(4 * heartbeatMs);
  assert.ok(hanging.requests.length > 0, "the hang must actually have been exercised");
  assert.deepEqual({
    maxConcurrent: hanging.maxPending(), firstCancelled: hanging.requests[0].signal?.aborted ?? false,
  }, { maxConcurrent: 1, firstCancelled: true }, "pending heartbeats must be cancelled, never overlapped");
});

for (const renewed of [false, true]) {
  test(`HB-005 OPS-009: hung heartbeat cancels by ${renewed ? "renewed" : "initial"} confirmed expiry without outcome`, async (t) => {
    const hanging = hangingTransport(t);
    let confirmedExpiry = epoch + 5_000;
    let confirmations = 0;
    const f = fixture(t, (init, body) => {
      if (renewed && confirmations++ === 0) {
        confirmedExpiry = Number(body.input?.now) + Number(body.input?.leaseMs);
        return accepted();
      }
      return hanging.heartbeat(init, body);
    }, 5_000);
    const signal = await f.started;
    await f.advanceTo(2_000);
    assert.ok(hanging.requests.length > 0, "a heartbeat is actually pending");
    if (renewed) {
      await f.advanceTo(5_000);
      assert.equal(signal.aborted, false, "confirmed renewal must extend the original lease");
    }
    await f.advanceTo(confirmedExpiry - epoch);
    const abortedAtExpiry = signal.aborted;
    f.finish({ outcome: "FAILED", errorCode: "SYNTHETIC_ADAPTER_CANCELLED" });
    await f.execution;
    assert.deepEqual({ abortedAtExpiry, outcomes: f.outcomes(), pending: hanging.requests.filter((r) => r.pending).length },
      { abortedAtExpiry: true, outcomes: [], pending: 0 }, "unconfirmed heartbeats cannot extend ownership or permit a terminal write");
  });
}

test("HB-006 OPS-009: successful execution cancels its pending heartbeat and leaves no later activity", async (t) => {
  const hanging = hangingTransport(t);
  const f = fixture(t, hanging.heartbeat);
  await f.started;
  await f.advanceTo(heartbeatMs);
  assert.equal(hanging.requests.length, 1);
  f.finish({ outcome: "SUCCEEDED" });
  assert.equal((await f.execution).rejected, false);
  assert.deepEqual(f.outcomes(), ["complete", "promote"]);
  assert.equal(hanging.requests[0].signal?.aborted, true, "cleanup must cancel the in-flight fetch, not just future ticks");
  const counts = { calls: f.calls.length, logs: f.logs.length };
  await f.advanceTo(2 * leaseMs);
  assert.deepEqual({ calls: f.calls.length, logs: f.logs.length }, counts, "no heartbeat or error may leak after cleanup");
});

test("HB-007 OPS-009: explicit stop fences FAILED returned after cancellation", async (t) => {
  const f = fixture(t, accepted);
  const signal = await f.started;
  await f.worker.stop();
  assert.equal(signal.aborted, true);
  f.finish({ outcome: "FAILED", errorCode: "SYNTHETIC_ADAPTER_CANCELLED" });
  await f.execution;
  assert.deepEqual(f.outcomes(), [], "any abort must fence subsequent terminal writes");
});

test("HB-008 SEC-006: heartbeat diagnostics correlate task/run and retain only safe error metadata", async (t) => {
  const f = fixture(t, () => Response.json({ error: "CONNECTION_CLOSED", message: sensitive }, { status: 503 }));
  await f.started;
  await f.advanceTo(heartbeatMs);
  const rendered = JSON.stringify(f.logs);
  assert.ok(f.logs.length > 0, "heartbeat failure must have a diagnostic");
  assert.equal(rendered.includes(sensitive), false, "raw response messages must not reach logs");
  assert.ok(rendered.includes(f.task.id), "heartbeat diagnostic must include task ID");
  assert.ok(rendered.includes(f.task.run_id), "heartbeat diagnostic must include run ID");
  assert.match(rendered, /CONNECTION_CLOSED/, "retain the sanitized server error code");
  assert.match(rendered, /503/, "retain HTTP status as safe diagnostic metadata");
});

function controlBoundaryFixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: epoch });
  t.mock.method(console, "info", () => undefined);
  return {
    config: {
      endpoint: "https://runtime.invalid", token: "synthetic-token", workerId: "synthetic-worker",
      pollingMs: 100, heartbeatMs, leaseMs,
    },
    task: {
      id: "synthetic-control-task", run_id: "synthetic-control-run", attemptId: "synthetic-control-attempt",
      tool_key: "synthetic.read/v1", lease_token: 7, lease_owner: "synthetic-worker",
      lease_expires_at: epoch + leaseMs,
    },
    adapter: {
      operation: "execute", sideEffectClass: "read-only" as const,
      async execute() { return { outcome: "SUCCEEDED" as const }; },
    },
    async advanceTo(elapsedMs: number) {
      while (Date.now() < epoch + elapsedMs) {
        t.mock.timers.tick(Math.min(100, epoch + elapsedMs - Date.now()));
        await turn();
      }
    },
  };
}

for (const blockedCommand of ["authorize", "prepare-effect", "complete"] as const) {
  test(`HB-009 OPS-009: hung ${blockedCommand} is cancelled and execution settles by lease expiry`, async (t) => {
    const f = controlBoundaryFixture(t);
    const calls: string[] = [];
    let requestSignal: AbortSignal | null | undefined;
    let pending = false;
    let release = () => {};
    const worker = new AgentRuntimeConsumer(f.config, f.adapter, async (_url, init) => {
      assert.ok(init);
      const { command } = JSON.parse(String(init.body)) as Command;
      calls.push(command);
      if (command === blockedCommand) {
        requestSignal = init.signal;
        pending = true;
        return new Promise<Response>((resolve, reject) => {
          const finish = (cancelled: boolean) => {
            if (!pending) return;
            pending = false;
            requestSignal?.removeEventListener("abort", abort);
            if (cancelled) reject(new DOMException("Synthetic cancellation", "AbortError"));
            else resolve(command === "authorize" ? Response.json({ allowed: true, grantId: "synthetic-grant" }) : accepted());
          };
          const abort = () => finish(true);
          release = () => finish(false);
          if (requestSignal?.aborted) abort();
          else requestSignal?.addEventListener("abort", abort, { once: true });
        });
      }
      if (command === "authorize") return Response.json({ allowed: true, grantId: "synthetic-grant" });
      // No confirmation may move the original lease deadline while the control request hangs.
      if (command === "heartbeat") return Response.json({ error: "RUNTIME_HEARTBEAT_UNAVAILABLE" }, { status: 503 });
      return accepted();
    });
    let settlement: "pending" | "resolved" | "rejected" = "pending";
    const execution = worker.executeClaimedTask(f.task).then(
      () => { settlement = "resolved"; }, () => { settlement = "rejected"; },
    );
    t.after(async () => {
      await worker.stop();
      release();
      await execution;
      t.mock.timers.reset();
    });
    await turn();
    assert.equal(pending, true, `the ${blockedCommand} request must actually be in flight`);
    assert.equal(settlement, "pending");
    const blockedIndex = calls.indexOf(blockedCommand);
    await f.advanceTo(leaseMs);
    assert.deepEqual({
      requestAborted: requestSignal?.aborted ?? false, pending, settlement,
      laterWrites: calls.slice(blockedIndex + 1).filter((command) => outcomeCommands.has(command)),
    }, { requestAborted: true, pending: false, settlement: "rejected", laterWrites: [] },
    "lease expiry must abort the pending control request and release execution without subsequent writes");
  });
}

test("HB-010 OPS-009: an expired claim with no adapter must not submit fail", async (t) => {
  const f = controlBoundaryFixture(t);
  const calls: string[] = [];
  const worker = new AgentRuntimeConsumer(f.config, new Map(), async (_url, init) => {
    calls.push((JSON.parse(String(init?.body)) as Command).command);
    return accepted();
  });
  try {
    await worker.executeClaimedTask({ ...f.task, lease_expires_at: epoch - 1 }).catch(() => undefined);
    assert.deepEqual(calls.filter((command) => outcomeCommands.has(command)), [],
      "adapter lookup failure does not grant permission to write an outcome for an expired claim");
  } finally {
    await worker.stop();
    t.mock.timers.reset();
  }
});

test("HB-011 OPS-009: completion acknowledgement racing with stop must not promote", async (t) => {
  const f = controlBoundaryFixture(t);
  const calls: string[] = [];
  let completionInFlight = false;
  const acknowledgement = deferred<Response>();
  const worker = new AgentRuntimeConsumer(f.config, f.adapter, async (_url, init) => {
    const { command } = JSON.parse(String(init?.body)) as Command;
    calls.push(command);
    if (command === "authorize") return Response.json({ allowed: true, grantId: "synthetic-grant" });
    if (command === "complete") {
      completionInFlight = true;
      // Model a committed response winning the cancellation race, not a hung transport.
      return acknowledgement.promise;
    }
    return accepted();
  });
  const execution = worker.executeClaimedTask(f.task).then(() => undefined, () => undefined);
  t.after(async () => {
    await worker.stop();
    acknowledgement.resolve(accepted());
    await execution;
    t.mock.timers.reset();
  });
  await turn();
  assert.equal(completionInFlight, true, "stop must race with an already-submitted completion");
  await worker.stop();
  const callsAtStop = calls.length;
  acknowledgement.resolve(accepted());
  await execution;
  assert.deepEqual(calls.slice(callsAtStop), [], "no promotion or other command may be submitted after stop");
});
