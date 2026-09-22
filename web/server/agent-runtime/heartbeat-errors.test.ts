import assert from "node:assert/strict";
import test from "node:test";
import { classifyHeartbeatError } from "./heartbeat-errors.ts";
import { RuntimeConflictError } from "./runtime.ts";

test("only an explicit repository stale token is a heartbeat fencing conflict", () => {
  assert.deepEqual(classifyHeartbeatError(new RuntimeConflictError("STALE_LEASE_TOKEN")), {
    status: 409, error: "STALE_LEASE_TOKEN", reasonCode: "STALE_LEASE_TOKEN",
  });
  assert.equal(classifyHeartbeatError(new Error("STALE_LEASE_TOKEN")).status, 503);
  assert.equal(classifyHeartbeatError(new RuntimeConflictError("SOME_OTHER_FAILURE")).status, 503);
});

test("infrastructure exceptions preserve only allowlisted diagnostic codes", () => {
  for (const code of ["53300", "40P01", "CONNECTION_CLOSED", "ECONNRESET"]) {
    const result = classifyHeartbeatError(Object.assign(new Error("synthetic private query / secret"), { code }));
    assert.deepEqual(result, { status: 503, error: "RUNTIME_HEARTBEAT_UNAVAILABLE", reasonCode: code });
    assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  }
  assert.equal(classifyHeartbeatError({ code: "SYNTHETIC_SECRET", message: "private" }).reasonCode, "UNCLASSIFIED_INFRASTRUCTURE_ERROR");
});
