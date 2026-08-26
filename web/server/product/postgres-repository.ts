import { randomUUID } from "node:crypto";
import { validateResultPair, type AssessmentOverviewItem, type AuditEvent, type CandidateAiOverview, type CandidateId, type CandidateRecord, type CandidateTranscript, type ResultDocumentType, type VacancyCreateInput, type VacancyLifecycleAction, type VacancyLifecycleAuditEvent, type VacancyRecord } from "../../app/product-model.ts";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";
import { projectCandidate, type ReadyReportProjection, type RuntimeProjectionRow } from "../candidate-pipeline/dashboard-projection.ts";
import { ProductConflictError, ProductNotFoundError, VacancyLifecycleConflictError, type ProductRepository, type ResultDocumentDescriptor, type StoredCandidate, type VacancyOperation } from "./application.ts";
import { VacancyGenerationPublicError, type GeneratedVacancyProfile, type VacancyGenerationErrorCode, type VacancyGenerationOperation } from "./vacancy-generation.ts";
import { renderVacancyGenerationPrompt } from "./prompt-contracts.ts";

type Row = Record<string, unknown>;
function parse<T>(value: unknown): T { return typeof value === "string" ? JSON.parse(value) as T : value as T; }

const ABC_LABELS: Readonly<Record<string, string>> = Object.freeze({
  productivity: "Продуктивность",
  initiative: "Инициатива",
  "self-learning": "Самообучаемость",
  "corporate-values": "Корпоративные ценности",
  autonomy: "Автономность",
});

const EVIDENCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  personal_contribution_event_case: "Личный вклад",
  result_event_case: "Подтверждённый результат",
  resume_achievement_fact: "Результат из резюме",
  competency_evidence: "Подтверждение компетенции",
  risk_evidence: "Основание риска",
});

function evidenceLabel(value: unknown) {
  const key = typeof value === "string" ? value.trim() : "";
  if (EVIDENCE_LABELS[key]) return EVIDENCE_LABELS[key];
  if (key.startsWith("competency:")) return "Подтверждение компетенции";
  if (key.startsWith("abc:")) return "Основание ABC-оценки";
  return "Доказательство";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function projectTranscript(runId: unknown, value: unknown): CandidateTranscript | undefined {
  const entries = typeof value === "string" ? parse<unknown>(value) : value;
  if (!Array.isArray(entries) || typeof runId !== "string" || !runId.trim()) return undefined;
  const utterances = entries.flatMap((entry) => {
    const item = record(entry);
    const transcriptText = typeof item.text === "string" ? item.text.trim() : "";
    if (!transcriptText) return [];
    const startMs = Number(item.start);
    const endMs = Number(item.end);
    return [{
      startMs: Number.isFinite(startMs) && startMs >= 0 ? startMs : 0,
      endMs: Number.isFinite(endMs) && endMs >= 0 ? endMs : 0,
      speaker: typeof item.speaker === "string" && item.speaker.trim() ? item.speaker.trim() : "Спикер",
      text: transcriptText,
    }];
  });
  return { runId, utterances };
}

function overviewItems(value: unknown): AssessmentOverviewItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const name = [item.name, item.title, item.value, item.condition, item.criterion, item.competency, item.risk, item.stopFactor].find((candidate) => typeof candidate === "string" && candidate.trim());
    if (typeof name !== "string") return [];
    const reason = [item.reason, item.description, item.observation, item.conclusion].find((candidate) => typeof candidate === "string" && candidate.trim());
    return [{ name: name.trim(), state: typeof item.state === "string" ? item.state : undefined,
      reason: typeof reason === "string" ? reason.trim() : undefined,
      factIds: Array.isArray(item.factIds) ? item.factIds.filter((id): id is string => typeof id === "string") : [] }];
  });
}

