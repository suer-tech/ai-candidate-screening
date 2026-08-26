import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createMediaProcessorServer } from "./server.ts";

const token = "synthetic-media-token-at-least-thirty-two-characters";

test("media processor is private and does not expose input/storage on health", async () => {
  const server = createMediaProcessorServer({ token, host: "127.0.0.1", port: 0, maxInputBytes: 1024 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`)).status, 401);
    const response = await fetch(`http://127.0.0.1:${address.port}/health`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ready: true, ffmpeg: true, storesInput: false });
    const oversized = await fetch(`http://127.0.0.1:${address.port}/v1/extract-audio`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: new Uint8Array(1025) });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { code: "MEDIA_INPUT_TOO_LARGE" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
