import assert from "node:assert/strict";
import test from "node:test";
import { findReusableReadyInput } from "./production-discovery.ts";

const entries = [{ fileId: "resume", version: "v1", size: 10 }, { fileId: "transcript", version: "v1", size: 20 }];
const manifest = JSON.stringify({ entries });

test("ready transcript classification upgrade never reuses an old incomplete input", () => {
  assert.equal(findReusableReadyInput([{ id: "old", sequence: 1, manifest_json: manifest, state: "MATERIALS_INCOMPLETE" }], entries), undefined);
  assert.equal(findReusableReadyInput([{ id: "ready", sequence: 2, manifest_json: manifest, state: "MATERIALS_READY" }], entries)?.id, "ready");
});

test("ready input reuse remains scoped to the same material shape", () => {
  assert.equal(findReusableReadyInput([{ id: "ready", sequence: 1, manifest_json: manifest, state: "MATERIALS_READY" }], [...entries, { fileId: "recording", size: 30 }]), undefined);
  assert.equal(findReusableReadyInput([{ id: "ready", sequence: 1, manifest_json: manifest, state: "MATERIALS_READY" }], [{ ...entries[0], version: "v2" }, entries[1]]), undefined);
  assert.equal(findReusableReadyInput([{ id: "broken", sequence: 1, manifest_json: "{", state: "MATERIALS_READY" }], entries), undefined);
});
