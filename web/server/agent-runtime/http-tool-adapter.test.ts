import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createHttpToolAdapters, toolAdapterFailureCode } from "./http-tool-adapter.ts";

test("worker registers every canonical tool and forwards only safe task context", async () => {
  let observed: Record<string, unknown> | undefined;
  const adapters = createHttpToolAdapters({ endpoint: "http://127.0.0.1:3000/api/internal/candidate-pipeline/tool", token: "token", environment: "local" }, async (_url, init) => {
    observed = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ outcome: "SUCCEEDED" });
  });
  const adapter = adapters.get("candidate.drive-snapshot/v1");
  assert.ok(adapter);
  const result = await adapter.execute({ id: "task", run_id: "run", tool_key: "candidate.drive-snapshot/v1", lease_token: 1, lease_owner: "worker-1", attemptId: "attempt", candidate_id: 7, idempotency_identity: "idem" }, new AbortController().signal, { grantId: "grant" });
  assert.equal(result.outcome, "SUCCEEDED");
  assert.deepEqual(observed, { toolKey: "candidate.drive-snapshot/v1", task: { id: "task", runId: "run", toolKey: "candidate.drive-snapshot/v1", candidatePk: 7, idempotencyIdentity: "idem", leaseToken: 1, worker: "worker-1", attemptId: "attempt", authorizationGrantId: "grant" } });
  assert.equal(adapters.size, 16);
});

test("remote worker rejects a plaintext or loopback tool endpoint", () => {
  assert.throws(() => createHttpToolAdapters({ endpoint: "http://127.0.0.1:3000/tool", token: "x", environment: "staging" }), /REMOTE_TOOL_ENDPOINT_MUST_USE_HTTPS/);
});

test("tool adapter distinguishes lease loss from endpoint outage", () => {
  const controller = new AbortController();
  controller.abort(new Error("LEASE_LOST"));
  assert.equal(toolAdapterFailureCode(controller.signal.reason, controller.signal), "TOOL_EXECUTOR_LEASE_LOST");
  assert.equal(toolAdapterFailureCode(new TypeError("private network diagnostic")), "TOOL_EXECUTOR_UNAVAILABLE");
});

test("worker default transport waits for the Node tool endpoint response", async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ outcome: "FAILED", errorCode: "LLM_CAPABILITY_FAILED:network" }));
    }, 25);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const adapters = createHttpToolAdapters({ endpoint: `http://127.0.0.1:${address.port}/tool`, token: "token", environment: "local" });
    const adapter = adapters.get("candidate.assessment/v1");
    assert.ok(adapter);
    const result = await adapter.execute({ id: "task", run_id: "run", tool_key: "candidate.assessment/v1", lease_token: 1, lease_owner: "worker-1", attemptId: "attempt" }, new AbortController().signal, { grantId: "grant" });
    assert.deepEqual(result, { outcome: "FAILED", errorCode: "LLM_CAPABILITY_FAILED:network", obstacle: undefined, action: undefined });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
