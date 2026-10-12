import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import ffmpegStaticPath from "ffmpeg-static";

import type { ExtractedAudio } from "./types.js";

export interface ExtractAudioOptions {
  inputPath: string;
  outputPath: string;
  ffmpegPath?: string;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

async function runFfmpeg(binaryPath: string, args: string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      signal,
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_000);
    });
    let processError: Error | undefined;
    child.on("error", (error: Error) => { processError = error; });
    child.on("close", (code) => {
      if (signal?.aborted) return reject(signal.reason);
      if (processError) return reject(processError);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg завершился с кодом ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });
}

async function assertUsableFile(path: string, label: string): Promise<number> {
  const file = await stat(path);
  if (!file.isFile() || file.size === 0) {
    throw new Error(`${label} не является непустым файлом: ${path}`);
  }
  return file.size;
}

/**
 * Extracts the first audio stream to an M4A container.
 *
 * The fast path copies AAC without re-encoding. If the source codec cannot be
 * stored in M4A, the function retries with a speech-friendly AAC encoding.
 */
export async function extractAudioTrack(options: ExtractAudioOptions): Promise<ExtractedAudio> {
  options.signal?.throwIfAborted();
  const binaryPath = options.ffmpegPath ?? ffmpegStaticPath;
  if (!binaryPath) {
    throw new Error("Для этой платформы не найден исполняемый файл FFmpeg.");
  }

  await assertUsableFile(options.inputPath, "Исходное видео");
  if (options.maxOutputBytes !== undefined && (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1)) {
    throw new Error("MEDIA_AUDIO_LIMIT_INVALID");
  }
  await mkdir(dirname(options.outputPath), { recursive: true });
  await rm(options.outputPath, { force: true });

  const commonArgs = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    options.inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
  ];

  let copyError: unknown;
  try {
    await runFfmpeg(binaryPath, [...commonArgs, "-c:a", "copy", "-movflags", "+faststart", options.outputPath], options.signal);
    const sizeBytes = await assertUsableFile(options.outputPath, "Извлечённое аудио");
    if (options.maxOutputBytes === undefined || sizeBytes <= options.maxOutputBytes) {
      return { path: options.outputPath, sizeBytes, mode: "stream_copy" };
    }
    copyError = new Error("MEDIA_AUDIO_COPY_TOO_LARGE");
  } catch (error) {
    options.signal?.throwIfAborted();
    copyError = error;
  }
  await rm(options.outputPath, { force: true });
  try {
    await runFfmpeg(binaryPath, [
      ...commonArgs,
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      options.outputPath,
    ], options.signal);
  } catch (transcodeError) {
    options.signal?.throwIfAborted();
    throw new AggregateError(
      [copyError, transcodeError],
      "Не удалось извлечь первую аудиодорожку из видео.",
    );
  }
  const sizeBytes = await assertUsableFile(options.outputPath, "Извлечённое аудио");
  if (options.maxOutputBytes !== undefined && sizeBytes > options.maxOutputBytes) {
    await rm(options.outputPath, { force: true });
    throw new Error("MEDIA_AUDIO_TOO_LARGE");
  }
  return { path: options.outputPath, sizeBytes, mode: "aac_transcode" };
}
