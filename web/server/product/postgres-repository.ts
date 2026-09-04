import { randomUUID } from "node:crypto";
import { validateResultPair, type AssessmentOverviewItem, type AuditEvent, type CandidateAiOverview, type CandidateId, type CandidateRecord, type CandidateTranscript, type ResultDocumentType, type VacancyCreateInput, type VacancyLifecycleAction, type VacancyLifecycleAuditEvent, type VacancyRecord } from "../../app/product-model.ts";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";
import { projectCandidate, type ReadyReportProjection, type RuntimeProjectionRow } from "../candidate-pipeline/dashboard-projection.ts";
import { ProductConflictError, ProductNotFoundError, VacancyLifecycleConflictError, type ProductRepository, type ResultDocumentDescriptor, type StoredCandidate, type VacancyOperation } from "./application.ts";
import { VacancyGenerationPublicError, type GeneratedVacancyProfile, type VacancyGenerationErrorCode, type VacancyGenerationOperation } from "./vacancy-generation.ts";
import { renderVacancyGenerationPrompt } from "./prompt-contracts.ts";
import { hrSafeReportText } from "../candidate-pipeline/reports.ts";

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

function claimSourceLabel(locatorValue: unknown, sourceClass: unknown) {
  const locator = typeof locatorValue === "string" ? locatorValue : "";
  const lowered = `${String(sourceClass ?? "")} ${locator}`.toLocaleLowerCase("ru");
  const page = locator.match(/(?:page|стр(?:аница)?)[=:](\d+)/iu)?.[1];
  const utterance = locator.match(/(?:utterance(?:Id)?|реплик[аи])\s*[=:]\s*(?:utterance-)?(\d+)/iu)?.[1];
  const time = locator.match(/(?:time|таймкод)[=:]([^;]+)/iu)?.[1]?.trim();
  const startMs = Number(locator.match(/(?:startMs|start)\s*[=:]\s*(\d+)/iu)?.[1]);
  const endMs = Number(locator.match(/(?:endMs|end)\s*[=:]\s*(\d+)/iu)?.[1]);
  const formatTime = (value: number) => `${String(Math.floor(value / 60_000)).padStart(2, "0")}:${String(Math.floor((value % 60_000) / 1_000)).padStart(2, "0")}`;
  const interval = Number.isFinite(startMs) ? `${formatTime(startMs)}${Number.isFinite(endMs) && endMs > startMs ? `–${formatTime(endMs)}` : ""}` : time;
  const name = locator.match(/(?:name|fileName)[=:]([^;]+)/iu)?.[1]?.trim();
  if (/interview|transcript|стенограмм|интервью/u.test(lowered)) return ["Интервью", interval, !interval && utterance ? `реплика ${utterance}` : undefined].filter(Boolean).join(" · ");
  if (/resume|резюме/u.test(lowered)) return ["Резюме", page ? `стр. ${page}` : undefined].filter(Boolean).join(" · ");
  if (/recommend|рекомендац/u.test(lowered)) return ["Рекомендация", page ? `стр. ${page}` : undefined].filter(Boolean).join(" · ");
  return [name || "Документ кандидата", page ? `стр. ${page}` : undefined].filter(Boolean).join(" · ");
}

function hrText(value: unknown) {
  return typeof value === "string" ? hrSafeReportText(value).replace(/\s+/g, " ").trim() : "";
}

