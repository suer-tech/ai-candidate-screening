import assert from "node:assert/strict";
import test from "node:test";
import { DurableAssemblyAiAdapter, GoogleMyDrivePipelineAdapter, TelegramOutbox } from "./providers.ts";

test("Google My Drive adapter paginates by stable IDs without Shared Drive parameters", async () => {
  const urls: string[] = [];
  const adapter = new GoogleMyDrivePipelineAdapter({ rootFolderId: "root-1", accessToken: async () => "server-token", fetch: async (input) => {
    const url = String(input); urls.push(url);
    const page = urls.length === 1
      ? { nextPageToken: "page-2", files: [{ id: "file-1", name: "one.pdf", mimeType: "application/pdf", size: "10", modifiedTime: "2026-08-20T00:00:00Z", version: "2" }] }
      : { files: [{ id: "file-2", name: "two.mp4", mimeType: "video/mp4", size: "20", modifiedTime: "2026-08-20T00:00:00Z", version: "3" }] };
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const files = await adapter.listChildren("folder-1");
  assert.deepEqual(files.map((file) => file.fileId), ["file-1", "file-2"]);
  assert.doesNotMatch(urls[0], /corpora=drive|driveId=|supportsAllDrives/);
  assert.match(urls[1], /pageToken=page-2/);
  assert.doesNotMatch(urls.join(" "), /server-token/);
});

test("Drive download accepts provider revision churn only when immutable content checksum still matches", async () => {
  const bytes = new TextEncoder().encode("same immutable interview bytes");
  const expectedChecksum = "d554ec7627fa6205a81110292ea74e63442b2b348ed6c1f4a478eec65c57921e";
  const checkpoints: Array<{ fileId: string; version: string; checksum: string }> = [];
  const adapter = new GoogleMyDrivePipelineAdapter({ rootFolderId: "root-1", accessToken: async () => "server-token", fetch: async (input) => {
    const url = String(input);
    if (url.includes("fields=")) return Response.json({ id: "video-1", version: "9", size: String(bytes.byteLength), modifiedTime: "2026-08-17T07:35:01.000Z" });
    return new Response(bytes, { status: 200 });
  } });
  const downloaded = await adapter.downloadVersion({
    fileId: "video-1",
    expectedVersion: "4",
    expectedSize: bytes.byteLength,
    expectedModifiedTime: "2026-08-17T07:35:01.000Z",
    expectedChecksum,
    checkpoint: (value) => { checkpoints.push(value); },
  });
  assert.equal(downloaded.version, "9");
  assert.equal(downloaded.checksum, expectedChecksum);
  assert.deepEqual(checkpoints, [{ fileId: "video-1", version: "9", checksum: expectedChecksum }]);
});

test("Drive download rejects changed bytes even when provider metadata looks stable", async () => {
  const bytes = new TextEncoder().encode("changed interview bytes");
  const adapter = new GoogleMyDrivePipelineAdapter({ rootFolderId: "root-1", accessToken: async () => "server-token", fetch: async (input) => {
    const url = String(input);
    if (url.includes("fields=")) return Response.json({ id: "video-1", version: "9", size: String(bytes.byteLength), modifiedTime: "2026-08-17T07:35:01.000Z" });
    return new Response(bytes, { status: 200 });
  } });
  await assert.rejects(adapter.downloadVersion({
    fileId: "video-1",
    expectedVersion: "4",
    expectedSize: bytes.byteLength,
    expectedModifiedTime: "2026-08-17T07:35:01.000Z",
    expectedChecksum: "0".repeat(64),
    checkpoint: () => undefined,
  }), /DRIVE_FILE_CONTENT_CHANGED/);
});

test("AssemblyAI create checkpoints remote job before polling and restart reuses it", async () => {
  let creates = 0;
  let polls = 0;
  const adapter = new DurableAssemblyAiAdapter({ apiKey: "secret", fetch: async (input, init) => {
    if (init?.method === "POST") { creates += 1; return new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 200 }); }
    polls += 1; return new Response(JSON.stringify({ id: "job-1", status: "completed", utterances: [] }), { status: 200 });
  } });
  let savedJob: string | undefined;
  await adapter.create({ audioUrl: "https://controlled.invalid/audio", operationIdentity: "op-1", checkpoint: ({ remoteJobId }) => { savedJob = remoteJobId; } });
  assert.equal(savedJob, "job-1");
  const resumed = await adapter.poll(savedJob!);
  assert.equal(resumed.status, "completed");
  assert.equal(creates, 1);
  assert.equal(polls, 1);
});

test("AssemblyAI uploads protected bytes before create and sends the normative EU request", async () => {
  const calls: Array<{ url: string; body?: unknown; authorization?: string }> = [];
  const adapter = new DurableAssemblyAiAdapter({ apiKey: "server-secret", fetch: async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, authorization: new Headers(init?.headers).get("authorization") ?? undefined });
    if (url.endsWith("/v2/upload")) return Response.json({ upload_url: "https://cdn.assemblyai.invalid/private-upload" });
    return Response.json({ id: "job-protected-1", status: "queued" });
  } });
  let checkpoint: string | undefined;
  await adapter.create({ audioBytes: new Uint8Array([1, 2, 3]), operationIdentity: "protected-op", checkpoint: ({ remoteJobId }) => { checkpoint = remoteJobId; } });
  assert.equal(checkpoint, "job-protected-1");
  assert.deepEqual(calls.map((call) => call.url), ["https://api.eu.assemblyai.com/v2/upload", "https://api.eu.assemblyai.com/v2/transcript"]);
  assert.deepEqual(calls[1].body, { audio_url: "https://cdn.assemblyai.invalid/private-upload", speech_models: ["universal-2"], language_code: "ru", speaker_labels: true, punctuate: true, format_text: true });
  assert.ok(calls.every((call) => call.authorization === "server-secret"));
  assert.doesNotMatch(JSON.stringify(calls.map((call) => ({ url: call.url, body: call.body }))), /server-secret/);
});

test("Telegram outbox does not repeat SENT delivery and isolates recipient failures", async () => {
  let requests = 0;
  const outbox = new TelegramOutbox({ token: "secret", recipients: { first: "1", second: "2" }, fetch: async (_input, init) => {
    requests += 1;
    const body = JSON.parse(String(init?.body)) as { chat_id: string };
    return body.chat_id === "1" ? new Response(JSON.stringify({ result: { message_id: 7 } }), { status: 200 }) : new Response("unavailable", { status: 503 });
  } });
  outbox.enqueue("ready:candidate-1:v0001", ["first", "second"]);
  assert.equal((await outbox.send("ready:candidate-1:v0001", "first", "готово")).state, "SENT");
  assert.equal((await outbox.send("ready:candidate-1:v0001", "second", "готово")).state, "FAILED");
  assert.equal((await outbox.send("ready:candidate-1:v0001", "first", "готово")).attempts, 1);
  assert.equal(requests, 2);
});
