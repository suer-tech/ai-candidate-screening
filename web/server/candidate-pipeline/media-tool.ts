import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import ffmpegStaticPath from "ffmpeg-static";
import type { RegisteredToolAdapter } from "../agent-runtime/adapters.ts";
import { extractAudioTrack } from "../transcription/extract-audio.ts";
import { createPrivateTemp, removePrivateTemp } from "../storage/private-temp.ts";

export type MediaProbe = { hasAudio: true; containerEvidence: string; durationSeconds?: number };
export type AudioArtifactSink = { put(input: { operationIdentity: string; bytes: Uint8Array; checksum: string; contentType: "audio/mp4"; configVersion: string }): Promise<{ storageIdentity: string }> };

function run(binary: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-32_000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stderr) : reject(new Error("MEDIA_CONTENT_PROBE_FAILED")));
  });
}

export async function probeMediaContent(inputPath: string, ffmpegPath = ffmpegStaticPath ?? undefined): Promise<MediaProbe> {
  if (!ffmpegPath) throw new Error("FFMPEG_UNAVAILABLE");
  const source = await stat(inputPath);
  if (!source.isFile() || !source.size) throw new Error("MEDIA_FILE_EMPTY");
  const output = await run(ffmpegPath, ["-nostdin", "-hide_banner", "-i", inputPath, "-map", "0:a:0", "-frames:a", "1", "-f", "null", "-"]);
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  const durationSeconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : undefined;
  return { hasAudio: true, containerEvidence: createHash("sha256").update(output.replace(/[A-Z]:\\[^\s]+|\/[^\s]+/g, "<path>")).digest("hex").slice(0, 16), durationSeconds };
}

export function createMediaExtractionTool(input: { sink: AudioArtifactSink; ffmpegPath?: string; configVersion?: string }): RegisteredToolAdapter<{ inputPath: string }, { probe: MediaProbe; artifact: { storageIdentity: string; checksum: string; configVersion: string } }> {
  const configVersion = input.configVersion ?? "ffmpeg-audio/v1";
  return {
    definition: { key: "candidate.media-extraction/v1", version: "1", inputSchemaVersion: "media-input/v1", outputSchemaVersion: "audio-artifact/v1", timeoutClass: "ffmpeg-local", retryClass: "none", sideEffectClass: "idempotent-write", idempotency: "identity", checkpoint: "artifact", requiredSecrets: [], recoveryActions: ["reuse-audio-checksum", "cleanup-temp"] },
    async invoke(value, context) {
      const work = await createPrivateTemp("candidate-media-tool-");
      const audioPath = join(work, "audio.m4a");
      try {
        const probe = await probeMediaContent(value.inputPath, input.ffmpegPath);
        await extractAudioTrack({ inputPath: value.inputPath, outputPath: audioPath, ffmpegPath: input.ffmpegPath });
        const bytes = new Uint8Array(await readFile(audioPath));
        const checksum = createHash("sha256").update(bytes).digest("hex");
        const stored = await input.sink.put({ operationIdentity: context.idempotencyIdentity, bytes, checksum, contentType: "audio/mp4", configVersion });
        return { probe, artifact: { storageIdentity: stored.storageIdentity, checksum, configVersion } };
      } finally { await removePrivateTemp(work); }
    },
  };
}
