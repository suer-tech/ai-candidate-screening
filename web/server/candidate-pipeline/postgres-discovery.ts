import type { CandidateId, CandidateRecord, VacancyRecord } from "../../app/product-model.ts";
import { sha256 } from "./core.ts";
import type { CandidateFolder } from "./discovery.ts";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";

export type DurableRegistrationEvent = { type: "REGISTERED" | "UPDATED" | "SKIPPED_TOMBSTONE" | "SKIPPED_UNKNOWN_VACANCY"; folderId: string; candidateId?: CandidateId };

export class PostgresCandidateFolderRegistry {
  private readonly db: PostgresClient;
  constructor(db: PostgresClient) { this.db = db; }

  async listVacancies() {
    const vacancies = await this.db<{ record_json: string }[]>`SELECT record_json FROM vacancies`;
    return vacancies.map((row) => JSON.parse(row.record_json) as VacancyRecord);
  }

  async register(folders: readonly CandidateFolder[], nowUtc: string) {
    const vacancies = await this.listVacancies();
    const vacancyByFolder = new Map(vacancies.filter((vacancy) => vacancy.active && !vacancy.archived).map((vacancy) => [vacancy.driveFolderId, vacancy]));
    const events: DurableRegistrationEvent[] = [];
    for (const folder of folders) {
      const tombstone = await this.db`SELECT 1 FROM candidate_drive_folder_tombstones WHERE drive_folder_id=${folder.folderId}`;
      if (tombstone.length) { events.push({ type: "SKIPPED_TOMBSTONE", folderId: folder.folderId }); continue; }
      const currentRows = await this.db<{ candidate_id: number; public_id: string | null }[]>`SELECT f.candidate_id,c.public_id FROM candidate_drive_folders f JOIN candidates c ON c.id=f.candidate_id WHERE f.drive_folder_id=${folder.folderId}`; const current = currentRows[0];
      if (current) {
        const publicId = current.public_id ?? crypto.randomUUID();
        if (!current.public_id) await this.backfillPublicIdentity(current.candidate_id, publicId);
        await this.db`UPDATE candidate_drive_folders SET vacancy_folder_id=${folder.vacancyFolderId},display_name=${folder.displayName},parent_path=${folder.parentPath},last_seen_at_utc=${nowUtc} WHERE drive_folder_id=${folder.folderId}`;
        events.push({ type: "UPDATED", folderId: folder.folderId, candidateId: publicId });
        continue;
      }
      const vacancy = vacancyByFolder.get(folder.vacancyFolderId);
      if (!vacancy) { events.push({ type: "SKIPPED_UNKNOWN_VACANCY", folderId: folder.folderId }); continue; }
      const candidatePk = stableCandidateId(folder.folderId);
      const collisionRows = await this.db<{ record_json: string }[]>`SELECT record_json FROM candidates WHERE id=${candidatePk}`; const collision = collisionRows[0];
      if (collision && (JSON.parse(collision.record_json) as CandidateRecord & { driveFolderId?: string }).driveFolderId !== folder.folderId) throw new Error("CANDIDATE_DRIVE_FOLDER_ID_COLLISION");
      const candidateId = crypto.randomUUID();
      const candidate: CandidateRecord & { driveFolderId: string } = {
        id: candidateId,
        name: folder.displayName,
        initials: initials(folder.displayName),
        vacancyId: vacancy.id,
        vacancy: vacancy.title,
        status: "NEW",
        archived: false,
        stageStartedAt: nowUtc,
        elapsedMinutes: 0,
        etaMinutes: null,
        result: null,
        driveFolderId: folder.folderId,
      };
      const registered = await withTransaction(this.db, async (transaction) => {
        await transaction`INSERT INTO candidates (id,public_id,revision,record_json) VALUES (${candidatePk},${candidateId},1,${JSON.stringify(candidate)}) ON CONFLICT (id) DO NOTHING`;
        return transaction`INSERT INTO candidate_drive_folders (drive_folder_id,candidate_id,vacancy_folder_id,display_name,parent_path,first_seen_at_utc,last_seen_at_utc) VALUES (${folder.folderId},${candidatePk},${folder.vacancyFolderId},${folder.displayName},${folder.parentPath},${nowUtc},${nowUtc}) ON CONFLICT (drive_folder_id) DO NOTHING RETURNING drive_folder_id`;
      });
      if (!registered.length) {
        const racedRows = await this.db<{ candidate_id: number; public_id: string | null }[]>`SELECT f.candidate_id,c.public_id FROM candidate_drive_folders f JOIN candidates c ON c.id=f.candidate_id WHERE f.drive_folder_id=${folder.folderId}`; const raced = racedRows[0];
        if (!raced) throw new Error("CANDIDATE_DRIVE_FOLDER_REGISTRATION_FAILED");
        const publicId = raced.public_id ?? crypto.randomUUID();
        if (!raced.public_id) await this.backfillPublicIdentity(raced.candidate_id, publicId);
        events.push({ type: "UPDATED", folderId: folder.folderId, candidateId: publicId });
      } else events.push({ type: "REGISTERED", folderId: folder.folderId, candidateId });
    }
    return events;
  }

  private async backfillPublicIdentity(candidatePk: number, publicId: string) {
    const rows = await this.db<{ record_json: string }[]>`SELECT record_json FROM candidates WHERE id=${candidatePk}`; const row = rows[0];
    if (!row) throw new Error("CANDIDATE_IDENTITY_NOT_FOUND");
    const record = JSON.parse(row.record_json) as CandidateRecord;
    await this.db`UPDATE candidates SET public_id=${publicId},record_json=${JSON.stringify({ ...record, id: publicId })} WHERE id=${candidatePk} AND public_id IS NULL`;
  }
}

export function stableCandidateId(driveFolderId: string) {
  return Number.parseInt(sha256(driveFolderId).slice(0, 8), 16) % 2_147_483_647 || 1;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "").join("") || "?";
}
