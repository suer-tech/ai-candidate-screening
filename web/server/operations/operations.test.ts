import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { authorized, boolean, integer, metricName, sanitizeLogValue } from "./contracts.ts";
import { createOperationsServer } from "./server.ts";

test("operations contract rejects arbitrary input and strips sensitive log fields", () => {
  const token = "x".repeat(48);
  assert.equal(authorized(`Bearer ${token}`, token), true);
  assert.equal(authorized("Bearer wrong", token), false);
  assert.throws(() => integer("32", 8, 1, 31), /INVALID_ARGUMENT/);
  assert.throws(() => boolean("yes", true), /INVALID_ARGUMENT/);
  assert.throws(() => metricName("arbitrary_query"), /INVALID_ARGUMENT/);
  const raw = JSON.stringify({ event: "rabbit-worker-delivery-error", safeCode: "DELIVERY_FAILED", routingClass: "llm",
    candidateName: "Synthetic Person", taskId: "secret-id", stack: "private stack", url: "https://private.invalid", token: "secret" });
  assert.deepEqual(sanitizeLogValue("1780000000000000000", raw, "worker-llm"), {
    timestamp: "2026-05-28T20:26:40.000Z", event: "rabbit-worker-delivery-error", service: "worker-llm", level: "error",
    safe_code: "DELIVERY_FAILED", routing_class: "llm",
  });
});

test("operations HTTP boundary requires bearer token and exact query keys", async () => {
  const token = "z".repeat(48);
  const service = {
    days: async () => ({ status: "ok", system: "hr" }), metrics: async () => "hh_ops_up 1\n",
    metricHistory: async () => ({ status: "ok" }), logs: async () => ({ status: "ok" }),
    overview: async () => ({ status: "ok", system: "hr" }), alerts: async () => ({ status: "ok", alerts: [] }),
  };
  const server = createOperationsServer(service as never, token).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_MISSING");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/metrics`)).status, 200);
    assert.equal((await fetch(`${base}/v1/overview`)).status, 401);
    assert.equal((await fetch(`${base}/v1/overview?query=up`, { headers: { authorization: `Bearer ${token}` } })).status, 422);
    assert.equal((await fetch(`${base}/v1/metrics?metric=web_up&hours=24`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
    assert.equal((await fetch(`${base}/v1/metrics?metric=up`, { headers: { authorization: `Bearer ${token}` } })).status, 422);
  } finally { server.close(); await once(server, "close"); }
});
