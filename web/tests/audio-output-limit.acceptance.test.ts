import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { extractAudioTrack } from "../server/transcription/extract-audio.ts";

const execFileAsync = promisify(execFile);

test("oversized AAC stream copy is recompressed within the configured audio output limit", async () => {
  assert.ok(ffmpegPath, "local FFmpeg is required for this synthetic media acceptance test");
  const work = await mkdtemp(join(tmpdir(), "hh-synthetic-audio-limit-"));
  try {
    const inputPath = join(work, "synthetic-source.m4a");
    const copiedPath = join(work, "copied.m4a");
    const compactPath = join(work, "compact-reference.m4a");
    const boundedPath = join(work, "bounded.m4a");
    await execFileAsync(ffmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "anoisesrc=color=white:sample_rate=48000:duration=2",
      "-c:a", "aac", "-b:a", "256k", "-ac", "2", inputPath,
    ], { timeout: 10_000, windowsHide: true });
    const copied = await extractAudioTrack({ inputPath, outputPath: copiedPath, ffmpegPath });
    assert.equal(copied.mode, "stream_copy", "the fixture must exercise the AAC copy fast path");
    await execFileAsync(ffmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
      "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
      "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-ar", "48000", "-movflags", "+faststart", compactPath,
    ], { timeout: 10_000, windowsHide: true });
    const compactSize = (await stat(compactPath)).size;
    assert.ok(compactSize > 0 && copied.sizeBytes > compactSize + 1024,
      `fixture must have a meaningful compact alternative (copy=${copied.sizeBytes}, compact=${compactSize})`);
    const maxOutputBytes = Math.floor((copied.sizeBytes + compactSize) / 2);

    const bounded = await (extractAudioTrack as (options: {
      inputPath: string; outputPath: string; ffmpegPath: string; maxOutputBytes: number;
    }) => ReturnType<typeof extractAudioTrack>)({ inputPath, outputPath: boundedPath, ffmpegPath, maxOutputBytes });
    assert.equal(bounded.mode, "aac_transcode", "an oversized AAC copy must trigger speech-oriented transcoding");
    assert.ok(bounded.sizeBytes > 0 && bounded.sizeBytes <= maxOutputBytes,
      `audio output must fit the configured blob limit (${bounded.sizeBytes} > ${maxOutputBytes})`);
    assert.equal((await stat(boundedPath)).size, bounded.sizeBytes);
  } finally {
    assert.ok(work.startsWith(join(tmpdir(), "hh-synthetic-audio-limit-")), "cleanup is limited to this test's temporary directory");
    await rm(work, { recursive: true, force: true });
  }
});
