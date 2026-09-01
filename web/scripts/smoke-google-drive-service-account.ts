import { createHash, createSign, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type ServiceAccountKey = {
  type?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

type CheckName =
  | "token"
  | "root-metadata"
  | "list"
  | "create-folder"
  | "upload"
  | "reconcile"
  | "download"
  | "cleanup";

const runtimeDirectory = resolve(process.cwd(), ".runtime");
const credentialFile = resolve(runtimeDirectory, "service-account-smoke.json");
const rootFolderFile = resolve(runtimeDirectory, "service-account-smoke-root-folder-id");
const evidenceFile = resolve(runtimeDirectory, "evidence", "google-drive-service-account-smoke.json");
const consent = process.env.GOOGLE_DRIVE_EFFECTFUL_SMOKE_CONSENT === "1";
const scope = "https://www.googleapis.com/auth/drive";
const folderMimeType = "application/vnd.google-apps.folder";
const checks = new Map<CheckName, boolean>();
let storageMode: "shared-drive" | "shared-my-drive-folder" | "unknown" = "unknown";
let createdFolderId: string | undefined;
let createdFileId: string | undefined;

function base64Url(value: string | Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.replace(/[A-Za-z0-9_-]{30,}/g, "[redacted]");
  return "GOOGLE_DRIVE_SERVICE_ACCOUNT_SMOKE_FAILED";
}

async function googleJson<T>(response: Response, operation: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  let reason = "unknown";
  try {
    const body = await response.json() as { error?: { errors?: Array<{ reason?: string }>; status?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? reason;
  } catch {
    // Never include a raw provider body in smoke output.
  }
  throw new Error(`${operation}_HTTP_${response.status}:${reason}`);
}

async function accessToken(key: Required<Pick<ServiceAccountKey, "client_email" | "private_key" | "token_uri">>) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: key.client_email,
    scope,
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  const assertion = `${header}.${claims}.${base64Url(signer.sign(key.private_key))}`;
  const response = await fetch(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await googleJson<{ access_token?: string }>(response, "TOKEN");
  if (!result.access_token) throw new Error("TOKEN_ACCESS_TOKEN_MISSING");
  return result.access_token;
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function remove(token: string, fileId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: authorization(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`CLEANUP_HTTP_${response.status}`);
}

async function writeEvidence(input: { outcome: "GREEN" | "RED"; error?: string }) {
  await mkdir(resolve(runtimeDirectory, "evidence"), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify({
    schemaVersion: "google-drive-service-account-smoke/v1",
    capturedAtUtc: new Date().toISOString(),
    providerMode: "real",
    productionLikeAcceptanceClaimed: false,
    containsCredentials: false,
    destructiveScope: "smoke-created-objects-only",
    storageMode,
    outcome: input.outcome,
    checks: Object.fromEntries(checks),
    ...(input.error ? { error: input.error } : {}),
  }, null, 2)}\n`, "utf8");
}

if (!consent) throw new Error("GOOGLE_DRIVE_EFFECTFUL_SMOKE_CONSENT_REQUIRED");
const rootFolderId = (await readFile(rootFolderFile, "utf8")).trim();
if (!rootFolderId) throw new Error("GOOGLE_DRIVE_SMOKE_ROOT_FOLDER_ID_MISSING");

const parsed = JSON.parse(await readFile(credentialFile, "utf8")) as ServiceAccountKey;
if (parsed.type !== "service_account" || !parsed.client_email || !parsed.private_key || !parsed.token_uri) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_SMOKE_CREDENTIAL_INVALID");
}

let token: string | undefined;
try {
  token = await accessToken({ client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri });
  checks.set("token", true);

  const root = await googleJson<{ mimeType?: string; driveId?: string; capabilities?: { canAddChildren?: boolean } }>(
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootFolderId)}?fields=mimeType,driveId,capabilities(canAddChildren)&supportsAllDrives=true`, {
      headers: authorization(token),
      signal: AbortSignal.timeout(30_000),
    }),
    "ROOT_METADATA",
  );
  if (root.mimeType !== folderMimeType) throw new Error("ROOT_NOT_FOLDER");
  if (root.capabilities?.canAddChildren !== true) throw new Error("ROOT_CANNOT_ADD_CHILDREN");
  storageMode = root.driveId ? "shared-drive" : "shared-my-drive-folder";
  checks.set("root-metadata", true);

  const listQuery = new URLSearchParams({
    q: `'${rootFolderId.replace(/[\\']/g, (value) => `\\${value}`)}' in parents and trashed = false`,
    fields: "files(id)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  await googleJson(await fetch(`https://www.googleapis.com/drive/v3/files?${listQuery}`, {
    headers: authorization(token),
    signal: AbortSignal.timeout(30_000),
  }), "LIST");
  checks.set("list", true);

  const operationIdentity = `hh-agent-service-account-smoke:${randomUUID()}`;
  const createdFolder = await googleJson<{ id?: string }>(await fetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
    method: "POST",
    headers: { ...authorization(token), "content-type": "application/json" },
    body: JSON.stringify({
      name: `.hh-agent-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      mimeType: folderMimeType,
      parents: [rootFolderId],
      appProperties: { operationIdentity },
    }),
    signal: AbortSignal.timeout(30_000),
  }), "CREATE_FOLDER");
  if (!createdFolder.id) throw new Error("CREATE_FOLDER_ID_MISSING");
  createdFolderId = createdFolder.id;
  checks.set("create-folder", true);

  const bytes = new TextEncoder().encode("%PDF-1.4\n% HH Agent service-account smoke fixture\n%%EOF\n");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const boundary = `hh-agent-${randomUUID()}`;
  const metadata = JSON.stringify({
    name: "candidate-report-smoke.pdf",
    mimeType: "application/pdf",
    parents: [createdFolderId],
    appProperties: { operationIdentity: `${operationIdentity}:report`, checksum },
  });
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const multipart = new Uint8Array(prefix.length + bytes.length + suffix.length);
  multipart.set(prefix);
  multipart.set(bytes, prefix.length);
  multipart.set(suffix, prefix.length + bytes.length);
  const uploaded = await googleJson<{ id?: string }>(await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true", {
    method: "POST",
    headers: { ...authorization(token), "content-type": `multipart/related; boundary=${boundary}` },
    body: multipart,
    signal: AbortSignal.timeout(60_000),
  }), "UPLOAD");
  if (!uploaded.id) throw new Error("UPLOAD_ID_MISSING");
  createdFileId = uploaded.id;
  checks.set("upload", true);

  const reconcileQuery = new URLSearchParams({
    q: `'${createdFolderId.replace(/[\\']/g, (value) => `\\${value}`)}' in parents and trashed = false and appProperties has { key='operationIdentity' and value='${operationIdentity}:report' }`,
    fields: "files(id,appProperties)",
    pageSize: "2",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const reconciled = await googleJson<{ files?: Array<{ appProperties?: Record<string, string> }> }>(await fetch(`https://www.googleapis.com/drive/v3/files?${reconcileQuery}`, {
    headers: authorization(token),
    signal: AbortSignal.timeout(30_000),
  }), "RECONCILE");
  if (reconciled.files?.length !== 1 || reconciled.files[0]?.appProperties?.checksum !== checksum) throw new Error("RECONCILE_MISMATCH");
  checks.set("reconcile", true);

  const downloaded = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(createdFileId)}?alt=media&supportsAllDrives=true`, {
    headers: authorization(token),
    signal: AbortSignal.timeout(60_000),
  });
  if (!downloaded.ok) throw new Error(`DOWNLOAD_HTTP_${downloaded.status}`);
  const downloadedChecksum = createHash("sha256").update(new Uint8Array(await downloaded.arrayBuffer())).digest("hex");
  if (downloadedChecksum !== checksum) throw new Error("DOWNLOAD_CHECKSUM_MISMATCH");
  checks.set("download", true);

  await remove(token, createdFileId);
  createdFileId = undefined;
  await remove(token, createdFolderId);
  createdFolderId = undefined;
  checks.set("cleanup", true);
  await writeEvidence({ outcome: "GREEN" });
  console.log(`Google Drive service-account smoke: GREEN (${storageMode}).`);
  console.log("Проверено: token, metadata, list, folder create, PDF upload, reconcile, download и cleanup.");
  console.log("Credentials, email и Google Drive IDs не выводились.");
} catch (error) {
  const primaryError = safeError(error);
  if (token) {
    try {
      if (createdFileId) await remove(token, createdFileId);
      if (createdFolderId) await remove(token, createdFolderId);
      checks.set("cleanup", true);
    } catch {
      checks.set("cleanup", false);
    }
  }
  await writeEvidence({ outcome: "RED", error: primaryError });
  throw new Error(primaryError);
}