function normalizedDecisionText(value: unknown) {
  return hrText(value).toLocaleLowerCase("ru").replace(/[«»"'.,;:!?—–\-()]/g, " ").replace(/\s+/g, " ").trim();
}

export function projectAssessment(snapshotValue: unknown, evidenceValue: unknown, claimsValue?: unknown, vacancyValue?: unknown): CandidateAiOverview | undefined {
  const snapshot = record(snapshotValue);
  const structured = record(snapshot.structuredAssessment);
  if (!Object.keys(structured).length) return undefined;
  const evidenceBundle = record(evidenceValue);
  const claimsRef = typeof evidenceBundle.claimsRef === "string" ? evidenceBundle.claimsRef : "";
  const resolvedArtifacts = record(evidenceBundle.resolvedArtifacts);
  const claimsArtifact = record(claimsValue ?? resolvedArtifacts[claimsRef]);
  const facts = Array.isArray(evidenceBundle.facts) ? evidenceBundle.facts : [];
  const rawClaims = Array.isArray(claimsArtifact.claims) ? claimsArtifact.claims : [];
  const rawSignals = Array.isArray(claimsArtifact.unmappedSignals) ? claimsArtifact.unmappedSignals : [];
  const internalEvidence = [...rawClaims, ...rawSignals].flatMap((entry) => {
    const item = record(entry);
    const internalId = [item.claimId, item.signalId, item.id].find((value) => typeof value === "string");
    const quote = hrText(item.text ?? item.value);
    if (typeof internalId !== "string" || !quote) return [];
    return [{ internalId, quote, locator: item.locator, sourceClass: item.sourceClass, relation: String(item.relation ?? item.observationType ?? "CONTEXT"), criterionIds: Array.isArray(item.criterionIds) ? item.criterionIds.filter((value): value is string => typeof value === "string") : [] }];
  });
  const publicIdByInternal = new Map(internalEvidence.map((item, index) => [item.internalId, `evidence-${String(index + 1).padStart(3, "0")}`]));
  const concreteBasisByPublicId = new Map(internalEvidence.map((item) => [publicIdByInternal.get(item.internalId)!, {
    quote: item.quote, source: claimSourceLabel(item.locator, item.sourceClass),
  }]));
  const legacyPublicIdByInternal = new Map(facts.flatMap((entry, index) => {
    const fact = record(entry); return typeof fact.id === "string" ? [[fact.id, `evidence-legacy-${String(index + 1).padStart(3, "0")}`] as const] : [];
  }));
  const publicFactIds = (value: unknown) => Array.isArray(value) ? value.flatMap((id) => typeof id === "string"
    ? [publicIdByInternal.get(id) ?? legacyPublicIdByInternal.get(id)].filter((item): item is string => Boolean(item)) : []) : [];
  const backedItems = (value: unknown) => overviewItems(value).flatMap((item) => {
    const factIds = publicFactIds(item.factIds);
    if (!factIds.length) return [];
    const safeName = hrText(item.name);
    const safeReason = hrText(item.reason);
    const basis = concreteBasisByPublicId.get(factIds[0]);
    const reasonIsGeneric = !safeReason
      || /^(?:Вывод основан на указанном фрагменте материалов кандидата\.?|Дополнительн(?:ое наблюдение|ая сильная сторона из материалов)\s*:?)$/iu.test(safeReason);
    const reason = reasonIsGeneric && basis ? `${basis.source}: ${basis.quote}` : safeReason;
    return [{ ...item, name: safeName, reason: reason || undefined, factIds }];
  });
  const stopFactors = backedItems(structured.stopFactors);
  const explicitRisks = backedItems(structured.risks);
  const explicitCompetencies = backedItems(structured.competencies);
  const matrixCriteria = record(structured.matrixCriteria);
  const matrixRows = Array.isArray(structured.matrixRows) ? structured.matrixRows.flatMap((value) => {
    const row = record(value);
    if (typeof row.criterionId !== "string") return [];
    const criterion = record(matrixCriteria[row.criterionId]);
    const evidenceIds = Array.isArray(row.evidence) ? row.evidence.flatMap((value) => {
      const evidence = record(value); return typeof evidence.claimId === "string" ? [evidence.claimId] : [];
    }) : [];
    const factIds = publicFactIds([...evidenceIds, ...(Array.isArray(row.supportingClaimIds) ? row.supportingClaimIds : []), ...(Array.isArray(row.contradictingClaimIds) ? row.contradictingClaimIds : [])]);
    return [{ name: hrText(criterion.sourceText ?? criterion.interpretation) || "Пункт вакансии", category: String(criterion.category ?? "additional"), state: String(row.state ?? ""),
      reason: hrText(row.conclusion ?? row.reason), factIds, missingData: hrText(row.missingData), followUpQuestion: hrText(row.followUpQuestion) }];
  }) : [];
  const evidenceBackedRows = matrixRows.filter((item) => item.factIds.length > 0);
  const positiveMatrixRows = evidenceBackedRows.filter((item) => ["Соответствует", "Подтверждено"].includes(item.state));
  const negativeMatrixRows = evidenceBackedRows.filter((item) => ["Не соответствует", "Не подтверждено"].includes(item.state));
  const derivedCompetencies = positiveMatrixRows.filter((item) => item.category === "competency").map(({ category: _category, missingData: _missingData, followUpQuestion: _followUpQuestion, ...item }) => item);
  const competencies = explicitCompetencies.length ? explicitCompetencies : derivedCompetencies;
  const strengths = positiveMatrixRows.map(({ category: _category, missingData: _missingData, followUpQuestion: _followUpQuestion, ...item }) => item);
  const risks = explicitRisks.length ? explicitRisks : negativeMatrixRows.map(({ category: _category, missingData: _missingData, followUpQuestion: _followUpQuestion, ...item }) => item);
  const accessToKe = backedItems(structured.accessToKe);
  const observations = backedItems(structured.observations);
  const abcStates = record(structured.abcStates);
  const abcEvidence = record(structured.abcEvidence);
  const vacancy = record(vacancyValue);
  const vacancyDirections = Array.isArray(vacancy.abcDirections) ? vacancy.abcDirections.flatMap((value) => {
    const direction = record(value);
    const id = typeof direction.id === "string" ? direction.id.trim() : "";
    const title = [direction.name, direction.title].find((item) => typeof item === "string" && item.trim());
    if (!id && typeof title !== "string") return [];
    return [{ id: id || String(title), direction: typeof title === "string" ? hrText(title) : ABC_LABELS[id] ?? hrText(id),
      gradeA: hrText(direction.gradeA), gradeB: hrText(direction.gradeB), gradeC: hrText(direction.gradeC) }];
  }) : [];
  const stateDirectionIds = Object.keys(abcStates).filter((key) => !/^criterion-/i.test(key));
  const abcConfigured = vacancyDirections.length > 0 || structured.abcConfigured === true || stateDirectionIds.length > 0;
  const projectedDirections = vacancyDirections.length ? vacancyDirections : stateDirectionIds.map((id) => ({ id, direction: ABC_LABELS[id] ?? hrText(id), gradeA: "", gradeB: "", gradeC: "" }));
  const abc = abcConfigured ? projectedDirections.map((direction) => {
    const basis = record(abcEvidence[direction.id]);
    const definingConditions = Array.isArray(basis.definingConditions) ? basis.definingConditions.flatMap((value) => {
      const condition = hrText(value); return condition ? [condition] : [];
    }) : [];
    return { direction: direction.direction, grade: typeof abcStates[direction.id] === "string" ? String(abcStates[direction.id]) : "Недостаточно данных",
      reason: hrText(basis.reason) || undefined, factIds: publicFactIds(basis.factIds), gradeA: direction.gradeA || undefined, gradeB: direction.gradeB || undefined,
      gradeC: direction.gradeC || undefined, definingConditions: definingConditions.length ? definingConditions : undefined };
  }) : [{ direction: "ABC-профиль не настроен для вакансии", grade: "Не настроен", reason: "В профиле вакансии нет ABC-направлений.", factIds: [] }];
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
  const legacyEvidence = [...facts].flatMap((entry) => {
    const fact = record(entry);
    if (typeof fact.id !== "string") return [];
    const locator = record(fact.locator);
    return [{ id: legacyPublicIdByInternal.get(fact.id)!, technicalType: typeof fact.predicate === "string" ? fact.predicate : undefined,
      label: evidenceLabel(fact.predicate), claim: compact(fact.value, 180), source: sourceLabel(locator), criterion: criterionByFactId.get(legacyPublicIdByInternal.get(fact.id)!) ?? "Общий анализ",
      quote: compact(locator.exactText), page: typeof locator.page === "number" ? locator.page : undefined,
      timecode: locator.kind === "transcript" ? sourceLabel(locator).split(" · ").at(-1) : undefined }];
  });
  const nameByInternalId = new Map<string, string>();
  for (const row of matrixRows) for (const publicId of row.factIds) {
    const internalId = [...publicIdByInternal].find(([, value]) => value === publicId)?.[0];
    if (internalId) nameByInternalId.set(internalId, row.name);
  }
  const evidence = internalEvidence.map((item) => ({ id: publicIdByInternal.get(item.internalId)!, label: item.relation === "CONTRADICTS" ? "Основание несоответствия" : "Основание вывода",
    claim: item.quote, source: claimSourceLabel(item.locator, item.sourceClass), criterion: nameByInternalId.get(item.internalId) ?? "Общий анализ", quote: item.quote })).concat(legacyEvidence);
  const recommendationBasis = hrText(snapshot.recommendationReason)
    || stopFactors.find((item) => item.state === "Подтверждено")?.reason
    || risks[0]?.reason || competencies.find((item) => item.reason)?.reason
    || "Предметное основание рекомендации отсутствует в актуальной версии оценки.";
  const normalizedBasis = normalizedDecisionText(recommendationBasis);
  const summaryPart = (item: { name?: string; state?: string; reason?: string } | undefined) => {
    const reason = hrText(item?.reason);
    if (reason && normalizedDecisionText(reason) !== normalizedBasis) return reason;
    const name = hrText(item?.name);
    return name && normalizedDecisionText(name) !== normalizedBasis ? `${name}${item?.state ? `: ${hrText(item.state)}` : ""}.` : "";
  };
  const positivePart = summaryPart(strengths.find((item) => item.reason) ?? competencies.find((item) => item.reason));
  const attentionPart = summaryPart(stopFactors.find((item) => item.reason) ?? risks.find((item) => item.reason));
  const used = new Set([positivePart, attentionPart].map(normalizedDecisionText).filter(Boolean));
  const additionalPart = [
    ...observations.map((item) => summaryPart(item)),
    ...abc.map((item) => summaryPart({ name: item.direction, state: item.grade, reason: item.reason })),
  ].find((value) => value && !used.has(normalizedDecisionText(value))) ?? "";
  const summaryParts = [positivePart, attentionPart, additionalPart].filter(Boolean);
  const summary = summaryParts.join(" ")
    || `Анализ завершён${typeof snapshot.recommendation === "string" ? ` с рекомендацией «${snapshot.recommendation}»` : ""}. Детальные основания приведены в критериях и доказательствах.`;
  return { summary, recommendationBasis: hrText(recommendationBasis), stopFactors, abcConfigured, abc, criteria: matrixRows, competencies, strengths, risks, accessToKe, evidence };
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
      AND ((d.type='candidate-report' AND (SELECT count(*) FROM candidate_report_documents single WHERE single.report_version_id=r.id AND single.drive_file_id IS NOT NULL AND single.type='candidate-report')=1)
        OR (d.type IN ('candidate-results','abc-test') AND (SELECT count(DISTINCT pair.type) FROM candidate_report_documents pair WHERE pair.report_version_id=r.id AND pair.drive_file_id IS NOT NULL AND pair.type IN ('candidate-results','abc-test'))=2)) LIMIT 1`;
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
          compilation.state AS matrix_state,compilation.repair_cycles AS matrix_repair_count,compilation.terminal_error_code AS matrix_terminal_error_code
        FROM agent_goals g JOIN agent_runs r ON r.goal_id=g.id LEFT JOIN agent_tasks t ON t.run_id=r.id LEFT JOIN agent_attempts a ON a.task_id=t.id AND a.attempt_number=t.attempt_count
        LEFT JOIN vacancy_matrix_compilations compilation
          ON compilation.profile_version=g.profile_version
         AND compilation.workflow_identity=r.workflow_version
        WHERE g.goal_type IN ('candidate-analysis/v1','candidate-analysis-matrix/v1') ORDER BY g.candidate_id,g.created_at DESC,r.last_progress_at DESC,t.id`,
      this.sql<Row[]>`WITH RECURSIVE report_lineage(report_run_id,id,depth) AS (
          SELECT DISTINCT published.run_id,published.run_id,0 FROM candidate_report_versions published WHERE published.state='PUBLISHED'
          UNION ALL
          SELECT lineage.report_run_id,source.recovery_source_run_id,lineage.depth+1
          FROM report_lineage lineage JOIN agent_runs source ON source.id=lineage.id
          WHERE source.recovery_source_run_id IS NOT NULL AND lineage.depth<32
        )
        SELECT r.candidate_id,r.analysis_version,r.run_id,r.state,d.id AS document_id,d.type,d.file_name,d.drive_file_id,a.recommendation,
          COALESCE(publication.finished_at,run.last_progress_at) AS last_progress_at,
          ROUND(EXTRACT(EPOCH FROM (COALESCE(publication.finished_at,run.last_progress_at)::timestamptz - timing.started_at::timestamptz)) / 60)::integer AS elapsed_minutes,
          snapshot_blob.content AS assessment_blob,
          evidence_blob.content AS evidence_blob,
          claims_blob.content AS claims_blob,
          transcript.run_id AS transcript_run_id,
          transcript.utterances AS transcript_utterances,
          transcript.checksum AS transcript_checksum
        FROM candidate_report_versions r JOIN candidate_report_documents d ON d.report_version_id=r.id JOIN candidate_assessments a ON a.id=r.assessment_id JOIN agent_runs run ON run.id=r.run_id
        LEFT JOIN LATERAL (SELECT MIN(attempt.started_at) AS started_at FROM agent_tasks timing_task JOIN agent_attempts attempt ON attempt.task_id=timing_task.id WHERE timing_task.run_id=r.run_id) timing ON TRUE
        LEFT JOIN LATERAL (
          SELECT attempt.finished_at
          FROM agent_tasks publication_task JOIN agent_attempts attempt ON attempt.task_id=publication_task.id
          WHERE publication_task.run_id=r.run_id AND publication_task.tool_key='candidate.drive-publication/v1'
            AND publication_task.state='SUCCEEDED' AND attempt.state='SUCCEEDED' AND attempt.finished_at IS NOT NULL
          ORDER BY attempt.finished_at DESC LIMIT 1
        ) publication ON TRUE
        JOIN candidate_domain_artifacts snapshot ON snapshot.payload_ref=(a.decision_evidence_json::jsonb->>'assessmentRef')
        JOIN artifact_blobs snapshot_blob ON snapshot_blob.checksum=snapshot.checksum AND snapshot_blob.scope=('candidate:' || r.candidate_id || ':run:' || snapshot.run_id)
        LEFT JOIN LATERAL (
          SELECT domain.* FROM report_lineage lineage JOIN candidate_domain_artifacts domain ON domain.run_id=lineage.id
          WHERE lineage.report_run_id=r.run_id AND domain.kind IN ('evidence-bundle','matrix-evidence')
          ORDER BY lineage.depth,domain.created_at_utc DESC LIMIT 1
        ) evidence ON TRUE
        LEFT JOIN artifact_blobs evidence_blob ON evidence_blob.checksum=evidence.checksum AND evidence_blob.scope=('candidate:' || r.candidate_id || ':run:' || evidence.run_id)
        LEFT JOIN candidate_domain_artifacts claims ON claims.payload_ref=(convert_from(evidence_blob.content,'UTF8')::jsonb->>'claimsRef') AND claims.candidate_id=r.candidate_id
        LEFT JOIN artifact_blobs claims_blob ON claims_blob.checksum=claims.checksum AND claims_blob.scope=('candidate:' || r.candidate_id || ':run:' || claims.run_id)
        LEFT JOIN LATERAL (
          SELECT lineage.id AS run_id,'transcript-bundle' AS kind,transcript_blob.checksum,
            convert_from(transcript_blob.content,'UTF8')::jsonb->'normalized'->'utterances' AS utterances
          FROM report_lineage lineage JOIN artifact_blobs transcript_blob
            ON transcript_blob.scope=('candidate:' || r.candidate_id || ':run:' || lineage.id)
          WHERE lineage.report_run_id=r.run_id
            AND transcript_blob.id LIKE ('candidate:' || r.candidate_id || ':' || lineage.id || ':transcript-bundle:%')
          ORDER BY lineage.depth,transcript_blob.created_at_utc DESC LIMIT 1
        ) transcript ON transcript.kind='transcript-bundle'
        WHERE r.state='PUBLISHED' AND d.drive_file_id IS NOT NULL ORDER BY r.candidate_id,r.analysis_version DESC,d.type`,
      this.sql<Row[]>`SELECT DISTINCT ON (candidate_id) candidate_id,manifest_json
        FROM candidate_input_versions ORDER BY candidate_id,sequence DESC`,
    ]);
    const parsedVacancies = vacancyRows.map((row) => parse<VacancyRecord>(row.record_json));
    const vacancyById = new Map(parsedVacancies.map((vacancy) => [vacancy.id, vacancy]));
    const vacancyByCandidate = new Map(candidateRows.flatMap((row) => {
      const candidate = parse<StoredCandidate>(row.record_json);
      const vacancy = vacancyById.get(candidate.vacancyId);
      return vacancy ? [[row.id, vacancy] as const] : [];
    }));
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
        matrixState: row.matrix_state ? String(row.matrix_state) as RuntimeProjectionRow["matrixState"] : undefined, matrixRepairCount: row.matrix_repair_count == null ? undefined : Number(row.matrix_repair_count), matrixTerminalErrorCode: row.matrix_terminal_error_code ? String(row.matrix_terminal_error_code) : undefined };
      runtimeByCandidate.set(candidateId, [...(current ?? []), value]);
    }
    const reportsByCandidate = new Map<number, ReadyReportProjection>();
    for (const row of reportRows) {
      const candidateId = Number(row.candidate_id); const existing = reportsByCandidate.get(candidateId); if (existing && existing.analysisVersion !== Number(row.analysis_version)) continue;
      const decodeBlobJson = (value: unknown) => value instanceof Uint8Array || Buffer.isBuffer(value)
        ? parse(new TextDecoder().decode(value)) : undefined;
      const projection = existing ?? { runId: String(row.run_id), analysisVersion: Number(row.analysis_version), completedAt: String(row.last_progress_at), elapsedMinutes: Number(row.elapsed_minutes), recommendation: String(row.recommendation) as ReadyReportProjection["recommendation"],
        assessment: projectAssessment(decodeBlobJson(row.assessment_blob), decodeBlobJson(row.evidence_blob), decodeBlobJson(row.claims_blob), vacancyByCandidate.get(candidateId)),
        transcript: projectTranscript(row.transcript_run_id, row.transcript_utterances), documents: [] };
      projection.documents.push({ id: String(row.document_id), type: String(row.type) as ResultDocumentType, fileName: String(row.file_name), driveFileId: String(row.drive_file_id) }); reportsByCandidate.set(candidateId, projection);
    }
    return { candidates: candidateRows.map((row) => ({ candidatePk: row.id, candidate: { ...parse<StoredCandidate>(row.record_json), revision: row.revision } })).map(({ candidatePk, candidate }) => projectCandidate({ ...candidate, materials: materialsByCandidate.get(candidatePk) ?? candidate.materials }, runtimeByCandidate.get(candidatePk) ?? [], reportsByCandidate.get(candidatePk))), vacancies: parsedVacancies };
  }
  private operation(row: Row): VacancyOperation {
    return { operationId: String(row.operation_id), vacancyId: String(row.vacancy_id), normalizedTitle: String(row.normalized_title), input: parse<VacancyCreateInput>(row.input_json), state: String(row.state) as VacancyOperation["state"], folderId: row.folder_id ? String(row.folder_id) : undefined };
  }
  private async candidatePk(candidateId: CandidateId) {
    if (typeof candidateId === "number") return candidateId;
    const rows = await this.sql<{ id: number }[]>`SELECT id FROM candidates WHERE public_id=${candidateId}`; if (!rows[0]) throw new ProductNotFoundError("Кандидат не найден"); return rows[0].id;
  }
}
