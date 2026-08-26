import assert from "node:assert/strict";
import { mkdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPrivateTemp, recoverStalePrivateTemp, removePrivateTemp } from "./private-temp.ts";

test("private temp is bounded and cleanup is unconditional", async () => {
  const directory = await createPrivateTemp("hh-drive-source-");
  await writeFile(path.join(directory, "source.bin"), "synthetic");
  assert.equal((await stat(directory)).isDirectory(), true);
  await removePrivateTemp(directory);
  await assert.rejects(stat(directory));
  await assert.rejects(removePrivateTemp(path.resolve(tmpdir(), "unrelated")), /PRIVATE_TEMP_PATH_DENIED/);
});

test("startup recovery removes only stale allowlisted directories", async () => {
  const stale = await createPrivateTemp("hh-media-processor-");
  const fresh = await createPrivateTemp("candidate-media-tool-");
  const unrelated = path.join(tmpdir(), `unrelated-${process.pid}`);
  await mkdir(unrelated);
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(stale, old, old);
  try {
    const result = await recoverStalePrivateTemp({ olderThanMs: 60 * 60 * 1000 });
    assert.ok(result.removed >= 1);
    await assert.rejects(stat(stale));
    assert.equal((await stat(fresh)).isDirectory(), true);
    assert.equal((await stat(unrelated)).isDirectory(), true);
  } finally {
    await removePrivateTemp(fresh);
    await import("node:fs/promises").then(({ rm }) => rm(unrelated, { recursive: true, force: true }));
  }
});
