import { createHash } from "node:crypto";
import type { CandidateFolder } from "../candidate-pipeline/discovery.ts";
import type { DriveObject } from "../candidate-pipeline/types.ts";
import { GoogleDriveOAuthError, type GoogleDriveOAuthRepository, type RegisteredDriveObject } from "./types.ts";

export type AccessTokenProvider = () => Promise<string>;

export interface GoogleDrivePort {
  listChildren(parentFolderId: string): Promise<DriveObject[]>;
  listCandidateFolders(): Promise<CandidateFolder[]>;
  downloadFile(fileId: string): Promise<Uint8Array>;
  ensureFolder(input: { name: string; parentFolderId: string; operationIdentity: string }): Promise<{ id: string; reused: boolean }>;
  putFile(input: { parentFolderId: string; fileName: string; mimeType: string; bytes: Uint8Array; checksum: string; operationIdentity: string }): Promise<{ id: string; checksum: string; reused: boolean }>;
  publishPdf(input: { parentFolderId: string; fileName: string; bytes: Uint8Array; checksum: string; operationIdentity: string }): Promise<{ id: string; checksum: string; reused: boolean }>;
  removeCreatedObject(input: { fileId: string; operationIdentity: string }): Promise<void>;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const folderMime = "application/vnd.google-apps.folder";
const escapeQuery = (value: string) => value.replace(/[\\']/g, (character) => `\\${character}`);
export const DRIVE_LARGE_DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
export const DRIVE_RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024;

async function responseJson<T>(response: Response, code: string) {
  if (!response.ok) throw new GoogleDriveOAuthError(`${code}_${response.status}`, response.status === 429 || response.status >= 500);
  return response.json() as Promise<T>;
}

export async function ensurePersonalDriveRoot(input: { accessToken: string; operationIdentity: string; fetch?: typeof fetch }) {
  const fetcher = input.fetch ?? fetch;
  const query = new URLSearchParams({
    q: `'root' in parents and trashed = false and mimeType = '${folderMime}' and appProperties has { key='operationIdentity' and value='${escapeQuery(input.operationIdentity)}' }`,
    spaces: "drive", fields: "files(id,name,mimeType,appProperties)", pageSize: "2",
  });
  const list = await responseJson<{ files?: Array<{ id: string; name: string; mimeType: string }> }>(
    await fetcher(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: bearer(input.accessToken), signal: AbortSignal.timeout(15_000) }),
    "DRIVE_ROOT_LIST_FAILED",
  );
  if ((list.files?.length ?? 0) > 1) throw new GoogleDriveOAuthError("DRIVE_ROOT_IDENTITY_CONFLICT");
  if (list.files?.[0]) return { id: list.files[0].id, name: list.files[0].name };
  const created = await responseJson<{ id?: string; name?: string }>(await fetcher("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST", headers: { ...bearer(input.accessToken), "content-type": "application/json" },
    body: JSON.stringify({ name: "Найм", mimeType: folderMime, parents: ["root"], appProperties: { operationIdentity: input.operationIdentity } }),
    signal: AbortSignal.timeout(30_000),
  }), "DRIVE_ROOT_CREATE_FAILED");
  if (!created.id) throw new GoogleDriveOAuthError("DRIVE_ROOT_CREATE_MISSING_ID");
  return { id: created.id, name: created.name ?? "Найм" };
}

export class GoogleMyDriveAdapter implements GoogleDrivePort {
  private readonly options: { connectionId: string; rootFolderId: string; repository: GoogleDriveOAuthRepository;
    accessToken: AccessTokenProvider; fetch?: typeof fetch; clock?: () => Date };

  constructor(options: GoogleMyDriveAdapter["options"]) { this.options = options; }

  private now() { return (this.options.clock?.() ?? new Date()).toISOString(); }
  private fetcher() { return this.options.fetch ?? fetch; }

  private async assertAllowed(fileId: string) {
    if (!await this.options.repository.isRegisteredDescendant(this.options.connectionId, fileId, this.options.rootFolderId)) {
      throw new GoogleDriveOAuthError("GOOGLE_DRIVE_ROOT_GRANT_DENIED");
    }
  }

  private async register(value: Omit<RegisteredDriveObject, "connectionId" | "discoveredAt">) {
    await this.options.repository.registerObject({ ...value, connectionId: this.options.connectionId, discoveredAt: this.now() });
  }

