import { validateResultPair, type AuditEvent, type ResultDocumentType, type VacancyCreateInput, type VacancyRecord } from "../../app/product-model.ts";
import {
  ProductConflictError,
  ProductNotFoundError,
  type ProductRepository,
  type ResultDocumentDescriptor,
  type StoredCandidate,
  type VacancyOperation,
} from "./application.ts";

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

function auditStatement(db: D1Database, event: AuditEvent) {
  return db.prepare("INSERT INTO audit_events (id, candidate_id, action, actor, timestamp, outcome, details) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), event.candidateId, event.action, event.actor, event.timestamp, event.outcome, event.details ?? null);
}

function conditionalAuditStatement(db: D1Database, event: AuditEvent, expectedRevision: number) {
  return db.prepare("INSERT INTO audit_events (id, candidate_id, action, actor, timestamp, outcome, details) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM candidates WHERE id = ? AND revision = ?)")
    .bind(crypto.randomUUID(), event.candidateId, event.action, event.actor, event.timestamp, event.outcome, event.details ?? null, event.candidateId, expectedRevision);
}

export class D1ProductRepository implements ProductRepository {
  constructor(private readonly db: D1Database) {}

  async isVacancyTitleAvailable(normalizedTitle: string) {
    const row = await this.db.prepare("SELECT 1 AS found FROM vacancies WHERE normalized_title = ? UNION ALL SELECT 1 AS found FROM vacancy_operations WHERE normalized_title = ? LIMIT 1")
      .bind(normalizedTitle, normalizedTitle).first<{ found: number }>();
    return !row;
  }

  async reserveVacancy(input: VacancyCreateInput): Promise<VacancyOperation> {
    const db = this.db;
    const current = await db.prepare("SELECT operation_id, vacancy_id, normalized_title, input_json, state, folder_id FROM vacancy_operations WHERE operation_id = ?")
      .bind(input.operationId).first<Record<string, string | null>>();
    if (current) {
      const operation = this.operation(current);
      if (operation.normalizedTitle !== input.title.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU")) {
        throw new ProductConflictError("Operation ID уже связан с другой вакансией");
      }
      return operation;
    }
    const normalizedTitle = input.title.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
    const vacancyId = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO vacancy_operations (operation_id, vacancy_id, normalized_title, input_json, state) VALUES (?, ?, ?, ?, 'provisioning')")
        .bind(input.operationId, vacancyId, normalizedTitle, JSON.stringify(input)).run();
    } catch {
      const retry = await db.prepare("SELECT operation_id, vacancy_id, normalized_title, input_json, state, folder_id FROM vacancy_operations WHERE operation_id = ?")
        .bind(input.operationId).first<Record<string, string | null>>();
      if (retry) return this.operation(retry);
      throw new ProductConflictError("Вакансия с таким названием уже существует");
    }
    return { operationId: input.operationId, vacancyId, normalizedTitle, input: structuredClone(input), state: "provisioning" };
  }

  async commitVacancy(operationId: string, folderId: string): Promise<VacancyRecord> {
    const db = this.db;
    const row = await db.prepare("SELECT operation_id, vacancy_id, normalized_title, input_json, state, folder_id FROM vacancy_operations WHERE operation_id = ?")
      .bind(operationId).first<Record<string, string | null>>();
    if (!row) throw new ProductNotFoundError("Операция создания вакансии не найдена");
    const operation = this.operation(row);
    const existing = await db.prepare("SELECT record_json FROM vacancies WHERE id = ?").bind(operation.vacancyId).first<{ record_json: string }>();
    if (existing) return parse<VacancyRecord>(existing.record_json);
    const vacancy: VacancyRecord = {
      id: operation.vacancyId,
      title: operation.input.title.trim().replace(/\s+/g, " "),
      normalizedTitle: operation.normalizedTitle,
      active: true,
      version: 1,
      templateVersion: operation.input.templateVersion,
      driveFolderId: folderId,
      profile: operation.input.profile,
      abcDirections: operation.input.abcDirections,
    };
    await db.batch([
      db.prepare("INSERT INTO vacancies (id, normalized_title, record_json) VALUES (?, ?, ?)")
        .bind(vacancy.id, vacancy.normalizedTitle, JSON.stringify(vacancy)),
      db.prepare("UPDATE vacancy_operations SET state = 'committed', folder_id = ? WHERE operation_id = ? AND state = 'provisioning'")
        .bind(folderId, operationId),
    ]);
    return vacancy;
  }

  async getCandidate(candidateId: number) {
    const row = await this.db.prepare("SELECT revision, record_json FROM candidates WHERE id = ?")
      .bind(candidateId).first<{ revision: number; record_json: string }>();
    return row ? { ...parse<StoredCandidate>(row.record_json), revision: row.revision } : null;
  }

  async commitCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent) {
    const db = this.db;
    const result = await db.batch([
      conditionalAuditStatement(db, audit, expectedRevision),
      db.prepare("UPDATE candidates SET revision = ?, record_json = ? WHERE id = ? AND revision = ?")
        .bind(candidate.revision, JSON.stringify(candidate), candidate.id, expectedRevision),
    ]);
    if ((result[0].meta.changes ?? 0) !== 1 || (result[1].meta.changes ?? 0) !== 1) throw new ProductConflictError("Состояние кандидата изменилось");
    return candidate;
  }

  async deleteCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent) {
    const db = this.db;
    const deletedAt = audit.timestamp;
    const result = await db.batch([
      conditionalAuditStatement(db, audit, expectedRevision),
      db.prepare("DELETE FROM result_documents WHERE candidate_id = ? AND EXISTS (SELECT 1 FROM candidates WHERE id = ? AND revision = ?)").bind(candidate.id, candidate.id, expectedRevision),
      db.prepare("INSERT INTO candidate_tombstones (candidate_id, deleted_at) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM candidates WHERE id = ? AND revision = ?) ON CONFLICT(candidate_id) DO NOTHING").bind(candidate.id, deletedAt, candidate.id, expectedRevision),
      db.prepare("DELETE FROM candidates WHERE id = ? AND revision = ?").bind(candidate.id, expectedRevision),
    ]);
    if ((result[0].meta.changes ?? 0) !== 1 || (result[3].meta.changes ?? 0) !== 1) throw new ProductConflictError("Состояние кандидата изменилось");
  }

  async findCurrentResult(principalId: string, candidateId: number, type: ResultDocumentType, version: number) {
    if (!principalId.trim()) return null;
    const candidate = await this.getCandidate(candidateId);
    if (!candidate || !validateResultPair(candidate) || candidate.result?.version !== version) return null;
    const row = await this.db.prepare("SELECT descriptor_json FROM result_documents WHERE candidate_id = ? AND type = ? AND version = ?")
      .bind(candidateId, type, version).first<{ descriptor_json: string }>();
    return row ? parse<ResultDocumentDescriptor>(row.descriptor_json) : null;
  }

  async appendAudit(event: AuditEvent) {
    await auditStatement(this.db, event).run();
  }

  async commitResultPair(candidate: StoredCandidate, expectedRevision: number, descriptors: readonly [ResultDocumentDescriptor, ResultDocumentDescriptor]) {
    const statements = descriptors.map((descriptor) => this.db.prepare("INSERT INTO result_documents (candidate_id, type, version, descriptor_json) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM candidates WHERE id = ? AND revision = ?)")
      .bind(descriptor.candidateId, descriptor.type, descriptor.version, JSON.stringify(descriptor), candidate.id, expectedRevision));
    const results = await this.db.batch([
      ...statements,
      this.db.prepare("UPDATE candidates SET revision = ?, record_json = ? WHERE id = ? AND revision = ?")
        .bind(candidate.revision, JSON.stringify(candidate), candidate.id, expectedRevision),
    ]);
    if (results.some((result) => (result.meta.changes ?? 0) !== 1)) throw new ProductConflictError("Состояние кандидата изменилось");
    return candidate;
  }

  async dashboardSource() {
    const [candidateRows, vacancyRows] = await Promise.all([
      this.db.prepare("SELECT record_json FROM candidates").all<{ record_json: string }>(),
      this.db.prepare("SELECT record_json FROM vacancies").all<{ record_json: string }>(),
    ]);
    return {
      candidates: candidateRows.results.map((row) => parse<StoredCandidate>(row.record_json)),
      vacancies: vacancyRows.results.map((row) => parse<VacancyRecord>(row.record_json)),
    };
  }

  private operation(row: Record<string, string | null>): VacancyOperation {
    return {
      operationId: row.operation_id!,
      vacancyId: row.vacancy_id!,
      normalizedTitle: row.normalized_title!,
      input: parse<VacancyCreateInput>(row.input_json!),
      state: row.state as VacancyOperation["state"],
      folderId: row.folder_id ?? undefined,
    };
  }
}
