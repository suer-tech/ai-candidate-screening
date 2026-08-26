import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import { createMediaExtractionTool } from "./media-tool.ts";

function generate(path: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath!, ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-c:a", "aac", "-y", path], { windowsHide: true });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`fixture ffmpeg ${code}`)));
  });
}

test("registered media tool probes content, persists checksum and cleans temp output", async (context) => {
  if (!ffmpegPath) { context.skip("ffmpeg-static unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "candidate-media-test-"));
  const source = join(directory, "interview.mp4");
  try {
    await generate(source);
    let persisted = 0;
    const tool = createMediaExtractionTool({ ffmpegPath, sink: { put: async ({ bytes, checksum }) => { persisted += 1; assert.ok(bytes.byteLength > 0); return { storageIdentity: `r2://audio/${checksum}` }; } } });
    const result = await tool.invoke({ inputPath: source }, { candidateId: "candidate-1", runId: "run-1", inputVersion: "input-1", idempotencyIdentity: "audio:input-1" });
    assert.equal(result.probe.hasAudio, true); assert.match(result.artifact.storageIdentity, /^r2:\/\/audio\//); assert.equal(persisted, 1);
    assert.ok((await stat(source)).isFile());
  } finally { await rm(directory, { recursive: true, force: true }); }
});