  async listChildren(parentFolderId: string) {
    await this.assertAllowed(parentFolderId);
    const token = await this.options.accessToken();
    const objects: DriveObject[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ q: `'${escapeQuery(parentFolderId)}' in parents and trashed = false`, spaces: "drive",
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,version,parents,appProperties)", pageSize: "1000" });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await responseJson<{ nextPageToken?: string; files?: Array<Record<string, unknown>> }>(
        await this.fetcher()(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: bearer(token), signal: AbortSignal.timeout(15_000) }), "DRIVE_LIST_FAILED");
      for (const file of page.files ?? []) {
        const object: DriveObject = { fileId: String(file.id), parentFolderId, version: String(file.version ?? file.modifiedTime ?? "unknown"),
          name: String(file.name), mimeType: String(file.mimeType), size: Number(file.size ?? 0), modifiedTime: String(file.modifiedTime ?? ""),
          inResultsSubtree: String(file.name) === "Результаты" && String(file.mimeType) === folderMime };
        objects.push(object);
        const properties = file.appProperties && typeof file.appProperties === "object" ? file.appProperties as Record<string, unknown> : undefined;
        const operationIdentity = typeof properties?.operationIdentity === "string" ? properties.operationIdentity : undefined;
        const operationOwned = operationIdentity ? await this.options.repository.findByOperationIdentity(this.options.connectionId, operationIdentity) : null;
        await this.register({ fileId: object.fileId, parentId: parentFolderId, kind: operationOwned?.fileId === object.fileId ? operationOwned.kind : object.mimeType === folderMime ? "folder" : "file", name: object.name,
          operationIdentity,
          checksum: typeof properties?.checksum === "string" ? properties.checksum : undefined });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return objects;
  }

  async listCandidateFolders() {
    const vacancies = (await this.listChildren(this.options.rootFolderId)).filter((item) => item.mimeType === folderMime);
    const result: CandidateFolder[] = [];
    for (const vacancy of vacancies) {
      const candidates = (await this.listChildren(vacancy.fileId)).filter((item) => item.mimeType === folderMime && item.name !== "Результаты");
      for (const candidate of candidates) result.push({ folderId: candidate.fileId, vacancyFolderId: vacancy.fileId, displayName: candidate.name, parentPath: `Найм/${vacancy.name}/${candidate.name}` });
    }
    return result;
  }