function compact(value: unknown, maximum = 260) {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function sourceLabel(locator: Record<string, unknown>) {
  if (locator.kind === "transcript") {
    const start = Number(locator.startMs ?? 0);
    const minutes = Math.floor(start / 60_000);
    const seconds = Math.floor((start % 60_000) / 1_000);
    return `${String(locator.speakerLabel ?? "Спикер")} · ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return [locator.fileName, locator.page ? `стр. ${locator.page}` : undefined, locator.section].filter(Boolean).join(" · ") || "Материалы кандидата";
}

export function projectAssessment(snapshotValue: unknown, evidenceValue: unknown): CandidateAiOverview | undefined {
  const snapshot = record(snapshotValue);
  const structured = record(snapshot.structuredAssessment);
  if (!Object.keys(structured).length) return undefined;
  const stopFactors = overviewItems(structured.stopFactors);
  const risks = overviewItems(structured.risks);
  const competencies = overviewItems(structured.competencies);
  const accessToKe = overviewItems(structured.accessToKe);
  const observations = overviewItems(structured.observations);
  const abcStates = record(structured.abcStates);
  const abcEvidence = record(structured.abcEvidence);
  const abc = Object.entries(abcStates).map(([direction, grade]) => {
    const basis = record(abcEvidence[direction]);
    return { direction: ABC_LABELS[direction] ?? direction, grade: String(grade), reason: typeof basis.reason === "string" ? basis.reason : undefined,
      factIds: Array.isArray(basis.factIds) ? basis.factIds.filter((id): id is string => typeof id === "string") : [] };
  });
  const criterionByFactId = new Map<string, string>();
  for (const item of [
    ...abc.map((entry) => ({ name: entry.direction, factIds: entry.factIds })),
    ...competencies,
    ...risks,
    ...stopFactors,
    ...accessToKe,
  ]) {
    for (const factId of item.factIds) {
      if (!criterionByFactId.has(factId)) criterionByFactId.set(factId, item.name);
    }
  }
  const referenced = new Set([...stopFactors, ...risks, ...competencies, ...accessToKe].flatMap((item) => item.factIds).concat(abc.flatMap((item) => item.factIds)));
  const evidenceBundle = record(evidenceValue);
  const facts = Array.isArray(evidenceBundle.facts) ? evidenceBundle.facts : [];
  const prioritized = [...facts].sort((left, right) => Number(referenced.has(String(record(right).id))) - Number(referenced.has(String(record(left).id))));
  const evidence = prioritized.slice(0, 16).flatMap((entry) => {
    const fact = record(entry);
    if (typeof fact.id !== "string") return [];
    const locator = record(fact.locator);
    return [{ id: fact.id, technicalType: typeof fact.predicate === "string" ? fact.predicate : undefined,
      label: evidenceLabel(fact.predicate), claim: compact(fact.value, 180), source: sourceLabel(locator), criterion: criterionByFactId.get(fact.id) ?? "Общий анализ",
      quote: compact(locator.exactText), page: typeof locator.page === "number" ? locator.page : undefined,
      timecode: locator.kind === "transcript" ? sourceLabel(locator).split(" · ").at(-1) : undefined }];
  });
  const recommendationBasis = stopFactors.find((item) => item.state === "Подтверждено")?.reason
    ?? risks[0]?.reason ?? competencies.find((item) => item.reason)?.reason
    ?? "Предметное основание рекомендации отсутствует в актуальной версии оценки.";
  const summaryParts = [
    ...observations.slice(0, 2).map((item) => item.reason),
    risks.find((item) => item.reason)?.reason,
    competencies.find((item) => item.reason)?.reason,
    abc.find((item) => item.reason)?.reason,
  ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const summary = compact([...new Set(summaryParts)].slice(0, 3).join(" "), 520)
    || `Анализ завершён${typeof snapshot.recommendation === "string" ? ` с рекомендацией «${snapshot.recommendation}»` : ""}. Детальные основания приведены в критериях и доказательствах.`;
  return { summary, recommendationBasis, stopFactors, abc, competencies, risks, accessToKe, evidence };
}

export class PostgresProductRepository implements ProductRepository {
  private readonly sql: PostgresClient;
  constructor(sql: PostgresClient) { this.sql = sql; }

  async isVacancyTitleAvailable(normalizedTitle: string) {
    const rows = await this.sql`SELECT 1 FROM vacancies WHERE normalized_title=${normalizedTitle} UNION ALL SELECT 1 FROM vacancy_operations WHERE normalized_title=${normalizedTitle} LIMIT 1`;
    return rows.length === 0;
  }
  private generation(row: Row): VacancyGenerationOperation {
    return { operationId: String(row.operation_id), originalTitle: String(row.original_title), normalizedTitle: String(row.normalized_title), state: String(row.state) as VacancyGenerationOperation["state"], attemptCount: Number(row.attempt_count),
      generatedProfile: row.generated_profile_json ? parse<GeneratedVacancyProfile>(row.generated_profile_json) : undefined, snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : undefined,
      errorCode: row.error_code ? String(row.error_code) as VacancyGenerationErrorCode : undefined,
      promptHash: row.prompt_hash ? String(row.prompt_hash) : undefined, promptArtifactId: row.prompt_artifact_id ? String(row.prompt_artifact_id) : undefined };
  }
  async beginGeneration(input: { operationId: string; originalTitle: string; normalizedTitle: string; promptHash?: string; promptArtifactId?: string }) {
    const defaults = renderVacancyGenerationPrompt(input.originalTitle);
    const promptHash = input.promptHash ?? defaults.hash;
    const promptArtifactId = input.promptArtifactId ?? defaults.artifactId;
    const existing = await this.getGeneration(input.operationId);
    if (existing) {
      if (existing.normalizedTitle !== input.normalizedTitle || existing.promptHash !== promptHash) throw new VacancyGenerationPublicError("VACANCY_GENERATION_OPERATION_CONFLICT", "Операция уже связана с другим запросом", existing.attemptCount);
      return { operation: existing, owner: false };
    }
    const now = new Date().toISOString();
    const inserted = await this.sql`INSERT INTO vacancy_generation_operations (operation_id,original_title,normalized_title,prompt_hash,prompt_artifact_id,state,attempt_count,created_at,updated_at)
      VALUES (${input.operationId},${input.originalTitle},${input.normalizedTitle},${promptHash},${promptArtifactId},'PENDING',0,${now},${now}) ON CONFLICT (operation_id) DO NOTHING RETURNING operation_id`;
    if (inserted.length) return { operation: { ...input, state: "PENDING" as const, attemptCount: 0 }, owner: true };
    const raced = await this.getGeneration(input.operationId);
    if (!raced || raced.normalizedTitle !== input.normalizedTitle || raced.promptHash !== promptHash) throw new VacancyGenerationPublicError("VACANCY_GENERATION_OPERATION_CONFLICT", "Операция уже связана с другим запросом", raced?.attemptCount ?? 0);
    return { operation: raced, owner: false };
  }
  async recordGenerationAttempt(input: { operationId: string; attempt: number; outcome: "started" | "retryable_failure" | "terminal_failure" | "succeeded"; safeCode?: string; traceId?: string }) {
    const now = new Date().toISOString();
    await withTransaction(this.sql, async (transaction) => {
      await transaction`INSERT INTO vacancy_generation_attempts (operation_id,attempt_number,outcome,safe_code,trace_id,created_at) VALUES (${input.operationId},${input.attempt},${input.outcome},${input.safeCode ?? null},${input.traceId ?? null},${now}) ON CONFLICT DO NOTHING`;
      await transaction`UPDATE vacancy_generation_operations SET attempt_count=GREATEST(attempt_count,${input.attempt}),updated_at=${now} WHERE operation_id=${input.operationId} AND state='PENDING'`;
    });
  }
  async completeGeneration(input: { operationId: string; attemptCount: number; profile: GeneratedVacancyProfile; snapshotHash: string }) {
    await this.sql`UPDATE vacancy_generation_operations SET state='SUCCEEDED',attempt_count=${input.attemptCount},generated_profile_json=${JSON.stringify(input.profile)},snapshot_hash=${input.snapshotHash},error_code=NULL,updated_at=${new Date().toISOString()} WHERE operation_id=${input.operationId} AND state='PENDING'`;
    const operation = await this.getGeneration(input.operationId); if (!operation) throw new ProductNotFoundError("Операция генерации не найдена"); return operation;
  }
  async failGeneration(input: { operationId: string; attemptCount: number; errorCode: VacancyGenerationErrorCode }) {
    await this.sql`UPDATE vacancy_generation_operations SET state='FAILED',attempt_count=${input.attemptCount},error_code=${input.errorCode},updated_at=${new Date().toISOString()} WHERE operation_id=${input.operationId} AND state='PENDING'`;
    const operation = await this.getGeneration(input.operationId); if (!operation) throw new ProductNotFoundError("Операция генерации не найдена"); return operation;
  }
  async getGeneration(operationId: string) { const rows = await this.sql<Row[]>`SELECT * FROM vacancy_generation_operations WHERE operation_id=${operationId}`; return rows[0] ? this.generation(rows[0]) : null; }
  async appendVacancyAudit(event: { operationId: string; type: string; attempt?: number; safeCode?: string; actor: string; timestamp: string }) {
    await this.sql`INSERT INTO vacancy_audit_events (id,operation_id,event_type,attempt_number,safe_code,actor,created_at) VALUES (${randomUUID()},${event.operationId},${event.type},${event.attempt ?? null},${event.safeCode ?? null},${event.actor},${event.timestamp})`;
  }
  async reserveVacancy(input: VacancyCreateInput): Promise<VacancyOperation> {
    const normalizedTitle = input.title.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
    const current = await this.sql<Row[]>`SELECT * FROM vacancy_operations WHERE operation_id=${input.operationId}`;
    if (current[0]) { const value = this.operation(current[0]); if (value.normalizedTitle !== normalizedTitle) throw new ProductConflictError("Operation ID уже связан с другой вакансией"); return value; }
    const vacancyId = randomUUID();
    const inserted = await this.sql`INSERT INTO vacancy_operations (operation_id,vacancy_id,normalized_title,input_json,state) VALUES (${input.operationId},${vacancyId},${normalizedTitle},${JSON.stringify(input)},'provisioning') ON CONFLICT DO NOTHING RETURNING operation_id`;
    if (!inserted.length) {
      const retry = await this.sql<Row[]>`SELECT * FROM vacancy_operations WHERE operation_id=${input.operationId}`;
      if (retry[0]) return this.operation(retry[0]); throw new ProductConflictError("Вакансия с таким названием уже существует");
    }
    return { operationId: input.operationId, vacancyId, normalizedTitle, input: structuredClone(input), state: "provisioning" };
  }
  async commitVacancy(operationId: string, folderId: string): Promise<VacancyRecord> {
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<Row[]>`SELECT * FROM vacancy_operations WHERE operation_id=${operationId} FOR UPDATE`;
      if (!rows[0]) throw new ProductNotFoundError("Операция создания вакансии не найдена");
      const operation = this.operation(rows[0]);
      const existing = await transaction<{ record_json: string }[]>`SELECT record_json FROM vacancies WHERE id=${operation.vacancyId}`;
      if (existing[0]) return parse<VacancyRecord>(existing[0].record_json);
      const vacancy: VacancyRecord = { id: operation.vacancyId, title: operation.input.title.trim().replace(/\s+/g, " "), normalizedTitle: operation.normalizedTitle, active: true, archived: false, version: 1, templateVersion: operation.input.templateVersion, driveFolderId: folderId, profile: operation.input.profile, abcDirections: operation.input.abcDirections };
      await transaction`INSERT INTO vacancies (id,normalized_title,record_json) VALUES (${vacancy.id},${vacancy.normalizedTitle},${JSON.stringify(vacancy)})`;
      await transaction`INSERT INTO vacancy_profile_versions (vacancy_id,version,record_json,created_at) VALUES (${vacancy.id},1,${JSON.stringify(vacancy)},${new Date().toISOString()}) ON CONFLICT DO NOTHING`;
      await transaction`UPDATE vacancy_operations SET state='committed',folder_id=${folderId} WHERE operation_id=${operationId} AND state='provisioning'`;
      return vacancy;
    });
  }
  private async appendVacancyLifecycleAuditWith(transaction: PostgresClient, event: VacancyLifecycleAuditEvent) {
    const operations = await transaction<{ operation_id: string }[]>`SELECT operation_id FROM vacancy_operations WHERE vacancy_id=${event.vacancyId} ORDER BY operation_id LIMIT 1`;
    await transaction`INSERT INTO vacancy_audit_events (id,operation_id,event_type,attempt_number,safe_code,actor,created_at) VALUES (${randomUUID()},${operations[0]?.operation_id ?? event.vacancyId},${`${event.action}_${event.outcome}`},${null},${event.details ?? null},${event.actor},${event.timestamp})`;
  }
  async commitVacancyLifecycle(vacancyId: string, action: VacancyLifecycleAction, audit: VacancyLifecycleAuditEvent) {
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<{ record_json: string }[]>`SELECT record_json FROM vacancies WHERE id=${vacancyId} FOR UPDATE`;
      if (!rows[0]) throw new ProductNotFoundError("Вакансия не найдена");
      const vacancy = parse<VacancyRecord>(rows[0].record_json);
      const archived = vacancy.archived === true;
      if (action === "archive") {
        if (archived) throw new VacancyLifecycleConflictError("VACANCY_ALREADY_ARCHIVED", "Вакансия уже находится в архиве");
        const updated: VacancyRecord = { ...vacancy, active: false, archived: true };
        await transaction`UPDATE vacancies SET record_json=${JSON.stringify(updated)} WHERE id=${vacancyId}`;
        await this.appendVacancyLifecycleAuditWith(transaction, audit);
        return updated;
      }
      if (action === "restore") {
        if (!archived) throw new VacancyLifecycleConflictError("VACANCY_NOT_ARCHIVED", "Вакансия не находится в архиве");
        const updated: VacancyRecord = { ...vacancy, active: true, archived: false };
        await transaction`UPDATE vacancies SET record_json=${JSON.stringify(updated)} WHERE id=${vacancyId}`;
        await this.appendVacancyLifecycleAuditWith(transaction, audit);
        return updated;
      }
      if (!archived) throw new VacancyLifecycleConflictError("VACANCY_NOT_ARCHIVED", "Сначала архивируйте вакансию");
      const candidates = await transaction<{ id: number; record_json: string }[]>`
        SELECT id,record_json FROM candidates
        WHERE record_json::jsonb->>'vacancyId'=${vacancyId}
        FOR UPDATE`;
      const candidateIds = candidates.map((candidate) => candidate.id);
      if (candidateIds.length) {
        const driveFolders = await transaction<{ drive_folder_id: string; candidate_id: number }[]>`
          SELECT drive_folder_id,candidate_id FROM candidate_drive_folders
          WHERE candidate_id IN ${transaction(candidateIds)}`;
        const runIds = await transaction<{ id: string }[]>`
          SELECT run.id
          FROM agent_runs run
          JOIN agent_goals goal ON goal.id=run.goal_id
          WHERE goal.candidate_id IN ${transaction(candidateIds)}`;
        if (runIds.length) await transaction`SELECT set_config('hh.cleanup_run_ids',${runIds.map((row) => row.id).join(",")},true)`;
        for (const row of candidates) {
          const candidate = parse<StoredCandidate>(row.record_json);
          await this.appendAuditWith(transaction, {
            candidateId: candidate.id,
            action: "delete",
            actor: audit.actor,
            timestamp: audit.timestamp,
            outcome: "success",
            details: `Удалён вместе с вакансией ${vacancyId}`,
          }, row.id);
          await transaction`INSERT INTO candidate_tombstones (candidate_id,deleted_at) VALUES (${row.id},${audit.timestamp}) ON CONFLICT (candidate_id) DO NOTHING`;
        }
        for (const folder of driveFolders) {
          await transaction`INSERT INTO candidate_drive_folder_tombstones (drive_folder_id,deleted_at_utc,cleanup_evidence_json)
            VALUES (${folder.drive_folder_id},${audit.timestamp},${JSON.stringify({ candidateId: folder.candidate_id, deletedWithVacancyId: vacancyId, applicationDataDeleted: true })})
            ON CONFLICT (drive_folder_id) DO NOTHING`;
        }
        await transaction`DELETE FROM result_documents WHERE candidate_id IN ${transaction(candidateIds)}`;
        await transaction`DELETE FROM candidates WHERE id IN ${transaction(candidateIds)}`;
      }
      await this.appendVacancyLifecycleAuditWith(transaction, audit);
      await transaction`DELETE FROM vacancies WHERE id=${vacancyId}`;
      await transaction`DELETE FROM vacancy_operations WHERE vacancy_id=${vacancyId}`;
      return null;
    });
  }
  async appendVacancyLifecycleAudit(event: VacancyLifecycleAuditEvent) {
    await this.appendVacancyLifecycleAuditWith(this.sql, event);
  }
  async getCandidate(candidateId: CandidateId) {
    const rows = typeof candidateId === "number" ? await this.sql<{ revision: number; record_json: string }[]>`SELECT revision,record_json FROM candidates WHERE id=${candidateId}` : await this.sql<{ revision: number; record_json: string }[]>`SELECT revision,record_json FROM candidates WHERE public_id=${candidateId}`;
    return rows[0] ? { ...parse<StoredCandidate>(rows[0].record_json), revision: rows[0].revision } : null;
  }
  private async appendAuditWith(transaction: PostgresClient, event: AuditEvent, candidatePk: number) {
    await transaction`INSERT INTO audit_events (id,candidate_id,action,actor,timestamp,outcome,details) VALUES (${randomUUID()},${candidatePk},${event.action},${event.actor},${event.timestamp},${event.outcome},${event.details ?? null})`;
  }
  async commitCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent) {
    const candidatePk = await this.candidatePk(candidate.id);
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction`UPDATE candidates SET revision=${candidate.revision},record_json=${JSON.stringify(candidate)} WHERE id=${candidatePk} AND revision=${expectedRevision} RETURNING id`;
      if (rows.length !== 1) throw new ProductConflictError("Состояние кандидата изменилось");
      await this.appendAuditWith(transaction, audit, candidatePk);
      if (audit.action === "archive") {
        await transaction`UPDATE agent_tasks SET state='CANCELLED',revision=revision+1,lease_owner=NULL,lease_expires_at=NULL WHERE run_id IN (SELECT r.id FROM agent_runs r JOIN agent_goals g ON g.id=r.goal_id WHERE g.candidate_id=${candidatePk}) AND state IN ('PENDING','RUNNABLE','RUNNING','WAITING','UNKNOWN_OUTCOME')`;
        await transaction`UPDATE agent_tool_grants SET revoked_at=${Date.parse(audit.timestamp)} WHERE candidate_id=${candidatePk} AND revoked_at IS NULL`;
        await transaction`UPDATE agent_runs SET state='PAUSED',revision=revision+1,last_progress_at=${audit.timestamp} WHERE goal_id IN (SELECT id FROM agent_goals WHERE candidate_id=${candidatePk}) AND state IN ('ACTIVE','WAITING_FOR_HUMAN')`;
      }
      return candidate;
    });
  }
  async deleteCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent) {
    const candidatePk = await this.candidatePk(candidate.id);
    await withTransaction(this.sql, async (transaction) => {
      const locked = await transaction`SELECT id FROM candidates WHERE id=${candidatePk} AND revision=${expectedRevision} FOR UPDATE`; if (!locked.length) throw new ProductConflictError("Состояние кандидата изменилось");
      const driveFolders = await transaction<{ drive_folder_id: string }[]>`SELECT drive_folder_id FROM candidate_drive_folders WHERE candidate_id=${candidatePk}`;
      await this.appendAuditWith(transaction, audit, candidatePk);
      await transaction`DELETE FROM result_documents WHERE candidate_id=${candidatePk}`;
      await transaction`INSERT INTO candidate_tombstones (candidate_id,deleted_at) VALUES (${candidatePk},${audit.timestamp}) ON CONFLICT (candidate_id) DO NOTHING`;
      const runIds = await transaction<{ id: string }[]>`SELECT run.id FROM agent_runs run JOIN agent_goals goal ON goal.id=run.goal_id WHERE goal.candidate_id=${candidatePk}`;
      if (runIds.length) await transaction`SELECT set_config('hh.cleanup_run_ids',${runIds.map((row) => row.id).join(",")},true)`;
      for (const folder of driveFolders) {
        await transaction`INSERT INTO candidate_drive_folder_tombstones (drive_folder_id,deleted_at_utc,cleanup_evidence_json)
          VALUES (${folder.drive_folder_id},${audit.timestamp},${JSON.stringify({ candidateId: candidatePk, applicationDataDeleted: true })})
          ON CONFLICT (drive_folder_id) DO NOTHING`;
      }
      const deleted = await transaction`DELETE FROM candidates WHERE id=${candidatePk} AND revision=${expectedRevision} RETURNING id`; if (!deleted.length) throw new ProductConflictError("Состояние кандидата изменилось");
    });
  }
  async findCurrentResult(principalId: string, candidateId: CandidateId, type: ResultDocumentType, version: number) {
    if (!principalId.trim()) return null;
    const candidate = await this.getCandidate(candidateId); if (!candidate) return null;
    const candidatePk = await this.candidatePk(candidateId);
    const rows = await this.sql<{ descriptor_json: string }[]>`SELECT descriptor_json FROM result_documents WHERE candidate_id=${candidatePk} AND type=${type} AND version=${version}`;
    if (rows[0] && validateResultPair(candidate) && candidate.result?.version === version) return parse<ResultDocumentDescriptor>(rows[0].descriptor_json);
    const canonical = await this.sql<{ file_name: string; drive_file_id: string; validation_json: string; analysis_version: number }[]>`SELECT d.file_name,d.drive_file_id,d.validation_json,r.analysis_version
      FROM candidate_report_documents d JOIN candidate_report_versions r ON r.id=d.report_version_id
      WHERE r.candidate_id=${candidatePk} AND r.analysis_version=${version} AND r.state='PUBLISHED' AND d.type=${type} AND d.drive_file_id IS NOT NULL
      AND (SELECT count(DISTINCT pair.type) FROM candidate_report_documents pair WHERE pair.report_version_id=r.id AND pair.drive_file_id IS NOT NULL AND pair.type IN ('candidate-results','abc-test'))=2 LIMIT 1`;
    if (!canonical[0] || parse<Record<string, unknown>>(canonical[0].validation_json).valid === false) return null;
    const validation = parse<Record<string, unknown>>(canonical[0].validation_json);
    return { candidateId, vacancyId: candidate.vacancyId, version: canonical[0].analysis_version, type, storageId: canonical[0].drive_file_id,
      artifactRef: typeof validation.artifactRef === "string" ? validation.artifactRef : undefined,
      fileName: canonical[0].file_name, published: true, valid: true } satisfies ResultDocumentDescriptor;
  }
  async appendAudit(event: AuditEvent) { await this.appendAuditWith(this.sql, event, await this.candidatePk(event.candidateId)); }
  async commitResultPair(candidate: StoredCandidate, expectedRevision: number, descriptors: readonly [ResultDocumentDescriptor, ResultDocumentDescriptor]) {
    const candidatePk = await this.candidatePk(candidate.id);
    return withTransaction(this.sql, async (transaction) => {
      const locked = await transaction`SELECT id FROM candidates WHERE id=${candidatePk} AND revision=${expectedRevision} FOR UPDATE`; if (!locked.length) throw new ProductConflictError("Состояние кандидата изменилось");
      for (const descriptor of descriptors) await transaction`INSERT INTO result_documents (candidate_id,type,version,descriptor_json) VALUES (${candidatePk},${descriptor.type},${descriptor.version},${JSON.stringify(descriptor)})`;
      const updated = await transaction`UPDATE candidates SET revision=${candidate.revision},record_json=${JSON.stringify(candidate)} WHERE id=${candidatePk} AND revision=${expectedRevision} RETURNING id`;
      if (!updated.length) throw new ProductConflictError("Состояние кандидата изменилось"); return candidate;
    });
  }
  async dashboardSource() {
    const [candidateRows, vacancyRows, runtimeRows, reportRows, materialRows] = await Promise.all([
      this.sql<{ id: number; revision: number; record_json: string }[]>`SELECT id,revision,record_json FROM candidates`,
      this.sql<{ record_json: string }[]>`SELECT record_json FROM vacancies`,
      this.sql<Row[]>`SELECT g.candidate_id,r.id AS run_id,r.state AS run_state,r.workflow_version,g.created_at AS run_started_at,r.last_progress_at,t.task_key,t.state AS task_state,t.attempt_count,a.error_code,
          compilation.state AS matrix_state,compilation.repair_cycles AS matrix_repair_count,compilation.terminal_error_code AS matrix_terminal_error_code,shadow_run.state AS matrix_shadow_state
        FROM agent_goals g JOIN agent_runs r ON r.goal_id=g.id LEFT JOIN agent_tasks t ON t.run_id=r.id LEFT JOIN agent_attempts a ON a.task_id=t.id AND a.attempt_number=t.attempt_count
        LEFT JOIN vacancy_matrix_compilations compilation ON compilation.profile_version=g.profile_version
        LEFT JOIN LATERAL (SELECT sr.state FROM agent_goals sg JOIN agent_runs sr ON sr.goal_id=sg.id WHERE sg.goal_type='candidate-analysis-matrix-shadow/v1' AND sg.candidate_id=g.candidate_id AND sg.input_version=g.input_version AND sg.profile_version=g.profile_version ORDER BY sr.last_progress_at DESC LIMIT 1) shadow_run ON TRUE
        WHERE g.goal_type IN ('candidate-analysis/v1','candidate-analysis-matrix/v1') ORDER BY g.candidate_id,g.created_at DESC,r.last_progress_at DESC,t.id`,
      this.sql<Row[]>`SELECT r.candidate_id,r.analysis_version,r.run_id,r.state,d.id AS document_id,d.type,d.file_name,d.drive_file_id,a.recommendation,run.last_progress_at,
          ROUND(EXTRACT(EPOCH FROM (run.last_progress_at::timestamptz - timing.started_at::timestamptz)) / 60)::integer AS elapsed_minutes,
          snapshot_blob.content AS assessment_blob,
          evidence_blob.content AS evidence_blob,
          transcript.run_id AS transcript_run_id,
          transcript.utterances AS transcript_utterances,
          transcript.checksum AS transcript_checksum
        FROM candidate_report_versions r JOIN candidate_report_documents d ON d.report_version_id=r.id JOIN candidate_assessments a ON a.id=r.assessment_id JOIN agent_runs run ON run.id=r.run_id
        LEFT JOIN LATERAL (SELECT MIN(attempt.started_at) AS started_at FROM agent_tasks timing_task JOIN agent_attempts attempt ON attempt.task_id=timing_task.id WHERE timing_task.run_id=r.run_id) timing ON TRUE
        JOIN candidate_domain_artifacts snapshot ON snapshot.payload_ref=(a.decision_evidence_json::jsonb->>'assessmentRef')
        JOIN artifact_blobs snapshot_blob ON snapshot_blob.checksum=snapshot.checksum AND snapshot_blob.scope=('candidate:' || r.candidate_id || ':run:' || r.run_id)
        LEFT JOIN candidate_domain_artifacts evidence ON evidence.run_id=r.run_id AND evidence.kind='evidence-bundle'
        LEFT JOIN artifact_blobs evidence_blob ON evidence_blob.checksum=evidence.checksum AND evidence_blob.scope=('candidate:' || r.candidate_id || ':run:' || r.run_id)
        LEFT JOIN LATERAL (
          SELECT r.run_id AS run_id,'transcript-bundle' AS kind,transcript_blob.checksum,
            convert_from(transcript_blob.content,'UTF8')::jsonb->'normalized'->'utterances' AS utterances
          FROM artifact_blobs transcript_blob
          WHERE transcript_blob.scope=('candidate:' || r.candidate_id || ':run:' || r.run_id)
            AND transcript_blob.id LIKE ('candidate:' || r.candidate_id || ':' || r.run_id || ':transcript-bundle:%')
          ORDER BY transcript_blob.created_at_utc DESC LIMIT 1
        ) transcript ON transcript.run_id=r.run_id AND transcript.kind='transcript-bundle'
        WHERE r.state='PUBLISHED' AND d.drive_file_id IS NOT NULL ORDER BY r.candidate_id,r.analysis_version DESC,d.type`,
      this.sql<Row[]>`SELECT DISTINCT ON (candidate_id) candidate_id,manifest_json
        FROM candidate_input_versions ORDER BY candidate_id,sequence DESC`,
    ]);
    const materialsByCandidate = new Map<number, CandidateRecord["materials"]>();
    for (const row of materialRows) {
      const manifest = parse<{ entries?: Array<Record<string, unknown>> }>(row.manifest_json);
      const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
      const materials = entries.flatMap((entry) => {
        const role = String(entry.role ?? "other");
        if (role === "result" || typeof entry.name !== "string") return [];
        const kind = role === "resume" ? "resume" : role === "interview" ? "interview" : role === "additional" ? "document" : "other";
        return [{ id: String(entry.fileId ?? entry.name), fileName: entry.name, kind, state: entry.supported === false ? "Формат не поддерживается" : undefined }];
      }) satisfies NonNullable<CandidateRecord["materials"]>;
      materialsByCandidate.set(Number(row.candidate_id), materials);
    }
    const runtimeByCandidate = new Map<number, RuntimeProjectionRow[]>();
    for (const row of runtimeRows) {
      const candidateId = Number(row.candidate_id); const current = runtimeByCandidate.get(candidateId); if (current?.length && current[0].runId !== String(row.run_id)) continue;
      const value: RuntimeProjectionRow = { runId: String(row.run_id), runState: String(row.run_state), workflowVersion: row.workflow_version ? String(row.workflow_version) : undefined, startedAt: String(row.run_started_at), lastProgressAt: String(row.last_progress_at), taskKey: row.task_key ? String(row.task_key) : undefined, taskState: row.task_state ? String(row.task_state) : undefined, attemptCount: row.attempt_count == null ? undefined : Number(row.attempt_count), errorCode: row.error_code ? String(row.error_code) : undefined,
        matrixState: row.matrix_state ? String(row.matrix_state) as RuntimeProjectionRow["matrixState"] : undefined, matrixRepairCount: row.matrix_repair_count == null ? undefined : Number(row.matrix_repair_count), matrixTerminalErrorCode: row.matrix_terminal_error_code ? String(row.matrix_terminal_error_code) : undefined, matrixShadowState: row.matrix_shadow_state ? String(row.matrix_shadow_state) : undefined };
      runtimeByCandidate.set(candidateId, [...(current ?? []), value]);
    }
    const reportsByCandidate = new Map<number, ReadyReportProjection>();
    for (const row of reportRows) {
      const candidateId = Number(row.candidate_id); const existing = reportsByCandidate.get(candidateId); if (existing && existing.analysisVersion !== Number(row.analysis_version)) continue;
      const decodeBlobJson = (value: unknown) => value instanceof Uint8Array || Buffer.isBuffer(value)
        ? parse(new TextDecoder().decode(value)) : undefined;
      const projection = existing ?? { runId: String(row.run_id), analysisVersion: Number(row.analysis_version), completedAt: String(row.last_progress_at), elapsedMinutes: Number(row.elapsed_minutes), recommendation: String(row.recommendation) as ReadyReportProjection["recommendation"],
        assessment: projectAssessment(decodeBlobJson(row.assessment_blob), decodeBlobJson(row.evidence_blob)),
        transcript: projectTranscript(row.transcript_run_id, row.transcript_utterances), documents: [] };
      projection.documents.push({ id: String(row.document_id), type: String(row.type) as ResultDocumentType, fileName: String(row.file_name), driveFileId: String(row.drive_file_id) }); reportsByCandidate.set(candidateId, projection);
    }
    return { candidates: candidateRows.map((row) => ({ candidatePk: row.id, candidate: { ...parse<StoredCandidate>(row.record_json), revision: row.revision } })).map(({ candidatePk, candidate }) => projectCandidate({ ...candidate, materials: materialsByCandidate.get(candidatePk) ?? candidate.materials }, runtimeByCandidate.get(candidatePk) ?? [], reportsByCandidate.get(candidatePk))), vacancies: vacancyRows.map((row) => parse<VacancyRecord>(row.record_json)) };
  }
  private operation(row: Row): VacancyOperation {
    return { operationId: String(row.operation_id), vacancyId: String(row.vacancy_id), normalizedTitle: String(row.normalized_title), input: parse<VacancyCreateInput>(row.input_json), state: String(row.state) as VacancyOperation["state"], folderId: row.folder_id ? String(row.folder_id) : undefined };
  }
  private async candidatePk(candidateId: CandidateId) {
    if (typeof candidateId === "number") return candidateId;
    const rows = await this.sql<{ id: number }[]>`SELECT id FROM candidates WHERE public_id=${candidateId}`; if (!rows[0]) throw new ProductNotFoundError("Кандидат не найден"); return rows[0].id;
  }
}
