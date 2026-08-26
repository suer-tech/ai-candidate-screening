import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DRIVE_LARGE_DOWNLOAD_TIMEOUT_MS, DRIVE_RESUMABLE_CHUNK_BYTES, GoogleMyDriveAdapter } from "./my-drive-adapter.ts";
import type { GoogleDriveOAuthRepository, RegisteredDriveObject } from "./types.ts";

test("large My Drive inputs use a bounded resumable upload session", async () => {
  const registered: RegisteredDriveObject[] = [];
  const repository = {
    isRegisteredDescendant: async () => true,
    findByOperationIdentity: async () => null,
    registerObject: async (object: RegisteredDriveObject) => { registered.push(object); },
  } as unknown as GoogleDriveOAuthRepository;
  const bytes = new Uint8Array(8 * 1024 * 1024 + 1);
  bytes[0] = 17;
  bytes[bytes.length - 1] = 29;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (method === "GET") return Response.json({ files: [] });
    if (method === "POST") return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/session/synthetic" } });
    assert.equal(method, "PUT");
    assert.equal(url, "https://www.googleapis.com/upload/session/synthetic");
    assert.ok(init.body instanceof ArrayBuffer);
    assert.ok(init.body.byteLength <= DRIVE_RESUMABLE_CHUNK_BYTES);
    const range = new Headers(init.headers).get("content-range");
    if (range === `bytes 0-${DRIVE_RESUMABLE_CHUNK_BYTES - 1}/${bytes.byteLength}`) return new Response(null, { status: 308, headers: { range: `bytes=0-${DRIVE_RESUMABLE_CHUNK_BYTES - 1}` } });
    assert.equal(range, `bytes ${DRIVE_RESUMABLE_CHUNK_BYTES}-${bytes.byteLength - 1}/${bytes.byteLength}`);
    return Response.json({ id: "synthetic-file-id" });
  };
  const adapter = new GoogleMyDriveAdapter({
    connectionId: "connection-1",
    rootFolderId: "root-1",
    repository,
    accessToken: async () => "synthetic-access-token",
    fetch: fetcher,
  });

  const result = await adapter.putFile({
    parentFolderId: "candidate-folder-1",
    fileName: "candidate-interview.mp4",
    mimeType: "video/mp4",
    bytes,
    checksum,
    operationIdentity: "benchmark-input-1",
  });

  assert.deepEqual(result, { id: "synthetic-file-id", checksum, reused: false });
  assert.equal(calls.filter((call) => call.url.includes("uploadType=resumable")).length, 1);
  assert.equal(calls.some((call) => call.url.includes("uploadType=multipart")), false);
  assert.equal(calls.filter((call) => call.method === "PUT").length, 2);
  assert.equal(registered.at(-1)?.checksum, checksum);
});

test("large My Drive interview downloads have a durable long-operation budget", () => {
  assert.equal(DRIVE_LARGE_DOWNLOAD_TIMEOUT_MS, 15 * 60_000);
});

test("manual reprocessing tolerates Drive revision churn only for checksum-identical input", async () => {
  const bytes = new TextEncoder().encode("same immutable interview bytes");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const repository = {
    isRegisteredDescendant: async () => true,
  } as unknown as GoogleDriveOAuthRepository;
  const adapter = new GoogleMyDriveAdapter({
    connectionId: "connection-1",
    rootFolderId: "root-1",
    repository,
    accessToken: async () => "synthetic-access-token",
    fetch: async (input) => String(input).includes("fields=")
      ? Response.json({ id: "video-1", version: "9", size: String(bytes.byteLength), modifiedTime: "2026-08-17T07:35:01.000Z" })
      : new Response(bytes),
  });
  const result = await adapter.downloadVersion({ fileId: "video-1", expectedVersion: "4", expectedSize: bytes.byteLength,
    expectedModifiedTime: "2026-08-17T07:35:01.000Z", expectedChecksum: checksum, checkpoint: () => undefined });
  assert.equal(result.version, "9");
  assert.equal(result.checksum, checksum);
});
