import { createHash } from "node:crypto";
import type { CandidateFolder } from "./discovery.ts";
import type { DriveObject } from "./types.ts";
import { DRIVE_LARGE_DOWNLOAD_TIMEOUT_MS } from "../google-drive-oauth/my-drive-adapter.ts";

export type AccessTokenProvider = () => Promise<string>;

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

export class GoogleMyDrivePipelineAdapter {
  private readonly options: {
      rootFolderId: string;
      accessToken: AccessTokenProvider;
      fetch?: typeof fetch;
  };

  constructor(options: {
    rootFolderId: string;
    accessToken: AccessTokenProvider;
    fetch?: typeof fetch;
  }) { this.options = options; }

  async listChildren(parentFolderId: string): Promise<DriveObject[]> {
    const fetcher = this.options.fetch ?? fetch;
    const token = await this.options.accessToken();
    const objects: DriveObject[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({
        q: `'${parentFolderId}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,version,parents)",
        pageSize: "1000",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: bearer(token), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`DRIVE_LIST_FAILED_${response.status}`);
      const page = await response.json() as { nextPageToken?: string; files?: Array<Record<string, unknown>> };
      for (const file of page.files ?? []) objects.push({
        fileId: String(file.id),
        parentFolderId,
        version: String(file.version ?? file.modifiedTime ?? "unknown"),
        name: String(file.name),
        mimeType: String(file.mimeType),
        size: Number(file.size ?? 0),
        modifiedTime: String(file.modifiedTime ?? ""),
        inResultsSubtree: String(file.name) === "Результаты" && String(file.mimeType) === "application/vnd.google-apps.folder",
      });
      pageToken = page.nextPageToken;
    } while (pageToken);
    return objects;
  }

  async listCandidateFolders(): Promise<CandidateFolder[]> {
    const folderMime = "application/vnd.google-apps.folder";
    const vacancies = (await this.listChildren(this.options.rootFolderId)).filter((item) => item.mimeType === folderMime);
    const result: CandidateFolder[] = [];
    for (const vacancy of vacancies) {
      const candidates = (await this.listChildren(vacancy.fileId)).filter((item) => item.mimeType === folderMime && item.name !== "Результаты");
      for (const candidate of candidates) result.push({ folderId: candidate.fileId, vacancyFolderId: vacancy.fileId, displayName: candidate.name, parentPath: `Найм/${vacancy.name}/${candidate.name}` });
    }
    return result;
  }

  async downloadFile(fileId: string) {
    const fetcher = this.options.fetch ?? fetch;
    const token = await this.options.accessToken();
    const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: bearer(token), signal: AbortSignal.timeout(DRIVE_LARGE_DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`DRIVE_DOWNLOAD_FAILED_${response.status}`);
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
    const fetcher = this.options.fetch ?? fetch;
    const token = await this.options.accessToken();
    const metadataResponse = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?fields=id,version,modifiedTime,size`, { headers: bearer(token), signal: AbortSignal.timeout(15_000) });
    if (!metadataResponse.ok) throw new Error(`DRIVE_METADATA_FAILED_${metadataResponse.status}`);
    const metadata = await metadataResponse.json() as { id?: string; version?: string; modifiedTime?: string; size?: string };
    const version = String(metadata.version ?? metadata.modifiedTime ?? "unknown");
    const providerRevisionChanged = version !== input.expectedVersion;
    if (providerRevisionChanged) {
      const sameStableMetadata = input.expectedSize !== undefined
        && Number(metadata.size) === input.expectedSize
        && Boolean(input.expectedModifiedTime)
        && metadata.modifiedTime === input.expectedModifiedTime;
      if (!sameStableMetadata) throw new Error("DRIVE_FILE_VERSION_CHANGED");
    }
    const bytes = await this.downloadFile(input.fileId);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (input.expectedChecksum && checksum !== input.expectedChecksum) throw new Error("DRIVE_FILE_CONTENT_CHANGED");
    await input.checkpoint({ fileId: input.fileId, version, checksum });
    return { bytes, checksum, version };
  }

  async createFolder(name: string, parentFolderId: string, operationIdentity: string) {
    const fetcher = this.options.fetch ?? fetch;
    const token = await this.options.accessToken();
    const response = await fetcher("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentFolderId], appProperties: { operationIdentity } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`DRIVE_CREATE_FOLDER_FAILED_${response.status}`);
    return response.json() as Promise<{ id: string }>;
  }

  async findByOperationIdentity(parentFolderId: string, operationIdentity: string) {
    const fetcher = this.options.fetch ?? fetch;
    const token = await this.options.accessToken();
    const escaped = operationIdentity.replace(/['\\]/g, (value) => `\\${value}`);
    const query = new URLSearchParams({ q: `'${parentFolderId}' in parents and trashed = false and appProperties has { key='operationIdentity' and value='${escaped}' }`, fields: "files(id,name,mimeType,size,appProperties)", pageSize: "2" });
    const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: bearer(token), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`DRIVE_RECONCILE_FAILED_${response.status}`);
    const body = await response.json() as { files?: Array<{ id: string; name: string; mimeType: string; size?: string; appProperties?: Record<string, string> }> };
    if ((body.files?.length ?? 0) > 1) throw new Error("DRIVE_OPERATION_IDENTITY_CONFLICT");
    return body.files?.[0];
  }

  async ensureFolder(input: { name: string; parentFolderId: string; operationIdentity: string }) {
    const existing = await this.findByOperationIdentity(input.parentFolderId, input.operationIdentity);
    if (existing) {
      if (existing.mimeType !== "application/vnd.google-apps.folder") throw new Error("DRIVE_OPERATION_IDENTITY_CONFLICT");
      return { id: existing.id, reused: true };
    }
    try { const created = await this.createFolder(input.name, input.parentFolderId, input.operationIdentity); return { id: created.id, reused: false }; }
    catch (error) {
      const reconciled = await this.findByOperationIdentity(input.parentFolderId, input.operationIdentity);
      if (reconciled?.mimeType === "application/vnd.google-apps.folder") return { id: reconciled.id, reused: true };
      throw error;
    }
  }

  async publishPdf(input: { parentFolderId: string; fileName: string; bytes: Uint8Array; checksum: string; operationIdentity: string }) {
    const existing = await this.findByOperationIdentity(input.parentFolderId, input.operationIdentity);
    if (existing) {
      if (existing.appProperties?.checksum !== input.checksum) throw new Error("REPORT_VERSION_CONFLICT");
      return { id: existing.id, checksum: input.checksum, reused: true };
    }
    const fetcher = this.options.fetch ?? fetch;
    const token = await this.options.accessToken();
    const boundary = `candidate-report-${createHash("sha256").update(input.operationIdentity).digest("hex").slice(0, 24)}`;
    const metadata = JSON.stringify({ name: input.fileName, parents: [input.parentFolderId], mimeType: "application/pdf", appProperties: { operationIdentity: input.operationIdentity, checksum: input.checksum } });
    const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
    const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(prefix.length + input.bytes.length + suffix.length); body.set(prefix); body.set(input.bytes, prefix.length); body.set(suffix, prefix.length + input.bytes.length);
    try {
      const response = await fetcher("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,appProperties", { method: "POST", headers: { ...bearer(token), "content-type": `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`DRIVE_UPLOAD_FAILED_${response.status}`);
      const created = await response.json() as { id?: string };
      if (!created.id) throw new Error("DRIVE_UPLOAD_MISSING_FILE_ID");
      return { id: created.id, checksum: input.checksum, reused: false };
    } catch (error) {
      const reconciled = await this.findByOperationIdentity(input.parentFolderId, input.operationIdentity);
      if (reconciled?.appProperties?.checksum === input.checksum) return { id: reconciled.id, checksum: input.checksum, reused: true };
      throw error;
    }
  }
}

export type RemoteJobCheckpoint = (checkpoint: { remoteJobId: string; operationIdentity: string }) => Promise<void> | void;

export class DurableAssemblyAiAdapter {
  private readonly options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch };

  constructor(options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) { this.options = options; }

  async create(input: { audioUrl?: string; audioBytes?: Uint8Array; operationIdentity: string; checkpoint: RemoteJobCheckpoint }) {
    const fetcher = this.options.fetch ?? fetch;
    const baseUrl = this.options.baseUrl ?? "https://api.eu.assemblyai.com";
    let audioUrl = input.audioUrl;
    if (input.audioBytes) {
      const upload = await fetcher(`${baseUrl}/v2/upload`, {
        method: "POST",
        headers: { authorization: this.options.apiKey, "content-type": "application/octet-stream" },
        body: input.audioBytes.slice().buffer as ArrayBuffer,
        signal: AbortSignal.timeout(5 * 60_000),
      });
      if (!upload.ok) throw new Error(`ASSEMBLYAI_UPLOAD_FAILED_${upload.status}`);
      const result = await upload.json() as { upload_url?: string };
      audioUrl = result.upload_url;
    }
    if (!audioUrl) throw new Error("ASSEMBLYAI_AUDIO_INPUT_MISSING");
    const response = await fetcher(`${baseUrl}/v2/transcript`, {
      method: "POST",
      headers: { authorization: this.options.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, speech_models: ["universal-2"], language_code: "ru", speaker_labels: true, punctuate: true, format_text: true }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ASSEMBLYAI_CREATE_FAILED_${response.status}`);
    const job = await response.json() as { id?: string; status?: string };
    if (!job.id) throw new Error("ASSEMBLYAI_CREATE_MISSING_JOB_ID");
    await input.checkpoint({ remoteJobId: job.id, operationIdentity: input.operationIdentity });
    return { remoteJobId: job.id, status: job.status ?? "queued" };
  }

  async poll(remoteJobId: string) {
    const fetcher = this.options.fetch ?? fetch;
    const baseUrl = this.options.baseUrl ?? "https://api.eu.assemblyai.com";
    const response = await fetcher(`${baseUrl}/v2/transcript/${encodeURIComponent(remoteJobId)}`, { headers: { authorization: this.options.apiKey }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`ASSEMBLYAI_POLL_FAILED_${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  }

  async remove(remoteJobId: string) {
    const fetcher = this.options.fetch ?? fetch;
    const baseUrl = this.options.baseUrl ?? "https://api.eu.assemblyai.com";
    const response = await fetcher(`${baseUrl}/v2/transcript/${encodeURIComponent(remoteJobId)}`, { method: "DELETE", headers: { authorization: this.options.apiKey }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok && response.status !== 404) throw new Error(`ASSEMBLYAI_DELETE_FAILED_${response.status}`);
  }
}

export type TelegramDelivery = {
  logicalKey: string;
  recipientRef: string;
  state: "PENDING" | "SENDING" | "SENT" | "FAILED" | "WAITING_CONFIGURATION";
  attempts: number;
  messageId?: string;
};

export class TelegramOutbox {
  private readonly deliveries = new Map<string, TelegramDelivery>();
  private readonly options: { token?: string; recipients: Readonly<Record<string, string>>; fetch?: typeof fetch };

  constructor(options: { token?: string; recipients: Readonly<Record<string, string>>; fetch?: typeof fetch }) { this.options = options; }

  enqueue(logicalKey: string, recipientRefs: readonly string[]) {
    return recipientRefs.map((recipientRef) => {
      const identity = `${logicalKey}:${recipientRef}`;
      const current = this.deliveries.get(identity);
      if (current) return structuredClone(current);
      const delivery: TelegramDelivery = { logicalKey, recipientRef, state: this.options.token && this.options.recipients[recipientRef] ? "PENDING" : "WAITING_CONFIGURATION", attempts: 0 };
      this.deliveries.set(identity, delivery);
      return structuredClone(delivery);
    });
  }

  async send(logicalKey: string, recipientRef: string, text: string) {
    const identity = `${logicalKey}:${recipientRef}`;
    const delivery = this.deliveries.get(identity);
    if (!delivery) throw new Error("TELEGRAM_DELIVERY_NOT_FOUND");
    if (delivery.state === "SENT") return structuredClone(delivery);
    const chatId = this.options.recipients[recipientRef];
    if (!this.options.token || !chatId) return structuredClone(delivery);
    delivery.state = "SENDING";
    delivery.attempts += 1;
    const fetcher = this.options.fetch ?? fetch;
    const response = await fetcher(`https://api.telegram.org/bot${this.options.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      delivery.state = "FAILED";
      return structuredClone(delivery);
    }
    const body = await response.json() as { result?: { message_id?: number } };
    delivery.state = "SENT";
    delivery.messageId = body.result?.message_id === undefined ? undefined : String(body.result.message_id);
    return structuredClone(delivery);
  }

  safeIdentity(delivery: TelegramDelivery) {
    return createHash("sha256").update(`${delivery.logicalKey}:${delivery.recipientRef}`).digest("hex").slice(0, 16);
  }
}
