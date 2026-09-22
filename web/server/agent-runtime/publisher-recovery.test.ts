import assert from "node:assert/strict";
import test from "node:test";
import { RabbitDispatchPublisher, loadRabbitRuntimeConfig } from "./rabbitmq.ts";
import type { PostgresAgentRuntimeRepository } from "./postgres-runtime-repository.ts";

test("publisher periodically runs authoritative lease recovery without needing a worker restart", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const calls: string[] = [];
  const repository = {
    async recoverStale() { calls.push("recover"); return []; },
    async reconcileDispatch() { calls.push("reconcile"); return []; },
    async claimDispatchBatch() { calls.push("claim"); return []; },
  } as unknown as PostgresAgentRuntimeRepository;
  const publisher = new RabbitDispatchPublisher(loadRabbitRuntimeConfig({ RABBITMQ_URL: "amqp://localhost" }), repository, "synthetic-publisher");
  // Isolate scheduling only; this is not real broker acceptance evidence.
  Object.defineProperty(publisher, "ensureChannel", { value: async () => ({}) });
  await publisher.runOnce();
  assert.deepEqual(calls, ["recover", "reconcile", "claim"]);
  t.mock.timers.setTime(Date.now() + 29_999);
  await publisher.runOnce();
  assert.equal(calls.filter((value) => value === "recover").length, 1);
  t.mock.timers.setTime(Date.now() + 1);
  await publisher.runOnce();
  assert.equal(calls.filter((value) => value === "recover").length, 2);
});

test("failed recovery stays due and is retried rather than recorded as successful", async () => {
  let calls = 0;
  const repository = {
    async recoverStale() { if (++calls === 1) throw new Error("SYNTHETIC_DATABASE_UNAVAILABLE"); return []; },
    async reconcileDispatch() { return []; },
    async claimDispatchBatch() { return []; },
  } as unknown as PostgresAgentRuntimeRepository;
  const publisher = new RabbitDispatchPublisher(loadRabbitRuntimeConfig({ RABBITMQ_URL: "amqp://localhost" }), repository, "synthetic-publisher");
  Object.defineProperty(publisher, "ensureChannel", { value: async () => ({}) });
  await assert.rejects(publisher.runOnce(), /SYNTHETIC_DATABASE_UNAVAILABLE/);
  await publisher.runOnce();
  assert.equal(calls, 2);
});
