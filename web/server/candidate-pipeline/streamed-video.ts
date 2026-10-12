import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { DownloadedSourceFile, VersionedFileDownload } from "../google-drive-oauth/my-drive-adapter.ts";
import { mediaInputLimit } from "../media-processor/limits.ts";
import { collectBoundedBytes, TRANSCRIPT_AUDIO_BLOB_LIMIT } from "../storage/blob-store.ts";
import { createPrivateTemp, removePrivateTemp } from "../storage/private-temp.ts";
import { runCandidatePhase } from "./phase-diagnostics.ts";

type VideoTransferInput = {
  drive: { downloadVersionToFile(input: VersionedFileDownload & { targetPath: string; maxBytes: number; signal?: AbortSignal }): Promise<DownloadedSourceFile> };
  source: { fileId: string; version: string; size?: number; modifiedTime?: string };
  expectedChecksum?: string;
  checkpoint: VersionedFileDownload["checkpoint"];
  mediaUrl: URL | string; mediaToken: string; mimeType: string;
  signal?: AbortSignal; maxInputBytes?: number;
  auditSource?: (source: DownloadedSourceFile) => Promise<void>;
  correlation?: { runId: string; taskId: string; attemptId: string };
};

export async function extractVideoAudio(input: VideoTransferInput): Promise<Uint8Array> {
  const maxBytes = mediaInputLimit(input.maxInputBytes);
  if (input.source.size !== undefined && input.source.size > maxBytes) throw new Error("MEDIA_INPUT_TOO_LARGE");
  const signal = AbortSignal.any([AbortSignal.timeout(15 * 60_000), ...(input.signal ? [input.signal] : [])]);
  signal.throwIfAborted();
  const work = await createPrivateTemp("hh-drive-source-");
  let upload: ReturnType<typeof createReadStream> | undefined;
  const phase = <T>(name: "media-source-download" | "media-processor-request" | "media-response-read", operation: () => Promise<T>) =>
    input.correlation ? runCandidatePhase(input.correlation, name, operation) : operation();
  try {
    const source = await phase("media-source-download", () => input.drive.downloadVersionToFile({
      fileId: input.source.fileId, expectedVersion: input.source.version,
      expectedSize: input.source.size, expectedModifiedTime: input.source.modifiedTime,
      expectedChecksum: input.expectedChecksum, checkpoint: input.checkpoint,
      targetPath: join(work, "source.bin"), maxBytes, signal,
    }));
    signal.throwIfAborted();
    await input.auditSource?.(source);
    signal.throwIfAborted();
    upload = createReadStream(source.path, { highWaterMark: 64 * 1024, signal });
    const response = await phase("media-processor-request", async () => {
      const result = await fetch(input.mediaUrl, {
        method: "POST", headers: { authorization: `Bearer ${input.mediaToken}`, "content-type": input.mimeType, "content-length": String(source.byteSize) },
        // Undici clones request bodies when redirects are enabled, retaining the whole upload.
        body: upload as unknown as BodyInit, duplex: "half", redirect: "error", signal,
      } as RequestInit & { duplex: "half" });
      if (!result.ok) {
        const failure = await result.json().catch(() => null) as { code?: unknown } | null;
        throw new Error(failure?.code === "MEDIA_AUDIO_TOO_LARGE" || failure?.code === "MEDIA_INPUT_TOO_LARGE"
          ? failure.code : `MEDIA_PROCESSOR_HTTP_${result.status}`);
      }
      return result;
    });
    return await phase("media-response-read", async () => {
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > TRANSCRIPT_AUDIO_BLOB_LIMIT) {
        await response.body?.cancel();
        throw new Error("MEDIA_AUDIO_TOO_LARGE");
      }
      if (!response.body) throw new Error("MEDIA_FILE_EMPTY");
      try {
        const bytes = await collectBoundedBytes(response.body as unknown as AsyncIterable<Uint8Array>, TRANSCRIPT_AUDIO_BLOB_LIMIT);
        signal.throwIfAborted();
        if (!bytes.byteLength) throw new Error("MEDIA_FILE_EMPTY");
        const checksum = response.headers.get("x-audio-sha256");
        if (checksum && checksum !== createHash("sha256").update(bytes).digest("hex")) throw new Error("MEDIA_AUDIO_CHECKSUM_MISMATCH");
        return bytes;
      } catch (error) {
        if (error instanceof Error && error.message === "BLOB_SIZE_LIMIT_EXCEEDED") throw new Error("MEDIA_AUDIO_TOO_LARGE");
        throw error;
      }
    });
  } finally {
    if (upload && !upload.closed) {
      const closed = new Promise<void>((resolve) => upload!.once("close", resolve));
      upload.destroy();
      await closed;
    }
    await removePrivateTemp(work);
  }
}
