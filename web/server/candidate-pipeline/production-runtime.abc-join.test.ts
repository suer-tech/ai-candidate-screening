import assert from "node:assert/strict";
import test from "node:test";
import { validateAbcJoinDirectionCoverage } from "./production-runtime.ts";

test("ABC join accepts the directionId returned by the capability schema", () => {
  const shards = [{
    shardIdentity: "communication",
    directions: [{ directionId: "communication" }],
  }];

  assert.equal(validateAbcJoinDirectionCoverage(shards), shards);
});

test("ABC join rejects a missing or mismatched directionId", () => {
  assert.throws(
    () => validateAbcJoinDirectionCoverage([{
      shardIdentity: "communication",
      directions: [{ directionId: "ownership" }],
    }]),
    /ABC_JOIN_DIRECTION_COVERAGE_INVALID/,
  );
  assert.throws(
    () => validateAbcJoinDirectionCoverage([{
      shardIdentity: "communication",
      directions: [{}],
    }]),
    /ABC_JOIN_DIRECTION_COVERAGE_INVALID/,
  );
});