  async downloadFile(fileId: string) {
    await this.assertAllowed(fileId);
    const token = await this.options.accessToken();
    const response = await this.fetcher()(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: bearer(token), signal: AbortSignal.timeout(DRIVE_LARGE_DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new GoogleDriveOAuthError(`DRIVE_DOWNLOAD_FAILED_${response.status}`, response.status === 429 || response.status >= 500);
    return new Uint8Array(await response.arrayBuffer());
  }

  async downloadVersion(input: {
    fileId: string;
    expectedVersion: string;
    expectedSize?: number;
    expectedModifiedTime?: string;
    expectedChecksum?: string;
    checkpoint: (value: { fileId: string; version: string; checksum: string }) => Promise<void> | void;
  }) {
    await this.assertAllowed(input.fileId);
    const token = await this.options.accessToken();
    const metadata = await responseJson<{ version?: string; modifiedTime?: string; size?: string }>(
      await this.fetcher()(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?fields=id,version,modifiedTime,size`, { headers: bearer(token), signal: AbortSignal.timeout(15_000) }),
      "DRIVE_METADATA_FAILED",
    );
    const version = String(metadata.version ?? metadata.modifiedTime ?? "unknown");
    if (version !== input.expectedVersion) {
      const sameStableMetadata = input.expectedSize !== undefined
        && Number(metadata.size) === input.expectedSize
        && Boolean(input.expectedModifiedTime)
        && metadata.modifiedTime === input.expectedModifiedTime;
      if (!sameStableMetadata) throw new GoogleDriveOAuthError("DRIVE_FILE_VERSION_CHANGED");
    }
    const bytes = await this.downloadFile(input.fileId);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (input.expectedChecksum && checksum !== input.expectedChecksum) throw new GoogleDriveOAuthError("DRIVE_FILE_CONTENT_CHANGED");
    await input.checkpoint({ fileId: input.fileId, version, checksum });
    return { bytes, checksum, version };
  }

  private async findRemoteByOperationIdentity(parentFolderId: string, operationIdentity: string) {
    await this.assertAllowed(parentFolderId);
    const registered = await this.options.repository.findByOperationIdentity(this.options.connectionId, operationIdentity);
    if (registered) return { id: registered.fileId, name: registered.name, mimeType: registered.kind === "folder" ? folderMime : "application/pdf", appProperties: { operationIdentity, ...(registered.checksum ? { checksum: registered.checksum } : {}) } };
    const token = await this.options.accessToken();
    const query = new URLSearchParams({ q: `'${escapeQuery(parentFolderId)}' in parents and trashed = false and appProperties has { key='operationIdentity' and value='${escapeQuery(operationIdentity)}' }`,
      spaces: "drive", fields: "files(id,name,mimeType,size,appProperties)", pageSize: "2" });
    const body = await responseJson<{ files?: Array<{ id: string; name: string; mimeType: string; appProperties?: Record<string, string> }> }>(
      await this.fetcher()(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: bearer(token), signal: AbortSignal.timeout(15_000) }), "DRIVE_RECONCILE_FAILED");
    if ((body.files?.length ?? 0) > 1) throw new GoogleDriveOAuthError("DRIVE_OPERATION_IDENTITY_CONFLICT");
    return body.files?.[0];
  }

  async ensureFolder(input: { name: string; parentFolderId: string; operationIdentity: string }) {
    const existing = await this.findRemoteByOperationIdentity(input.parentFolderId, input.operationIdentity);
    if (existing) {
      if (existing.mimeType !== folderMime) throw new GoogleDriveOAuthError("DRIVE_OPERATION_IDENTITY_CONFLICT");
      await this.register({ fileId: existing.id, parentId: input.parentFolderId, kind: "folder", name: existing.name, operationIdentity: input.operationIdentity });
      return { id: existing.id, reused: true };
    }
    const token = await this.options.accessToken();
    try {
      const created = await responseJson<{ id?: string }>(await this.fetcher()("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({ name: input.name, mimeType: folderMime,
          parents: [input.parentFolderId], appProperties: { operationIdentity: input.operationIdentity } }), signal: AbortSignal.timeout(30_000),
      }), "DRIVE_CREATE_FOLDER_FAILED");
      if (!created.id) throw new GoogleDriveOAuthError("DRIVE_CREATE_FOLDER_MISSING_ID");
      await this.register({ fileId: created.id, parentId: input.parentFolderId, kind: "folder", name: input.name, operationIdentity: input.operationIdentity });
      return { id: created.id, reused: false };
    } catch (error) {
      const reconciled = await this.findRemoteByOperationIdentity(input.parentFolderId, input.operationIdentity);
      if (reconciled?.mimeType === folderMime) {
        await this.register({ fileId: reconciled.id, parentId: input.parentFolderId, kind: "folder", name: reconciled.name, operationIdentity: input.operationIdentity });
        return { id: reconciled.id, reused: true };
      }
      throw error;
    }
  }

  async putFile(input: { parentFolderId: string; fileName: string; mimeType: string; bytes: Uint8Array; checksum: string; operationIdentity: string }) {
    const existing = await this.findRemoteByOperationIdentity(input.parentFolderId, input.operationIdentity);
    if (existing) {
      if (existing.appProperties?.checksum !== input.checksum) throw new GoogleDriveOAuthError("REPORT_VERSION_CONFLICT");
      await this.register({ fileId: existing.id, parentId: input.parentFolderId, kind: "derived", name: existing.name, operationIdentity: input.operationIdentity, checksum: input.checksum });
      return { id: existing.id, checksum: input.checksum, reused: true };
    }
    const token = await this.options.accessToken();
    const metadata = JSON.stringify({ name: input.fileName, parents: [input.parentFolderId], mimeType: input.mimeType, appProperties: { operationIdentity: input.operationIdentity, checksum: input.checksum } });
    try {
      let created: { id?: string } | undefined;
      if (input.bytes.byteLength > 8 * 1024 * 1024) {
        const session = await this.fetcher()("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,appProperties", {
          method: "POST", headers: { ...bearer(token), "content-type": "application/json; charset=UTF-8", "x-upload-content-type": input.mimeType,
            "x-upload-content-length": String(input.bytes.byteLength) }, body: metadata, signal: AbortSignal.timeout(30_000),
        });
        if (!session.ok) throw new GoogleDriveOAuthError(`DRIVE_UPLOAD_SESSION_FAILED_${session.status}`, session.status === 429 || session.status >= 500);
        const location = session.headers.get("location");
        if (!location?.startsWith("https://www.googleapis.com/")) throw new GoogleDriveOAuthError("DRIVE_UPLOAD_SESSION_LOCATION_INVALID");
        for (let offset = 0; offset < input.bytes.byteLength; offset += DRIVE_RESUMABLE_CHUNK_BYTES) {
          const end = Math.min(offset + DRIVE_RESUMABLE_CHUNK_BYTES, input.bytes.byteLength) - 1;
          const chunk = input.bytes.slice(offset, end + 1);
          const response = await this.fetcher()(location, { method: "PUT", headers: { ...bearer(token), "content-type": input.mimeType,
            "content-length": String(chunk.byteLength), "content-range": `bytes ${offset}-${end}/${input.bytes.byteLength}` },
          body: chunk.buffer as ArrayBuffer, signal: AbortSignal.timeout(15 * 60_000) });
          if (end < input.bytes.byteLength - 1) {
            if (response.status !== 308) throw new GoogleDriveOAuthError(`DRIVE_UPLOAD_CHUNK_FAILED_${response.status}`, response.status === 429 || response.status >= 500);
          } else {
            created = await responseJson<{ id?: string }>(response, "DRIVE_UPLOAD_FAILED");
          }
        }
        if (!created) throw new GoogleDriveOAuthError("DRIVE_UPLOAD_INCOMPLETE");
      } else {
        const boundary = `candidate-report-${createHash("sha256").update(input.operationIdentity).digest("hex").slice(0, 24)}`;
        const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`);
        const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
        const body = new Uint8Array(prefix.length + input.bytes.length + suffix.length); body.set(prefix); body.set(input.bytes, prefix.length); body.set(suffix, prefix.length + input.bytes.length);
        created = await responseJson<{ id?: string }>(await this.fetcher()("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,appProperties", {
          method: "POST", headers: { ...bearer(token), "content-type": `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(60_000),
        }), "DRIVE_UPLOAD_FAILED");
      }
      if (!created?.id) throw new GoogleDriveOAuthError("DRIVE_UPLOAD_MISSING_FILE_ID");
      await this.register({ fileId: created.id, parentId: input.parentFolderId, kind: "derived", name: input.fileName, operationIdentity: input.operationIdentity, checksum: input.checksum });
      return { id: created.id, checksum: input.checksum, reused: false };
    } catch (error) {
      const reconciled = await this.findRemoteByOperationIdentity(input.parentFolderId, input.operationIdentity);
      if (reconciled?.appProperties?.checksum === input.checksum) {
        await this.register({ fileId: reconciled.id, parentId: input.parentFolderId, kind: "derived", name: reconciled.name, operationIdentity: input.operationIdentity, checksum: input.checksum });
        return { id: reconciled.id, checksum: input.checksum, reused: true };
      }
      throw error;
    }
  }

  async publishPdf(input: { parentFolderId: string; fileName: string; bytes: Uint8Array; checksum: string; operationIdentity: string }) {
    return this.putFile({ ...input, mimeType: "application/pdf" });
  }

  async removeCreatedObject(input: { fileId: string; operationIdentity: string }) {
    await this.assertAllowed(input.fileId);
    const registered = await this.options.repository.findByOperationIdentity(this.options.connectionId, input.operationIdentity);
    if (!registered || registered.fileId !== input.fileId || !["folder", "derived"].includes(registered.kind)) {
      throw new GoogleDriveOAuthError("GOOGLE_DRIVE_REGISTERED_OBJECT_SCOPE_MISMATCH");
    }
    const token = await this.options.accessToken();
    const response = await this.fetcher()(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}`, {
      method: "DELETE",
      headers: bearer(token),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new GoogleDriveOAuthError(`DRIVE_CLEANUP_FAILED_${response.status}`, response.status === 429 || response.status >= 500);
    }
    await this.options.repository.removeRegisteredObject(this.options.connectionId, input.fileId, input.operationIdentity);
  }
}
