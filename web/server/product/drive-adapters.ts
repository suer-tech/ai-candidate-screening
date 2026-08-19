import { env } from "cloudflare:workers";
import type { ResultArtifactGateway, VacancyFolderGateway } from "./application.ts";

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured`);
  return normalized;
}

function headers(token: string | undefined, extra: HeadersInit = {}) {
  return { ...extra, ...(token?.trim() ? { authorization: `Bearer ${token.trim()}` } : {}) };
}

export class DriveVacancyFolderGateway implements VacancyFolderGateway {
  async ensureVacancyFolder(input: { operationId: string; vacancyId: string; title: string }) {
    const response = await fetch(required(env.GOOGLE_DRIVE_VACANCY_FOLDER_URL, "GOOGLE_DRIVE_VACANCY_FOLDER_URL"), {
      method: "POST",
      headers: headers(env.GOOGLE_DRIVE_VACANCY_FOLDER_TOKEN, {
        "content-type": "application/json",
        "idempotency-key": input.operationId,
      }),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Google Drive folder provisioning failed (${response.status})`);
    const payload = await response.json() as { folderId?: unknown };
    if (typeof payload.folderId !== "string" || !payload.folderId.trim()) {
      throw new Error("Google Drive folder provisioning returned no folder ID");
    }
    return payload.folderId.trim();
  }
}

export class DriveResultArtifactGateway implements ResultArtifactGateway {
  async readPdf(storageId: string) {
    const response = await fetch(required(env.GOOGLE_DRIVE_RESULT_PDF_URL, "GOOGLE_DRIVE_RESULT_PDF_URL"), {
      method: "POST",
      headers: headers(env.GOOGLE_DRIVE_RESULT_PDF_TOKEN, { "content-type": "application/json" }),
      body: JSON.stringify({ storageId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0] !== "application/pdf") {
      throw new Error(`Google Drive PDF read failed (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
