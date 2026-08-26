import { createHash, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ffmpegStaticPath from "ffmpeg-static";
import { probeMediaContent } from "../candidate-pipeline/media-tool.ts";
import { extractAudioTrack } from "../transcription/extract-audio.ts";
import { createPrivateTemp, removePrivateTemp } from "../storage/private-temp.ts";

export type MediaProcessorConfig = { token: string; host: string; port: number; maxInputBytes: number };
const execFileAsync = promisify(execFile);
// Health preflight creates synthetic lavfi media and verifies extractAudioTrack output.

async function resolveFfmpegExecutable() {
  const candidates = [process.env.FFMPEG_PATH?.trim(), "/usr/bin/ffmpeg", ffmpegStaticPath].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      await execFileAsync(candidate, ["-version"], { timeout: 10_000, windowsHide: true });
      return candidate;
    } catch { /* try the next executable */ }
  }
  throw new Error("FFMPEG_UNAVAILABLE");
}

async function verifyFfmpegExtraction(ffmpegPath: string) {
  const work = await createPrivateTemp("hh-media-processor-");
  try {
    const synthetic = join(work, "synthetic.mp4");
    const extracted = join(work, "synthetic.m4a");
    await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.2", "-f", "lavfi", "-i", "sine=frequency=1000:duration=0.2", "-shortest", synthetic], { timeout: 15_000, windowsHide: true });
    await extractAudioTrack({ inputPath: synthetic, outputPath: extracted, ffmpegPath });
    if ((await readFile(extracted)).length === 0) throw new Error("FFMPEG_HEALTH_EXTRACTION_EMPTY");
    return true;
  } finally { await removePrivateTemp(work); }
}

export function loadMediaProcessorConfig(source: NodeJS.ProcessEnv = process.env): MediaProcessorConfig {
  const token = source.MEDIA_PROCESSOR_TOKEN?.trim();
  if (!token || token.length < 32) throw new Error("MEDIA_PROCESSOR_TOKEN_MISSING_OR_WEAK");
  const port = Number(source.MEDIA_PROCESSOR_PORT ?? 4080);
  const maxInputBytes = Number(source.MEDIA_PROCESSOR_MAX_INPUT_BYTES ?? 512 * 1024 * 1024);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MEDIA_PROCESSOR_PORT_INVALID");
  if (!Number.isInteger(maxInputBytes) || maxInputBytes < 1) throw new Error("MEDIA_PROCESSOR_MAX_INPUT_BYTES_INVALID");
  return { token, host: source.MEDIA_PROCESSOR_HOST?.trim() || "127.0.0.1", port, maxInputBytes };
}

function authorized(header: string | undefined, expected: string) {
  const actual = header?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function bytes(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > limit) throw new Error("MEDIA_INPUT_TOO_LARGE");
    chunks.push(value);
  }
  if (!length) throw new Error("MEDIA_INPUT_EMPTY");
  return Buffer.concat(chunks);
}

function json(response: ServerResponse, status: number, body: Record<string, unknown>) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

export function createMediaProcessorServer(config: MediaProcessorConfig) {
  const readiness = resolveFfmpegExecutable().then(async (ffmpegPath) => {
    await verifyFfmpegExtraction(ffmpegPath);
    return ffmpegPath;
  });
  return createServer(async (request, response) => {
    if (!authorized(request.headers.authorization, config.token)) return json(response, 401, { code: "MEDIA_PROCESSOR_UNAUTHORIZED" });
    if (request.method === "GET" && request.url === "/health") {
      try { await readiness; return json(response, 200, { ready: true, ffmpeg: "verified", extraction: "verified", storesInput: false }); }
      catch { return json(response, 503, { ready: false, code: "FFMPEG_UNAVAILABLE", storesInput: false }); }
    }
    if (request.method !== "POST" || request.url !== "/v1/extract-audio") return json(response, 404, { code: "MEDIA_PROCESSOR_ROUTE_NOT_FOUND" });
    const work = await createPrivateTemp("hh-media-processor-");
    try {
      const input = await bytes(request, config.maxInputBytes);
      const inputPath = join(work, "source.bin");
      const outputPath = join(work, "audio.m4a");
      await writeFile(inputPath, input);
      const ffmpegPath = await readiness;
      const probe = await probeMediaContent(inputPath, ffmpegPath);
      await extractAudioTrack({ inputPath, outputPath, ffmpegPath });
      const audio = await readFile(outputPath);
      response.writeHead(200, {
        "content-type": "audio/mp4",
        "content-length": String(audio.length),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-audio-sha256": createHash("sha256").update(audio).digest("hex"),
        "x-media-probe": probe.containerEvidence,
        "x-media-duration-seconds": probe.durationSeconds === undefined ? "" : String(probe.durationSeconds),
        "x-extraction-config": "ffmpeg-audio/v1",
      });
      response.end(audio);
    } catch (error) {
      const code = error instanceof Error && ["MEDIA_INPUT_TOO_LARGE", "MEDIA_INPUT_EMPTY", "MEDIA_CONTENT_PROBE_FAILED", "MEDIA_FILE_EMPTY", "FFMPEG_UNAVAILABLE"].includes(error.message)
        ? error.message : "MEDIA_PROCESSOR_FAILED";
      json(response, code === "MEDIA_INPUT_TOO_LARGE" ? 413 : 422, { code });
    } finally {
      await removePrivateTemp(work);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = loadMediaProcessorConfig();
  createMediaProcessorServer(config).listen(config.port, config.host, () => {
    console.log(`Media processor listening on ${config.host}:${config.port}`);
  });
}
