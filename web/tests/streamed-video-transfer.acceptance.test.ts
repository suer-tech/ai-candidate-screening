import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { GoogleMyDriveAdapter } from "../server/google-drive-oauth/my-drive-adapter.ts";
import type { GoogleDriveOAuthRepository } from "../server/google-drive-oauth/types.ts";
import { taskFailurePolicy } from "../server/agent-runtime/failure-policy.ts";

// Independent acceptance authored before the implementation. Oracle: INT-002,
// INT-009, INT-018, SEC-001 and the owner's explicit bounded-video-transfer fix.
// Synthetic data only; no Drive writes, providers, runtime credentials or candidates.
type DownloadInput = {
  fileId: string; expectedVersion: string; expectedSize?: number; expectedModifiedTime?: string;
  expectedChecksum?: string; targetPath: string; maxBytes: number; signal?: AbortSignal;
  checkpoint: (value: { fileId: string; version: string; checksum: string }) => Promise<void> | void;
};
type DownloadOutput = { path: string; checksum: string; version: string; byteSize: number };
type StreamingDrive = { downloadVersionToFile(input: DownloadInput): Promise<DownloadOutput> };
type ExtractInput = {
  drive: StreamingDrive; source: { fileId: string; version: string; size: number; modifiedTime: string };
  expectedChecksum?: string; checkpoint: DownloadInput["checkpoint"];
  mediaUrl: string; mediaToken: string; mimeType: string; signal?: AbortSignal; maxInputBytes?: number;
  auditSource?: (source: DownloadOutput) => Promise<void>;
};
const revision = "pinned-revision-4";
const modified = "2026-10-01T07:00:00.000Z";
const chunk = new Uint8Array(64 * 1024).fill(37);
const audio = new Uint8Array([0, 17, 23, 42, 255]);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function repeatedHash(count: number) {
  const digest = createHash("sha256");
  for (let index = 0; index < count; index++) digest.update(chunk);
  return digest.digest("hex");
}
function driveFixture(options: {
  chunks?: number; metadataVersion?: string; metadataSize?: number; declaredLength?: number;
  beforeChunk?: (index: number) => void; onDownload?: () => void; noArrayBuffer?: boolean;
} = {}) {
  const chunks = options.chunks ?? 128;
  let pulls = 0;
  let mediaCalls = 0;
  const adapter = new GoogleMyDriveAdapter({
    connectionId: "synthetic-connection", rootFolderId: "synthetic-root",
    repository: { isRegisteredDescendant: async () => true } as unknown as GoogleDriveOAuthRepository,
    accessToken: async () => "synthetic-access-token",
    fetch: async (input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access-token");
      const url = new URL(String(input));
      assert.equal(url.hostname, "www.googleapis.com");
      if (url.searchParams.has("fields")) return Response.json({
        id: "synthetic-video", version: options.metadataVersion ?? revision,
        modifiedTime: modified, size: String(options.metadataSize ?? chunks * chunk.length),
      });
      assert.equal(url.searchParams.get("alt"), "media");
      mediaCalls++;
      options.onDownload?.();
      let index = 0;
      const response = new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index >= chunks) { controller.close(); return; }
          options.beforeChunk?.(index);
          pulls++;
          index++;
          controller.enqueue(chunk);
        },
      }), { headers: options.declaredLength === undefined ? {} : { "content-length": String(options.declaredLength) } });
      if (options.noArrayBuffer !== false) response.arrayBuffer = async () => {
        assert.fail("the Drive video must be consumed as a stream, never collected with arrayBuffer()");
      };
      return response;
    },
  });
  const download = (input: DownloadInput) => {
    const method = (adapter as unknown as Partial<StreamingDrive>).downloadVersionToFile;
    assert.equal(typeof method, "function", "Drive must offer bounded downloadVersionToFile for large pinned recordings");
    return method!.call(adapter, input);
  };
  return { drive: { downloadVersionToFile: download }, download, pulls: () => pulls, mediaCalls: () => mediaCalls };
}
async function withTarget(run: (path: string) => Promise<void>) {
  const work = await mkdtemp(join(tmpdir(), "hh-stream-acceptance-"));
  try { await run(join(work, "video.bin")); }
  finally {
    assert.ok(work.startsWith(join(tmpdir(), "hh-stream-acceptance-")));
    await rm(work, { recursive: true, force: true });
  }
}
async function absent(path: string) {
  await assert.rejects(access(path), { code: "ENOENT" }, "temporary input must be removed");
}
const downloadInput = (targetPath: string, chunks = 128): DownloadInput => ({
  fileId: "synthetic-video", expectedVersion: revision, expectedSize: chunks * chunk.length,
  expectedModifiedTime: modified, targetPath, maxBytes: 16 * 1024 * 1024,
  checkpoint: () => undefined,
});
async function extractor(): Promise<(input: ExtractInput) => Promise<Uint8Array>> {
  const path = new URL("../server/candidate-pipeline/streamed-video.ts", import.meta.url);
  await access(path).catch(() => assert.fail("production video extraction must expose a bounded file-stream transfer boundary"));
  const module = await import(path.href);
  assert.equal(typeof module.extractVideoAudio, "function");
  return module.extractVideoAudio;
}
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/v1/extract-audio`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
function extractionInput(drive: StreamingDrive, mediaUrl: string, chunks = 128): ExtractInput {
  return {
    drive, source: { fileId: "synthetic-video", version: revision, size: chunks * chunk.length, modifiedTime: modified },
    checkpoint: () => undefined, mediaUrl, mediaToken: "synthetic-media-token", mimeType: "video/webm",
  };
}

test("INT-009: pinned recording downloads in chunks with checksum and checkpoint, without whole-file buffering", async () => {
  const fixture = driveFixture();
  await withTarget(async (path) => {
    const checkpoints: unknown[] = [];
    const result = await fixture.download({ ...downloadInput(path), checkpoint: (value) => { checkpoints.push(value); } });
    assert.deepEqual(result, { path, checksum: repeatedHash(128), version: revision, byteSize: 128 * chunk.length });
    assert.equal((await stat(path)).size, result.byteSize);
    assert.deepEqual(checkpoints, [{ fileId: "synthetic-video", version: revision, checksum: result.checksum }]);
    assert.equal(fixture.pulls(), 128);
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600, "private source file permissions");
    assert.equal(hash(await readFile(path)), result.checksum);
  });
});

test("INT-002: changed pinned version fails before content download", async () => {
  const fixture = driveFixture({ metadataVersion: "changed", metadataSize: 1 });
  await withTarget(async (path) => {
    await assert.rejects(fixture.download(downloadInput(path)), /DRIVE_FILE_VERSION_CHANGED/);
    assert.equal(fixture.mediaCalls(), 0);
    await absent(path);
  });
});

test("INT-002: metadata-identical revision churn still verifies the expected content checksum", async () => {
  const fixture = driveFixture({ metadataVersion: "changed" });
  await withTarget(async (path) => {
    const result = await fixture.download({ ...downloadInput(path), expectedChecksum: repeatedHash(128) });
    assert.equal(result.version, "changed");
    assert.equal(result.checksum, repeatedHash(128));
  });
});

test("INT-002/SEC-001: checksum mismatch never checkpoints and removes downloaded input", async () => {
  const fixture = driveFixture();
  await withTarget(async (path) => {
    let checkpointed = false;
    await assert.rejects(fixture.download({ ...downloadInput(path), expectedChecksum: "0".repeat(64),
      checkpoint: () => { checkpointed = true; } }), /DRIVE_FILE_CONTENT_CHANGED/);
    assert.equal(checkpointed, false);
    await absent(path);
  });
});

test("bounded transfer rejects excessive declared size before reading a Drive body", async () => {
  const fixture = driveFixture({ metadataSize: 17 * 1024 * 1024 });
  await withTarget(async (path) => {
    await assert.rejects(fixture.download({ ...downloadInput(path), expectedSize: 17 * 1024 * 1024 }), /(?:DRIVE|MEDIA)_INPUT_TOO_LARGE/);
    assert.equal(fixture.mediaCalls(), 0);
    await absent(path);
  });
});

test("bounded transfer rejects oversized HTTP declaration and actual chunk count with cleanup", async () => {
  for (const declaredLength of [17 * 1024 * 1024, undefined]) {
    const fixture = driveFixture({ chunks: 128, metadataSize: chunk.length * 2, declaredLength });
    await withTarget(async (path) => {
      await assert.rejects(fixture.download({ ...downloadInput(path), expectedSize: chunk.length * 2,
        maxBytes: chunk.length * 2 }), /(?:DRIVE|MEDIA)_INPUT_TOO_LARGE/);
      if (declaredLength === undefined) assert.ok(fixture.pulls() >= 3, "actual body bound must be exercised after reading chunks");
      await absent(path);
    });
  }
});

test("SEC-001: abort during Drive download removes partial input and does not checkpoint", async () => {
  const controller = new AbortController();
  const fixture = driveFixture({ beforeChunk: (index) => { if (index === 4) controller.abort(); } });
  await withTarget(async (path) => {
    let checkpointed = false;
    await assert.rejects(fixture.download({ ...downloadInput(path), signal: controller.signal,
      checkpoint: () => { checkpointed = true; } }), (error: Error) => error.name === "AbortError");
    assert.equal(checkpointed, false);
    await absent(path);
  });
});

test("INT-009/INT-018: application sends the file to media as bounded chunks and cleans private input on success", async () => {
  const extract = await extractor();
  const fixture = driveFixture();
  const paths: string[] = [];
  const drive: StreamingDrive = { downloadVersionToFile: (input) => { paths.push(input.targetPath); return fixture.download(input); } };
  const received = { bytes: 0, maxChunk: 0, checksum: "", requests: 0 };
  let audited = false;
  const server = createServer(async (request, response) => {
    received.requests++;
    assert.equal(audited, true, "source identity must be audited before media submission");
    assert.equal(request.url, "/v1/extract-audio");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer synthetic-media-token");
    assert.equal(request.headers["content-type"], "video/webm");
    assert.equal(request.headers["content-length"], String(128 * chunk.length));
    const digest = createHash("sha256");
    for await (const part of request) {
      received.bytes += part.length;
      received.maxChunk = Math.max(received.maxChunk, part.length);
      digest.update(part);
    }
    received.checksum = digest.digest("hex");
    response.writeHead(200, { "content-type": "audio/mp4", "x-audio-sha256": hash(audio) });
    response.end(audio);
  });
  const mediaUrl = await listen(server);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), mediaUrl);
    assert.equal(init?.redirect, "error",
      "streamed media upload must reject redirects so Undici cannot retain a whole replay copy of the video");
    const body = init?.body as unknown as { [Symbol.asyncIterator]?: unknown; getReader?: unknown } | undefined;
    assert.ok(body && (typeof body[Symbol.asyncIterator] === "function" || typeof body.getReader === "function"),
      "media upload must receive a stream, never a collected video ArrayBuffer or Uint8Array");
    return nativeFetch(input, init);
  };
  try {
    assert.deepEqual(await extract({ ...extractionInput(drive, mediaUrl), auditSource: async (source) => {
      assert.deepEqual(source, { path: paths[0], checksum: repeatedHash(128), version: revision, byteSize: 128 * chunk.length });
      assert.equal((await stat(source.path)).size, source.byteSize);
      audited = true;
    } }), audio);
    assert.equal(received.requests, 1);
    assert.equal(received.bytes, 128 * chunk.length);
    assert.equal(received.checksum, repeatedHash(128));
    assert.ok(received.maxChunk < received.bytes, "media must observe streamed chunks rather than one whole video body");
    assert.equal(paths.length, 1);
    await absent(dirname(paths[0]));
  } finally { globalThis.fetch = nativeFetch; await close(server); }
});

test("INT-002: changed content is rejected before media submission and source directory is removed", async () => {
  const extract = await extractor();
  const fixture = driveFixture();
  let target = "";
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end(audio); });
  const mediaUrl = await listen(server);
  try {
    await assert.rejects(extract({ ...extractionInput({ downloadVersionToFile: (input) => {
      target = input.targetPath; return fixture.download(input);
    } }, mediaUrl), expectedChecksum: "0".repeat(64) }), /DRIVE_FILE_CONTENT_CHANGED/);
    assert.equal(requests, 0);
    await absent(dirname(target));
  } finally { await close(server); }
});

test("INT-018/SEC-001: media failure removes the source directory", async () => {
  const extract = await extractor();
  const fixture = driveFixture();
  let target = "";
  const server = createServer(async (request, response) => {
    for await (const _part of request) { /* drain synthetic request */ }
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: "untrusted downstream message" }));
  });
  const mediaUrl = await listen(server);
  try {
    await assert.rejects(extract(extractionInput({ downloadVersionToFile: (input) => {
      target = input.targetPath; return fixture.download(input);
    } }, mediaUrl)), /MEDIA_PROCESSOR_HTTP_503/);
    await absent(dirname(target));
  } finally { await close(server); }
});

test("bounded audio response rejects an excessive HTTP length and removes temporary source", async () => {
  const extract = await extractor();
  const fixture = driveFixture({ chunks: 1 });
  let target = "";
  const server = createServer(async (request, response) => {
    for await (const _part of request) { /* drain synthetic video */ }
    response.writeHead(200, { "content-type": "audio/mp4", "content-length": String(256 * 1024 * 1024 + 1) });
    response.end(audio);
  });
  const mediaUrl = await listen(server);
  try {
    await assert.rejects(extract(extractionInput({ downloadVersionToFile: (input) => {
      target = input.targetPath; return fixture.download(input);
    } }, mediaUrl, 1)), /MEDIA_AUDIO_TOO_LARGE/);
    await absent(dirname(target));
  } finally { await close(server); }
});

test("audio response checksum mismatch is rejected with source cleanup", async () => {
  const extract = await extractor();
  const fixture = driveFixture({ chunks: 1 });
  let target = "";
  const server = createServer(async (request, response) => {
    for await (const _part of request) { /* drain synthetic video */ }
    response.writeHead(200, { "content-type": "audio/mp4", "x-audio-sha256": "0".repeat(64) });
    response.end(audio);
  });
  const mediaUrl = await listen(server);
  try {
    await assert.rejects(extract(extractionInput({ downloadVersionToFile: (input) => {
      target = input.targetPath; return fixture.download(input);
    } }, mediaUrl, 1)), /MEDIA_AUDIO_CHECKSUM_MISMATCH/);
    await absent(dirname(target));
  } finally { await close(server); }
});

test("INT-018/SEC-001: cancellation during media upload stops the transfer and cleans source", async () => {
  const extract = await extractor();
  const fixture = driveFixture({ chunks: 512 });
  let target = "";
  const controller = new AbortController();
  const server = createServer((request) => {
    request.once("data", () => { request.pause(); controller.abort(); });
    request.on("error", () => undefined);
  });
  const mediaUrl = await listen(server);
  try {
    await assert.rejects(extract({ ...extractionInput({ downloadVersionToFile: (input) => {
      target = input.targetPath; return fixture.download(input);
    } }, mediaUrl, 512), signal: controller.signal }), (error: Error) => error.name === "AbortError");
    await absent(dirname(target));
    // Closing all sockets below also avoids keeping a cancelled synthetic peer alive.
    assert.equal(controller.signal.aborted, true);
  } finally { await close(server); }
});

test("large WebM inputs above 1.07 GB fit the application's default bounded transfer budget", async () => {
  const extract = await extractor();
  let maxBytes = 0;
  let target = "";
  const boundaryStop = new Error("SYNTHETIC_DOWNLOAD_BOUNDARY_STOP");
  const sourceSize = 1_150_000_000;
  const drive: StreamingDrive = { downloadVersionToFile: async (input) => {
    maxBytes = input.maxBytes;
    target = input.targetPath;
    assert.equal(input.expectedSize, sourceSize);
    throw boundaryStop;
  } };
  await assert.rejects(extract({ ...extractionInput(drive, "http://127.0.0.1:4080/v1/extract-audio"),
    source: { fileId: "synthetic-video", version: revision, size: sourceSize, modifiedTime: modified },
  }), (error) => error === boundaryStop);
  assert.ok(maxBytes >= sourceSize, `default transfer limit ${maxBytes} must allow the incident's large WebM`);
  await absent(dirname(target));
});

for (const toolKey of ["candidate.transcript-media-shard/v1", "candidate.transcription/v1", "candidate.transcript-shard/v1"]) {
  test(`temporary lease-check database outage retries ${toolKey} with bounded backoff`, () => {
    assert.deepEqual(taskFailurePolicy(toolKey, "TASK_LEASE_CHECK_UNAVAILABLE", 1),
      { retry: true, delayMs: 5_000, maxAttempts: 3 }, "a temporary initial ownership-check outage must be retryable");
    assert.deepEqual(taskFailurePolicy(toolKey, "TASK_LEASE_CHECK_UNAVAILABLE", 2),
      { retry: true, delayMs: 15_000, maxAttempts: 3 });
    assert.deepEqual(taskFailurePolicy(toolKey, "TASK_LEASE_CHECK_UNAVAILABLE", 3),
      { retry: false, delayMs: 0, maxAttempts: 3 }, "the last allowed attempt must stop automatic retries");
  });
}
