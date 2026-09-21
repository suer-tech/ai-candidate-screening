import assert from "node:assert/strict";
import test from "node:test";
import { blobLimitFor, GLOBAL_BLOB_LIMIT, TRANSCRIPT_AUDIO_BLOB_LIMIT } from "./blob-store.ts";

test("transcript audio has a dedicated bounded limit without widening ordinary artifacts", () => {
  assert.equal(blobLimitFor("domain-artifact"), 8 * 1024 * 1024);
  assert.equal(blobLimitFor("report-pdf"), 16 * 1024 * 1024);
  assert.equal(blobLimitFor("unregistered-kind"), GLOBAL_BLOB_LIMIT);
  assert.equal(blobLimitFor("transcript-audio"), TRANSCRIPT_AUDIO_BLOB_LIMIT);
  assert.ok(TRANSCRIPT_AUDIO_BLOB_LIMIT > GLOBAL_BLOB_LIMIT);
});
