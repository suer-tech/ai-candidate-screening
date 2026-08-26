import assert from "node:assert/strict";
import test from "node:test";
import { GoogleMyDrivePipelineAdapter } from "./providers.ts";

test("Drive publication reconciles timeout and reuses stable file identity", async () => {
  const files = new Map<string, { id: string; name: string; mimeType: string; appProperties: Record<string, string> }>();
  let uploads = 0;
  const adapter = new GoogleMyDrivePipelineAdapter({ rootFolderId: "root", accessToken: async () => "token", fetch: async (request, init) => {
    const url = String(request);
    if (url.includes("/upload/")) {
      uploads += 1;
      const body = new TextDecoder().decode(init?.body as Uint8Array);
      const operationIdentity = /"operationIdentity":"([^"]+)"/.exec(body)![1];
      const checksum = /"checksum":"([^"]+)"/.exec(body)![1];
      files.set(operationIdentity, { id: "file-stable-1", name: "result.pdf", mimeType: "application/pdf", appProperties: { operationIdentity, checksum } });
      throw new DOMException("timeout", "TimeoutError");
    }
    if (url.includes("/drive/v3/files?")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      const identity = /value='([^']+)'/.exec(q)?.[1];
      return new Response(JSON.stringify({ files: identity && files.has(identity) ? [files.get(identity)] : [] }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  } });
  const input = { parentFolderId: "version-folder", fileName: "Итоги.pdf", bytes: new Uint8Array([37, 80, 68, 70]), checksum: "checksum-1", operationIdentity: "candidate-1:v0001:result" };
  const first = await adapter.publishPdf(input);
  const repeated = await adapter.publishPdf(input);
  assert.equal(first.id, "file-stable-1"); assert.equal(first.reused, true); assert.equal(repeated.id, first.id); assert.equal(uploads, 1);
  await assert.rejects(() => adapter.publishPdf({ ...input, checksum: "different" }), /REPORT_VERSION_CONFLICT/);
});
