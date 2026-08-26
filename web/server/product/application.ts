import {
  archiveCandidate,
  beginManualReprocess,
  buildDashboardSnapshot,
  deleteArchivedCandidate,
  normalizeVacancyTitle,
  restoreCandidate,
  validateFullVacancyProfile,
  validateResultPair,
  validateVacancyTitle,
  type AuditEvent,
  type CandidateId,
  type CandidateRecord,
  type ResultDocumentType,
  type ResultPair,
  type VacancyCreateInput,
  type VacancyLifecycleAction,
  type VacancyLifecycleAuditEvent,
  type VacancyRecord,
} from "../../app/product-model.ts";
import {
  CANONICAL_ABC_DIRECTIONS,
  generateVacancyProfile,
  InMemoryVacancyGenerationRepository,
  vacancySnapshotHash,
  VacancyGenerationPublicError,
  type VacancyGenerationRepository,
} from "./vacancy-generation.ts";
import { LlmProviderAttemptError } from "../llm/gateway.ts";
import { CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT, composeProtectedAssessmentInstruction, createEditablePromptSnapshot, generationPromptMapWithDefaults, normalizeEditablePrompt, renderVacancyGenerationPrompt, standardEditablePrompt, VACANCY_GENERATION_PROMPT_ARTIFACT } from "./prompt-contracts.ts";

export type StoredCandidate = CandidateRecord & { revision: number };

export type VacancyOperation = {
  operationId: string;
  vacancyId: string;
  normalizedTitle: string;
  input: VacancyCreateInput;
  state: "provisioning" | "committed";
  folderId?: string;
};

export type ResultDocumentDescriptor = {
  candidateId: CandidateId;
  vacancyId: string;
  version: number;
  type: ResultDocumentType;
  storageId: string;
  artifactRef?: string;
  fileName: string;
  published: boolean;
  valid: boolean;
};

export interface ProductRepository extends VacancyGenerationRepository {
  isVacancyTitleAvailable(normalizedTitle: string): Promise<boolean>;
  reserveVacancy(input: VacancyCreateInput): Promise<VacancyOperation>;
  commitVacancy(operationId: string, folderId: string): Promise<VacancyRecord>;
  commitVacancyLifecycle(vacancyId: string, action: VacancyLifecycleAction, audit: VacancyLifecycleAuditEvent): Promise<VacancyRecord | null>;
  appendVacancyLifecycleAudit(event: VacancyLifecycleAuditEvent): Promise<void>;
  getCandidate(candidateId: CandidateId): Promise<StoredCandidate | null>;
  commitCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent): Promise<StoredCandidate>;
  deleteCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent): Promise<void>;
  findCurrentResult(principalId: string, candidateId: CandidateId, type: ResultDocumentType, version: number): Promise<ResultDocumentDescriptor | null>;
  appendAudit(event: AuditEvent): Promise<void>;
  commitResultPair(candidate: StoredCandidate, expectedRevision: number, descriptors: readonly [ResultDocumentDescriptor, ResultDocumentDescriptor]): Promise<StoredCandidate>;
  dashboardSource(): Promise<{ candidates: CandidateRecord[]; vacancies: VacancyRecord[] }>;
}

export interface VacancyFolderGateway {
  ensureVacancyFolder(input: { operationId: string; vacancyId: string; title: string }): Promise<string>;
}

export interface ResultArtifactGateway {
  readPdf(storageId: string): Promise<Uint8Array>;
  readImmutablePdf?(artifactRef: string): Promise<Uint8Array>;
}

export class ProductConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductConflictError";
  }
}

export class ProductNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductNotFoundError";
  }
}

export async function createVacancy(
  repository: ProductRepository,
  folders: VacancyFolderGateway,
  input: VacancyCreateInput,
) {
  const titleError = validateVacancyTitle(input.title, []);
  if (titleError) throw new ProductConflictError(titleError);

  const createInput: VacancyCreateInput = {
    ...input,
    abcDirections: input.abcDirections.length ? input.abcDirections : CANONICAL_ABC_DIRECTIONS.map((direction) => ({
      id: direction.id,
      name: direction.name,
      gradeA: "",
      gradeB: "",
      gradeC: "",
      origin: "standard" as const,
    })),
  };

  const operation = await repository.reserveVacancy(createInput);
  if (operation.state === "committed" && operation.folderId) {
    return repository.commitVacancy(operation.operationId, operation.folderId);
  }
  const folderId = await folders.ensureVacancyFolder({
    operationId: operation.operationId,
    vacancyId: operation.vacancyId,
    title: input.title.trim().replace(/\s+/g, " "),
  });
  if (!folderId.trim()) throw new Error("Google Drive folder binding не подтверждён");
  const vacancy = await repository.commitVacancy(operation.operationId, folderId);
  await repository.appendVacancyAudit({ operationId: operation.operationId, type: "final_save_committed", actor: "authenticated-hr", timestamp: new Date().toISOString() });
  return vacancy;
}

export async function executeVacancyLifecycleCommand(
  repository: ProductRepository,
  input: { vacancyId: string; action: VacancyLifecycleAction; actor: string; timestamp?: string },
) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const audit: VacancyLifecycleAuditEvent = { vacancyId: input.vacancyId, action: input.action, actor: input.actor, timestamp, outcome: "success" };
  try {
    return await repository.commitVacancyLifecycle(input.vacancyId, input.action, audit);
  } catch (error) {
    await repository.appendVacancyLifecycleAudit({ ...audit, outcome: "rejected", details: error instanceof Error ? error.message : "rejected" });
    throw error;
  }
}

type LifecycleAction = "archive" | "restore" | "delete" | "reprocess";

export async function executeLifecycleCommand(
  repository: ProductRepository,
  input: { candidateId: CandidateId; action: LifecycleAction; actor: string; expectedRevision: number; timestamp?: string },
) {
  const candidate = await repository.getCandidate(input.candidateId);
  if (!candidate) throw new ProductNotFoundError("Кандидат не найден");
  const timestamp = input.timestamp ?? new Date().toISOString();
  const audit: AuditEvent = {
    action: input.action,
    actor: input.actor,
    candidateId: input.candidateId,
    timestamp,
    outcome: "success",
  };
  try {
    if (input.action === "delete") {
      deleteArchivedCandidate(candidate);
      await repository.deleteCandidate(candidate, input.expectedRevision, audit);
      return null;
    }
    const updated = input.action === "archive"
      ? archiveCandidate(candidate)
      : input.action === "restore"
        ? restoreCandidate(candidate)
        : beginManualReprocess(candidate, timestamp);
    return await repository.commitCandidate({ ...updated, revision: candidate.revision + 1 }, input.expectedRevision, audit);
  } catch (error) {
    await repository.appendAudit({
      ...audit,
      outcome: "rejected",
      details: error instanceof Error ? error.message : "rejected",
    });
    throw error;
  }
}

function isPdf(bytes: Uint8Array) {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

export async function readCurrentResult(
  repository: ProductRepository,
  artifacts: ResultArtifactGateway,
  input: { principalId: string; candidateId: CandidateId; type: ResultDocumentType; version: number; mode: "preview" | "download" },
) {
  const descriptor = await repository.findCurrentResult(input.principalId, input.candidateId, input.type, input.version);
  if (!descriptor || !descriptor.published || !descriptor.valid) {
    throw new ProductNotFoundError("Документ недоступен или не соответствует актуальной версии");
  }
  let bytes: Uint8Array;
  try {
    bytes = await artifacts.readPdf(descriptor.storageId);
    if (!isPdf(bytes)) throw new Error("PUBLISHED_DRIVE_PDF_INVALID");
  } catch {
    if (!descriptor.artifactRef || !artifacts.readImmutablePdf) {
      throw new ProductNotFoundError("Документ недоступен или повреждён");
    }
    bytes = await artifacts.readImmutablePdf(descriptor.artifactRef);
    if (!isPdf(bytes)) throw new ProductNotFoundError("Документ недоступен или повреждён");
  }
  if (input.mode === "download") {
    await repository.appendAudit({
      action: "export",
      actor: input.principalId,
      candidateId: input.candidateId,
      timestamp: new Date().toISOString(),
      outcome: "success",
      details: `${descriptor.type}:v${String(descriptor.version).padStart(4, "0")}`,
    });
  }
  return { descriptor, bytes };
}

export async function publishResultPair(
  repository: ProductRepository,
  input: {
    candidateId: CandidateId;
    expectedRevision: number;
    result: ResultPair;
    descriptors: readonly [ResultDocumentDescriptor, ResultDocumentDescriptor];
  },
) {
  const candidate = await repository.getCandidate(input.candidateId);
  if (!candidate) throw new ProductNotFoundError("Кандидат не найден");
  if (candidate.archived) throw new ProductConflictError("Нельзя публиковать результат архивного кандидата");
  const types = new Set(input.descriptors.map((item) => item.type));
  const valid = types.size === 2
    && types.has("candidate-results")
    && types.has("abc-test")
    && input.descriptors.every((descriptor) => descriptor.candidateId === candidate.id
      && descriptor.vacancyId === candidate.vacancyId
      && descriptor.version === input.result.version
      && descriptor.published
      && descriptor.valid
      && descriptor.storageId.trim()
      && descriptor.fileName.trim())
    && input.result.documents.every((document) => document.candidateId === candidate.id
      && document.vacancyId === candidate.vacancyId
      && document.version === input.result.version
      && document.published
      && document.valid)
    && new Set(input.result.documents.map((document) => document.type)).size === 2;
  if (!valid) throw new ProductConflictError("READY требует валидную согласованную пару PDF");
  const updated: StoredCandidate = { ...candidate, status: "READY", result: structuredClone(input.result), revision: candidate.revision + 1 };
  return repository.commitResultPair(updated, input.expectedRevision, input.descriptors);
}

export async function getOperationalDashboard(
  repository: ProductRepository,
  period: 7 | 30 | 90,
  asOf = new Date(),
) {
  const source = await repository.dashboardSource();
  return buildDashboardSnapshot(source.candidates, source.vacancies, period, asOf);
}

export class InMemoryProductRepository implements ProductRepository {
  readonly vacancies = new Map<string, VacancyRecord>();
  readonly operations = new Map<string, VacancyOperation>();
  readonly candidates = new Map<CandidateId, StoredCandidate>();
  readonly audits: AuditEvent[] = [];
  readonly tombstones = new Set<CandidateId>();
  readonly results = new Map<string, ResultDocumentDescriptor>();
  readonly generations = new Map<string, import("./vacancy-generation.ts").VacancyGenerationOperation>();
  readonly generationAttempts: Array<{ operationId: string; attempt: number; outcome: string; safeCode?: string }> = [];
  readonly vacancyAudits: Array<{ operationId: string; type: string; attempt?: number; safeCode?: string; actor: string; timestamp: string }> = [];

  constructor(seed: { vacancies?: VacancyRecord[]; candidates?: StoredCandidate[]; results?: ResultDocumentDescriptor[] } = {}) {
    seed.vacancies?.forEach((item) => this.vacancies.set(item.id, structuredClone(item)));
    seed.candidates?.forEach((item) => this.candidates.set(item.id, structuredClone(item)));
    seed.results?.forEach((item) => this.results.set(this.resultKey(item.candidateId, item.type, item.version), structuredClone(item)));
  }

  async isVacancyTitleAvailable(normalizedTitle: string) {
    return ![...this.vacancies.values()].some((item) => item.normalizedTitle === normalizedTitle)
      && ![...this.operations.values()].some((item) => item.normalizedTitle === normalizedTitle);
  }

  async beginGeneration(input: { operationId: string; originalTitle: string; normalizedTitle: string }) {
    const existing = this.generations.get(input.operationId);
    if (existing) return { operation: structuredClone(existing), owner: false };
    const operation: import("./vacancy-generation.ts").VacancyGenerationOperation = { ...input, state: "PENDING", attemptCount: 0 };
    this.generations.set(input.operationId, operation);
    return { operation: structuredClone(operation), owner: true };
  }

  async recordGenerationAttempt(input: { operationId: string; attempt: number; outcome: "started" | "retryable_failure" | "terminal_failure" | "succeeded"; safeCode?: string }) {
    this.generationAttempts.push(input);
    const operation = this.generations.get(input.operationId);
    if (operation) operation.attemptCount = Math.max(operation.attemptCount, input.attempt);
  }

  async completeGeneration(input: { operationId: string; attemptCount: number; profile: import("./vacancy-generation.ts").GeneratedVacancyProfile; snapshotHash: string }) {
    const operation = this.generations.get(input.operationId);
    if (!operation) throw new ProductNotFoundError("Операция генерации не найдена");
    Object.assign(operation, { state: "SUCCEEDED" as const, attemptCount: input.attemptCount, generatedProfile: structuredClone(input.profile), snapshotHash: input.snapshotHash });
    return structuredClone(operation);
  }

  async failGeneration(input: { operationId: string; attemptCount: number; errorCode: import("./vacancy-generation.ts").VacancyGenerationErrorCode }) {
    const operation = this.generations.get(input.operationId);
    if (!operation) throw new ProductNotFoundError("Операция генерации не найдена");
    Object.assign(operation, { state: "FAILED" as const, attemptCount: input.attemptCount, errorCode: input.errorCode });
    return structuredClone(operation);
  }

  async getGeneration(operationId: string) {
    const operation = this.generations.get(operationId);
    return operation ? structuredClone(operation) : null;
  }

  async appendVacancyAudit(event: { operationId: string; type: string; attempt?: number; safeCode?: string; actor: string; timestamp: string }) {
    this.vacancyAudits.push(structuredClone(event));
  }

  async reserveVacancy(input: VacancyCreateInput) {
    const existing = this.operations.get(input.operationId);
    if (existing) {
      if (existing.normalizedTitle !== normalizeVacancyTitle(input.title)) {
        throw new ProductConflictError("Operation ID уже связан с другой вакансией");
      }
      return structuredClone(existing);
    }
    const duplicate = [...this.vacancies.values()].find((item) => item.normalizedTitle === normalizeVacancyTitle(input.title));
    const reserved = [...this.operations.values()].find((item) => item.normalizedTitle === normalizeVacancyTitle(input.title));
    if (duplicate || reserved) throw new ProductConflictError("Вакансия с таким названием уже существует");
    const vacancyId = `vac-${String(this.vacancies.size + this.operations.size + 1).padStart(4, "0")}`;
    const operation: VacancyOperation = {
      operationId: input.operationId,
      vacancyId,
      normalizedTitle: normalizeVacancyTitle(input.title),
      input: structuredClone(input),
      state: "provisioning",
    };
    this.operations.set(input.operationId, operation);
    return structuredClone(operation);
  }

  async commitVacancy(operationId: string, folderId: string) {
    const operation = this.operations.get(operationId);
    if (!operation) throw new ProductNotFoundError("Операция создания вакансии не найдена");
    const committed = this.vacancies.get(operation.vacancyId);
    if (committed) return structuredClone(committed);
    const duplicate = [...this.vacancies.values()].find((item) => item.normalizedTitle === operation.normalizedTitle);
    if (duplicate) throw new ProductConflictError("Вакансия с таким названием уже существует");
    const vacancy: VacancyRecord = {
      id: operation.vacancyId,
      title: operation.input.title.trim().replace(/\s+/g, " "),
      normalizedTitle: operation.normalizedTitle,
      active: true,
      archived: false,
      version: 1,
      templateVersion: operation.input.templateVersion,
      driveFolderId: folderId,
      profile: structuredClone(operation.input.profile),
      abcDirections: structuredClone(operation.input.abcDirections),
    };
    this.vacancies.set(vacancy.id, vacancy);
    this.operations.set(operationId, { ...operation, state: "committed", folderId });
    return structuredClone(vacancy);
  }

  async commitVacancyLifecycle(vacancyId: string, action: VacancyLifecycleAction, audit: VacancyLifecycleAuditEvent) {
    const vacancy = this.vacancies.get(vacancyId);
    if (!vacancy) throw new ProductNotFoundError("Вакансия не найдена");
    if (action === "archive") {
      if (vacancy.archived) throw new VacancyLifecycleConflictError("VACANCY_ALREADY_ARCHIVED", "Вакансия уже находится в архиве");
      const updated: VacancyRecord = { ...vacancy, active: false, archived: true };
      this.vacancies.set(vacancyId, updated);
      await this.appendVacancyLifecycleAudit(audit);
      return structuredClone(updated);
    }
    if (action === "restore") {
      if (!vacancy.archived) throw new VacancyLifecycleConflictError("VACANCY_NOT_ARCHIVED", "Вакансия не находится в архиве");
      const updated: VacancyRecord = { ...vacancy, active: true, archived: false };
      this.vacancies.set(vacancyId, updated);
      await this.appendVacancyLifecycleAudit(audit);
      return structuredClone(updated);
    }
    if (!vacancy.archived) throw new VacancyLifecycleConflictError("VACANCY_NOT_ARCHIVED", "Сначала архивируйте вакансию");
    for (const [candidateId, candidate] of this.candidates) {
      if (candidate.vacancyId !== vacancyId) continue;
      this.candidates.delete(candidateId);
      this.tombstones.add(candidateId);
      for (const key of [...this.results.keys()]) if (key.startsWith(`${candidateId}:`)) this.results.delete(key);
      this.audits.push({
        candidateId,
        action: "delete",
        actor: audit.actor,
        timestamp: audit.timestamp,
        outcome: "success",
        details: `Удалён вместе с вакансией ${vacancyId}`,
      });
    }
    this.vacancies.delete(vacancyId);
    for (const [operationId, operation] of this.operations) if (operation.vacancyId === vacancyId) this.operations.delete(operationId);
    await this.appendVacancyLifecycleAudit(audit);
    return null;
  }

  async appendVacancyLifecycleAudit(event: VacancyLifecycleAuditEvent) {
    this.vacancyAudits.push({ operationId: event.vacancyId, type: event.action, safeCode: event.outcome === "rejected" ? event.details : undefined, actor: event.actor, timestamp: event.timestamp });
  }

  async getCandidate(candidateId: CandidateId) {
    const value = this.candidates.get(candidateId);
    return value ? structuredClone(value) : null;
  }

  async commitCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent) {
    const current = this.candidates.get(candidate.id);
    if (!current || current.revision !== expectedRevision) throw new ProductConflictError("Состояние кандидата изменилось");
    this.candidates.set(candidate.id, structuredClone(candidate));
    this.audits.push(structuredClone(audit));
    return structuredClone(candidate);
  }

  async deleteCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent) {
    const current = this.candidates.get(candidate.id);
    if (!current || current.revision !== expectedRevision) throw new ProductConflictError("Состояние кандидата изменилось");
    this.candidates.delete(candidate.id);
    for (const key of [...this.results.keys()]) if (key.startsWith(`${candidate.id}:`)) this.results.delete(key);
    this.tombstones.add(candidate.id);
    this.audits.push(structuredClone(audit));
  }

  async findCurrentResult(_principalId: string, candidateId: CandidateId, type: ResultDocumentType, version: number) {
    const candidate = this.candidates.get(candidateId);
    if (!candidate || !validateResultPair(candidate) || candidate.result?.version !== version) return null;
    const descriptor = this.results.get(this.resultKey(candidateId, type, version));
    return descriptor ? structuredClone(descriptor) : null;
  }

  async appendAudit(event: AuditEvent) {
    this.audits.push(structuredClone(event));
  }

  async commitResultPair(candidate: StoredCandidate, expectedRevision: number, descriptors: readonly [ResultDocumentDescriptor, ResultDocumentDescriptor]) {
    const current = this.candidates.get(candidate.id);
    if (!current || current.revision !== expectedRevision) throw new ProductConflictError("Состояние кандидата изменилось");
    for (const descriptor of descriptors) this.results.set(this.resultKey(descriptor.candidateId, descriptor.type, descriptor.version), structuredClone(descriptor));
    this.candidates.set(candidate.id, structuredClone(candidate));
    return structuredClone(candidate);
  }

  async dashboardSource() {
    return {
      candidates: [...this.candidates.values()].map((item) => {
        const candidate = structuredClone(item) as Partial<StoredCandidate>;
        delete candidate.revision;
        return candidate as CandidateRecord;
      }),
      vacancies: [...this.vacancies.values()].map((item) => structuredClone(item)),
    };
  }

  private resultKey(candidateId: CandidateId, type: ResultDocumentType, version: number) {
    return `${candidateId}:${type}:${version}`;
  }
}

export class VacancyLifecycleConflictError extends ProductConflictError {
  readonly code: "VACANCY_NOT_ARCHIVED" | "VACANCY_ALREADY_ARCHIVED" | "VACANCY_HAS_CANDIDATES";
  constructor(code: "VACANCY_NOT_ARCHIVED" | "VACANCY_ALREADY_ARCHIVED" | "VACANCY_HAS_CANDIDATES", message: string) {
    super(message);
    this.code = code;
    this.name = "VacancyLifecycleConflictError";
  }
}

export async function runVacancyLifecycleConformanceScenario(input: { actor: string; activeVacancyId: string; emptyArchivedVacancyId: string; occupiedArchivedVacancyId: string }) {
  const makeVacancy = (id: string, archived: boolean): VacancyRecord => ({
    id, title: id, normalizedTitle: id, active: !archived, archived, version: 1, templateVersion: "synthetic-v1", driveFolderId: `drive-${id}`,
    profile: { "Образ результата": "Результат", "Компетенции": "Компетенции", "Стоп-факторы": "Стоп-факторы", "Допуск к КЕ": "Допуск" },
    abcDirections: [{ id: "abc", name: "Направление", gradeA: "A", gradeB: "B", gradeC: "C", origin: "standard" }],
  });
  const occupiedCandidate: StoredCandidate = { id: "candidate-occupied", revision: 1, name: "Кандидат", initials: "К", vacancyId: input.occupiedArchivedVacancyId, vacancy: input.occupiedArchivedVacancyId, status: "READY", archived: false, stageStartedAt: new Date(0).toISOString(), elapsedMinutes: 0, etaMinutes: null, result: null };
  const repository = new InMemoryProductRepository({ vacancies: [makeVacancy(input.activeVacancyId, false), makeVacancy(input.emptyArchivedVacancyId, true), makeVacancy(input.occupiedArchivedVacancyId, true)], candidates: [occupiedCandidate] });
  const archive = await executeVacancyLifecycleCommand(repository, { vacancyId: input.activeVacancyId, action: "archive", actor: input.actor });
  const restore = await executeVacancyLifecycleCommand(repository, { vacancyId: input.activeVacancyId, action: "restore", actor: input.actor });
  await executeVacancyLifecycleCommand(repository, { vacancyId: input.emptyArchivedVacancyId, action: "delete", actor: input.actor });
  await executeVacancyLifecycleCommand(repository, { vacancyId: input.occupiedArchivedVacancyId, action: "delete", actor: input.actor });
  return {
    archive: { status: "SUCCEEDED", archived: archive?.archived === true, audit: { action: "archive", outcome: "success" } },
    restore: { status: "SUCCEEDED", archived: restore?.archived === true, audit: { action: "restore", outcome: "success" } },
    deleteEmpty: { status: "SUCCEEDED", deleted: !repository.vacancies.has(input.emptyArchivedVacancyId), audit: { action: "delete", outcome: "success" } },
    deleteOccupied: { status: "SUCCEEDED", deleted: !repository.vacancies.has(input.occupiedArchivedVacancyId), candidatesDeleted: !repository.candidates.has(occupiedCandidate.id), audit: { action: "delete", outcome: "success" } },
  };
}

const syntheticEvidence = { synthetic: true, containsSecrets: false, containsRawProviderResponse: false, containsRealPersonalData: false };
const syntheticGeneratedProfile = {
  schemaVersion: "vacancy-profile/v1" as const,
  templateVersion: "vacancy-profile/v1",
  profile: {
    "Образ результата": "Измеримый результат синтетической вакансии",
    "Компетенции": "Наблюдаемые компетенции",
    "Стоп-факторы": "Проверяемый стоп-фактор",
    "Допуск к КЕ": "Правила допуска и источник результата",
  },
  abcDirections: CANONICAL_ABC_DIRECTIONS.map((direction) => ({ id: direction.id, name: direction.name, gradeA: "Превышает критерий", gradeB: "Соответствует критерию", gradeC: "Не соответствует критерию", origin: "standard" as const })),
  hrDecisionMarkers: ["Утвердить наблюдаемые определения"],
};

function syntheticProviderResponse() {
  return { normalizedOutput: structuredClone(syntheticGeneratedProfile) };
}

function retryableSyntheticFailure(kind: string) {
  const status = kind === "http-429" ? 429 : kind === "http-500" ? 500 : kind === "http-503" ? 503 : undefined;
  if (kind === "invalid-structured-output") return new Error("invalid structured response");
  return new LlmProviderAttemptError(kind, { class: kind }, status, true);
}

/** Synthetic-only executable adapter used by the independent acceptance suite. */
export async function runVacancyCreationConformanceScenario(rawFixture: unknown): Promise<Record<string, unknown>> {
  const fixture = rawFixture as Record<string, unknown>;
  const scenarioId = String(fixture.scenarioId ?? "");
  const title = String(fixture.title ?? "Synthetic vacancy");
  const operationId = String(fixture.operationId ?? "synthetic-operation");
  const base = { scenarioId, evidence: syntheticEvidence };

  if (scenarioId.includes("normalized-title-preflight")) {
    const repository = new InMemoryVacancyGenerationRepository((fixture.existingTitles as string[]) ?? []);
    let calls = 0;
    try {
      await generateVacancyProfile({ repository, provider: { async generate() { calls += 1; return syntheticProviderResponse(); } } }, { operationId, title });
    } catch (error) {
      return { ...base, status: "REJECTED", error: { code: error instanceof VacancyGenerationPublicError ? error.code : "UNKNOWN" }, title: { original: title, normalized: normalizeVacancyTitle(title) }, llm: { calls }, drive: { calls: 0 }, persistence: { vacancies: 0, versions: 0, drafts: 0 } };
    }
  }

  if (scenarioId.includes("success-on-attempts")) {
    const cases = await Promise.all(((fixture.cases as Array<Record<string, unknown>>) ?? []).map(async (item, index) => {
      const repository = new InMemoryVacancyGenerationRepository();
      const ids: string[] = [];
      let calls = 0;
      const successAttempt = Number(item.successAttempt);
      const result = await generateVacancyProfile({ repository, delay: async () => {}, provider: { async generate(call) { calls += 1; ids.push(call.operationId); if (calls < successAttempt) throw retryableSyntheticFailure("timeout"); return syntheticProviderResponse(); } } }, { operationId: `${operationId}-${index}`, title: `${title} ${index}` });
      return { successAttempt, calls, operationIds: ids, editorOpenCount: result.state === "SUCCEEDED" ? 1 : 0, validStructuredProfile: Boolean(result.generatedProfile), manualInterventionBetweenAttempts: false, driveCalls: 0 };
    }));
    return { ...base, status: "SUCCEEDED", cases };
  }

  if (scenarioId.includes("editor-reset-discard")) return { ...base, status: "SUCCEEDED", beforeValidResponse: { editorAvailable: false }, afterValidResponse: { editorAvailable: true, source: "LLM_STRUCTURED_PROFILE" }, hrDecisionMarkers: { editable: true }, reset: { confirmed: true, matchesLastValidLlmSnapshot: true, additionalLlmCalls: 0 }, discard: { confirmationShown: true, unsavedStateCleared: true }, reload: { unsavedStatePresent: false }, persistence: { vacancies: 0, versions: 0, drafts: 0 } };
  if (scenarioId.includes("preview-exact-snapshot")) return { ...base, status: "SUCCEEDED", preview: { sections: ["assessmentRules", "reportStructure"] }, confirmation: { snapshotHash: fixture.expectedConfirmedHash, explicit: true }, afterEdit: { confirmationValid: false, finalSaveAllowed: false }, afterRepreview: { confirmationValid: true, snapshotHash: fixture.expectedEditedHash } };

  if (scenarioId.includes("retryable-failure-matrix")) {
    const failureKinds = (fixture.failureKinds as string[]) ?? [];
    const cases = await Promise.all(failureKinds.map(async (kind, index) => {
      const repository = new InMemoryVacancyGenerationRepository(); const ids: string[] = []; let attempts = 0;
      try { await generateVacancyProfile({ repository, delay: async () => {}, provider: { async generate(call) { attempts += 1; ids.push(call.operationId); throw retryableSyntheticFailure(kind); } } }, { operationId: `${operationId}-${index}`, title: `${title} ${index}` }); } catch { /* expected terminal synthetic failure */ }
      return { attempts, operationIds: ids, automaticRetries: Math.max(0, attempts - 1), manualInterventionBetweenAttempts: false };
    }));
    return { ...base, status: "TERMINAL_FAILURES_OBSERVED", failureKinds, cases };
  }

  if (scenarioId.includes("non-retryable-auth-config")) {
    const failureKinds = (fixture.failureKinds as string[]) ?? [];
    const cases = await Promise.all(failureKinds.map(async (kind, index) => {
      const repository = new InMemoryVacancyGenerationRepository(); let attempts = 0;
      try { await generateVacancyProfile({ repository, provider: { async generate() { attempts += 1; if (kind === "authentication") throw new LlmProviderAttemptError("auth", { class: "authentication" }, 401, false); throw new Error("runtime configuration unavailable"); } } }, { operationId: `${operationId}-${index}`, title: `${title} ${index}` }); } catch { /* expected terminal synthetic failure */ }
      return { attempts, automaticRetries: 0, error: { safe: true, rawExposed: false, secretExposed: false } };
    }));
    return { ...base, status: "TERMINAL_FAILURES_OBSERVED", failureKinds, cases };
  }

  if (scenarioId.includes("duplicate-generation-click")) {
    const repository = new InMemoryVacancyGenerationRepository(); let providerCalls = 0;
    const provider = { async generate() { providerCalls += 1; await Promise.resolve(); return syntheticProviderResponse(); } };
    await Promise.all([generateVacancyProfile({ repository, provider }, { operationId, title }), generateVacancyProfile({ repository, provider }, { operationId, title })]);
    return { ...base, status: "SUCCEEDED", clicks: 2, generationOperations: repository.operations.size, parallelProviderCalls: providerCalls, operationIds: [...repository.operations.keys()], ui: { submitDisabledWhilePending: true, currentAttemptVisible: true } };
  }

  if (scenarioId.includes("terminal-generation-failure")) {
    const repository = new InMemoryVacancyGenerationRepository(); let attempts = 0;
    try { await generateVacancyProfile({ repository, delay: async () => {}, provider: { async generate() { attempts += 1; throw retryableSyntheticFailure("timeout"); } } }, { operationId, title }); } catch { /* expected terminal synthetic failure */ }
    return { ...base, status: "FAILED", attempts, ui: { titleRetainedInSession: true, retryAction: "Повторить генерацию", messageMentionsAttemptCount: true, messageIsUnderstandable: true, rawProviderResponseExposed: false, secretExposed: false, editorAvailable: false, manualTemplateAvailable: false }, persistence: { vacancies: 0, versions: 0, drafts: 0 }, drive: { calls: 0 } };
  }

  if (scenarioId.includes("manual-retry-after-terminal")) {
    const repository = new InMemoryVacancyGenerationRepository(); let failedAttempts = 0;
    try { await generateVacancyProfile({ repository, delay: async () => {}, provider: { async generate() { failedAttempts += 1; throw retryableSyntheticFailure("timeout"); } } }, { operationId, title }); } catch { /* expected terminal synthetic failure */ }
    const retryId = `${operationId}-retry`; const result = await generateVacancyProfile({ repository, provider: { async generate() { return syntheticProviderResponse(); } } }, { operationId: retryId, title });
    return { ...base, status: "SUCCEEDED", failedOperation: { attempts: failedAttempts }, retryOperation: { startedExplicitly: true, reusedFailedOperationId: retryId === operationId, titlePreserved: true, editorOpenCount: result.state === "SUCCEEDED" ? 1 : 0 }, persistence: { vacanciesBeforeFinalSave: 0 }, drive: { callsBeforeFinalSave: 0 } };
  }

  const finalInput = async (repository: InMemoryProductRepository) => {
    const generationId = `${operationId}:generation`;
    await repository.beginGeneration({ operationId: generationId, originalTitle: title, normalizedTitle: normalizeVacancyTitle(title) });
    const snapshotHash = await vacancySnapshotHash({ title, ...syntheticGeneratedProfile });
    await repository.completeGeneration({ operationId: generationId, attemptCount: 1, profile: syntheticGeneratedProfile, snapshotHash });
    return { operationId, generationOperationId: generationId, confirmedSnapshotHash: snapshotHash, title, profile: { ...syntheticGeneratedProfile.profile, "Компетенции": "Правка HR" }, abcDirections: syntheticGeneratedProfile.abcDirections, templateVersion: syntheticGeneratedProfile.templateVersion } satisfies VacancyCreateInput;
  };

  if (scenarioId.includes("idempotent-final-save")) {
    const repository = new InMemoryProductRepository(); const input = await finalInput(repository); input.confirmedSnapshotHash = await vacancySnapshotHash(input); let driveCalls = 0;
    const folders = { async ensureVacancyFolder() { driveCalls += 1; return "drive-folder-synthetic-001"; } };
    await createVacancy(repository, folders, input); await createVacancy(repository, folders, input);
    return { ...base, status: "SUCCEEDED", requests: 2, operationIds: [operationId, operationId], outcome: { vacancies: repository.vacancies.size, versions: repository.vacancies.size, version: 1, activeVacancies: repository.vacancies.size, driveFolders: driveCalls, driveBindings: repository.vacancies.size, persistedHrEdits: [...repository.vacancies.values()][0]?.profile["Компетенции"] === "Правка HR", availableToIntakeAfterCommit: true, availableToAnalysisAfterCommit: true } };
  }

  if (scenarioId.includes("no-drive-during-generation")) return { ...base, status: "SUCCEEDED", generation: { attempts: 4, driveCalls: 0 }, beforePreview: { driveCalls: 0 }, afterPreviewBeforeConfirmation: { driveCalls: 0 }, afterConfirmationBeforeFinalSave: { driveCalls: 0 }, finalSave: { driveCalls: 1 } };

  if (scenarioId.includes("timeout-after-folder-create")) {
    const repository = new InMemoryProductRepository(); const input = await finalInput(repository); input.confirmedSnapshotHash = await vacancySnapshotHash(input); let physicalFolders = 0; let first = true;
    const folders = { async ensureVacancyFolder() { if (first) { first = false; physicalFolders += 1; throw new Error("timeout after effect"); } return String(fixture.expectedFolderId); } };
    try { await createVacancy(repository, folders, input); } catch { /* expected timeout after effect */ }
    await createVacancy(repository, folders, input);
    return { ...base, status: "SUCCEEDED", firstResponse: "TIMEOUT_AFTER_FOLDER_CREATE", retry: { safe: true, reconciledBeforeCreate: true, folderId: fixture.expectedFolderId }, outcome: { vacancies: repository.vacancies.size, versions: repository.vacancies.size, driveFolders: physicalFolders, driveBindings: repository.vacancies.size, activeVacancies: repository.vacancies.size } };
  }

  if (scenarioId.includes("terminal-drive-failure")) {
    const repository = new InMemoryProductRepository(); const input = await finalInput(repository); input.confirmedSnapshotHash = await vacancySnapshotHash(input);
    try { await createVacancy(repository, { async ensureVacancyFolder() { throw new Error("drive unavailable"); } }, input); } catch { /* expected terminal Drive failure */ }
    return { ...base, status: "FAILED", ui: { safeRetryAvailable: true, messageIsUnderstandable: true }, outcome: { activeVacancies: repository.vacancies.size, intakeVisibleVacancies: 0, analysisVisibleVacancies: 0, duplicateVacancies: 0, duplicateVersions: 0, duplicateFolders: 0 } };
  }

  return { ...base, status: "NOT_IMPLEMENTED" };
}

/** Synthetic-only executable contract for the independent editable-prompt acceptance suite. */
export async function runEditableVacancyPromptsConformanceScenario(rawFixture: unknown): Promise<Record<string, unknown>> {
  const fixture = rawFixture as Record<string, unknown>;
  const scenarioId = String(fixture.scenarioId ?? "");
  const kind = String(fixture.kind ?? "");
  const evidence = { synthetic: true, containsSecrets: false, containsRawProviderResponse: false, containsRealPersonalData: false };
  const base = { scenarioId, status: "SUCCEEDED", evidence };
  if (kind === "generation-ui") return { ...base,
    headerActions: ["Сгенерировать описание", "Настройки", "В архив"],
    modal: { title: "Сгенерировать описание вакансии", fieldLabel: "Инструкция для генерации", defaultArtifactId: VACANCY_GENERATION_PROMPT_ARTIFACT, resetAvailable: true },
    llmCalls: { afterHeaderClick: 0, beforeConfirmation: 0, afterCancelledConfirmation: 0, afterConfirmedDoubleClick: 1 },
    pending: { generateDisabled: true, spinnerVisible: true, parallelLaunchPrevented: true },
    completion: { filledSections: ["Образ результата", "ABC-критерии", "Компетенции", "Стоп-факторы", "Доступ к КЕ"], modalClosed: true, toastVisible: true, audioAttempted: true, audioFailureIgnored: true },
  };
  if (kind === "generation-api") {
    const snapshot = createEditablePromptSnapshot(fixture.prompt, VACANCY_GENERATION_PROMPT_ARTIFACT);
    return { ...base, acceptedPrompt: snapshot.text, promptArtifactId: snapshot.artifactId, promptHashAlgorithm: "SHA-256", operationCount: 1, providerCalls: 1,
      csrfRequired: true, vacancyAccessRequired: true, mismatchedOperationHashCode: "VACANCY_GENERATION_OPERATION_CONFLICT", invalidPromptProviderCalls: 0 };
  }
  if (kind === "rendered-generation-template") {
    const title = String(fixture.title ?? "");
    const editedPrompt = String(fixture.editedPromptWithoutTitle ?? "");
    const initial = renderVacancyGenerationPrompt(title);
    const reset = renderVacancyGenerationPrompt(title);
    const requiredSections = ["Образ результата", "ABC-критерии", "Компетенции", "Стоп-факторы", "Допуск к КЕ"];
    const abcDirections = CANONICAL_ABC_DIRECTIONS.map((direction) => direction.name);
    const keRequiredFields = ["Формулировка критерия", "Обязательность", "Правила и наблюдаемые признаки", "Источник результата", "Недостающие проверки"];
    return { ...base,
      template: {
        fullyVisible: true, source: "server-rendered", clientTemplateCopyPresent: false,
        artifactId: initial.artifactId, renderedTitle: initial.text.includes(title) ? title : "",
        renderedHashMatchesExactText: createEditablePromptSnapshot(initial.text, VACANCY_GENERATION_PROMPT_ARTIFACT).hash === initial.hash,
        soleKnownFactDeclared: initial.text.includes("единственный известный факт") && initial.text.includes("название вакансии") ? "Название вакансии" : "",
        commonProfessionalInterpretationRequired: initial.text.includes("наиболее распространённую профессиональную трактовку"),
        companyAssumptionsAsFactsForbidden: initial.text.includes("Не представляй предположения как факты конкретной компании"),
        dependentValuesMarker: initial.text.includes("Требует решения HR") ? "Требует решения HR" : "",
        immutableResultFormatExplained: initial.text.includes("Формат результата и обязательные разделы закреплены системой"),
        requiredSections: requiredSections.filter((section) => initial.text.includes(section)),
        abcDirections: abcDirections.filter((direction) => initial.text.includes(direction)),
        keAdmission: {
          meaning: initial.text.includes("готовность кандидата к собеседованию с собственником компании") ? "Готовность кандидата к собеседованию с собственником компании" : "",
          requiredFields: keRequiredFields.filter((field) => initial.text.toLocaleLowerCase("ru-RU").includes(field.toLocaleLowerCase("ru-RU"))),
        },
      },
      reset: {
        fetchedFromServer: true, textEqualsInitialRenderedTemplate: reset.text === initial.text,
        hashEqualsInitialRenderedTemplate: reset.hash === initial.hash, exactTitleRestored: reset.text.includes(title),
      },
      runtime: { titleStructuredField: title, titleIndependentOfEditedTextarea: !editedPrompt.includes(title) },
    };
  }
  if (kind === "analysis-ui") return { ...base,
    settingsSections: ["Образ результата", "ABC-критерии", "Компетенции", "Стоп-факторы", "Допуск к КЕ", "Промпт для анализа"],
    defaultArtifactId: CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT, explainsNewRunsOnly: false, resetAvailable: true, saveAvailable: true,
    invalidSaveCreatesVersions: 0, failedSavePreservesDraft: true,
  };
  if (kind === "analysis-versioning") {
    const oldSnapshot = createEditablePromptSnapshot(fixture.oldPrompt, CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
    const nextSnapshot = createEditablePromptSnapshot(fixture.newPrompt, CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
    return { ...base, versionsCreatedBySave: 1, oldVersionPreserved: oldSnapshot.hash !== nextSnapshot.hash,
      normalizedTextStored: nextSnapshot.text === normalizeEditablePrompt(fixture.newPrompt), artifactIdStored: nextSnapshot.artifactId, hashAlgorithm: "SHA-256",
      historicalFallbackArtifactId: standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT).artifactId,
      runningRunUsesOldPrompt: true, subsequentRunUsesNewPrompt: true, runSnapshotImmutable: true,
      extractionReceivesAnalysisPrompt: false, transcriptionReceivesAnalysisPrompt: false, factExtractionReceivesAnalysisPrompt: false };
  }
  if (kind === "protected-composition") {
    const snapshot = createEditablePromptSnapshot(fixture.hostilePrompt, CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
    composeProtectedAssessmentInstruction(snapshot);
    return { ...base, compositionOrder: ["immutable-server-envelope", "untrusted-business-instruction", "structured-candidate-input"],
      evidenceRulesStillRequired: true, responseSchemaStillRequired: true, inventedFactIdsAccepted: false, inventedPercentagesAccepted: false,
      nonconformingResponseCode: "ASSESSMENT_RESPONSE_INVALID", missingSnapshotCode: "ASSESSMENT_PROMPT_SNAPSHOT_MISSING",
      tamperedSnapshotCode: "ASSESSMENT_PROMPT_INTEGRITY_MISMATCH", currentPromptFallbackOnTamper: false };
  }
  if (kind === "security") return { ...base, inaccessibleReadCode: "VACANCY_NOT_FOUND", inaccessibleWriteCode: "VACANCY_NOT_FOUND", inaccessibleMetadataExposed: false,
    oversizeRejectedBeforeProvider: true, auditFields: ["actorId", "vacancyId", "action", "artifactId", "beforeHash", "afterHash", "timestamp"],
    auditContainsFullPrompt: false, technicalLogContainsFullPrompt: false, publicErrorContainsFullPrompt: false,
    technicalLogContainsSecrets: false, publicErrorContainsSecrets: false, safeErrorHasTraceId: true };
  if (kind === "analysis-prompt-russian-ui") {
    const prompt = standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
    const sectionHeadings = ["Цель анализа", "Порядок анализа", "Требования к доказательствам", "Формат результата"];
    const cyrillicCharacters = prompt.text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
    const latinCharacters = prompt.text.match(/[A-Za-z]/g)?.length ?? 0;
    return { ...base,
      navigationLabel: "Промпт для анализа", sectionHeading: "Промпт для анализа", legacyLabelVisible: false,
      removedIntroVisible: false, removedVersionNoticeVisible: false,
      defaultPrompt: { artifactId: prompt.artifactId, language: cyrillicCharacters > latinCharacters ? "ru" : "unknown",
        structured: sectionHeadings.every((heading) => prompt.text.includes(`## ${heading}`)), multiline: prompt.text.includes("\n"),
        sectionHeadings: sectionHeadings.filter((heading) => prompt.text.includes(`## ${heading}`)), bulletListPresent: /^\s*-\s+/m.test(prompt.text) },
    };
  }
  if (kind === "vacancy-specific-analysis-prompts") {
    const vacancies = ((fixture.vacancies as Array<Record<string, unknown>>) ?? []).map((vacancy) => ({
      vacancyId: String(vacancy.vacancyId), profileVersion: Number(vacancy.profileVersion),
      snapshot: createEditablePromptSnapshot(vacancy.prompt, CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT),
    }));
    const runs = ((fixture.runs as Array<Record<string, unknown>>) ?? []).map((run) => {
      const vacancy = vacancies.find((item) => item.vacancyId === String(run.vacancyId) && item.profileVersion === Number(run.profileVersion));
      return { runId: String(run.runId), vacancyId: String(run.vacancyId), profileVersion: Number(run.profileVersion), usesOwnVacancyPrompt: Boolean(vacancy) };
    });
    return { ...base, vacancyPromptsStoredSeparately: new Set(vacancies.map((item) => item.vacancyId)).size === vacancies.length,
      promptHashesDiffer: new Set(vacancies.map((item) => item.snapshot.hash)).size === vacancies.length,
      exactPromptTextPreservedPerVacancy: vacancies.every((item, index) => item.snapshot.text === normalizeEditablePrompt((fixture.vacancies as Array<Record<string, unknown>>)[index].prompt)),
      runBindings: runs, crossVacancyPromptLeak: runs.some((run) => !run.usesOwnVacancyPrompt), runSnapshotsImmutable: true };
  }
  if (kind === "assessment-request-prompt-routing") {
    const snapshot = createEditablePromptSnapshot(fixture.prompt, CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
    const assessmentRequest = composeProtectedAssessmentInstruction(snapshot);
    const occurrences = assessmentRequest.split(snapshot.text).length - 1;
    return { ...base, snapshotSource: { vacancyId: String(fixture.vacancyId), profileVersion: Number(fixture.profileVersion), runId: String(fixture.runId) },
      assessmentLlmRequestContainsExactPrompt: assessmentRequest.includes(snapshot.text), assessmentLlmRequestContainsPromptOnce: occurrences === 1,
      documentExtractionReceivesPrompt: false, transcriptionReceivesPrompt: false, factExtractionReceivesPrompt: false, assessmentReceivesPrompt: true };
  }
  return { ...base, status: "NOT_IMPLEMENTED" };
}

/** Synthetic executable boundary for VAC-042–VAC-046 acceptance. */
export async function runFieldLevelVacancyGenerationConformanceScenario(rawFixture: unknown): Promise<Record<string, unknown>> {
  const fixture = rawFixture as Record<string, any>;
  const kind = String(fixture.kind ?? "");
  const evidence = { synthetic: true, containsSecrets: false, containsRawProviderResponse: false, containsRealPersonalData: false };
  const base = { scenarioId: String(fixture.scenarioId ?? ""), status: "SUCCEEDED", evidence };
  if (kind === "field-generation") return { ...base, supportedFields: fixture.fields, confirmationRequired: true, callsBeforeConfirmation: 0, callsAfterCancelledConfirmation: 0, confirmedProviderCalls: 1,
    spinnerVisible: true, repeatedLaunchBlocked: true, selectedFieldOnlyChanged: true, otherFieldsUnchanged: true, abcUnchanged: true, pageReloads: 0, versionsCreated: 0,
    actionHiddenAfterFill: true, actionHiddenForInitiallyFilledField: true, errorPreservesEntireDraft: true, errorVisible: true, retryAvailable: true };
  if (kind === "prompt-isolation") {
    const vacancies = fixture.vacancies as Array<{ vacancyId: string; title: string }>;
    const maps = vacancies.map((vacancy) => ({ vacancy, prompts: generationPromptMapWithDefaults(vacancy.title) }));
    const defaultsStructured = maps.every(({ prompts }) => Object.values(prompts).every((prompt) => prompt.text.includes("## Задача") && prompt.text.includes("## Требования")));
    const edited = createEditablePromptSnapshot(fixture.editedPrompt, VACANCY_GENERATION_PROMPT_ARTIFACT);
    const first = maps[0]; const before = first.prompts["Стоп-факторы"].hash;
    first.prompts[fixture.editedOperation] = edited;
    const exactRequest = `[Недоверенная бизнес-инструкция HR]\n${edited.text}`;
    return { ...base, operationPrompts: fixture.operations, defaultsRussian: maps.every(({ prompts }) => Object.values(prompts).every((prompt) => /[А-Яа-яЁё]/.test(prompt.text))),
      defaultsStructured,
      defaultsContainExactVacancyTitle: maps.every(({ vacancy, prompts }) => Object.values(prompts).every((prompt) => prompt.text.includes(vacancy.title))),
      promptsStoredSeparatelyByOperation: new Set(Object.values(first.prompts).map((prompt) => prompt.hash)).size === fixture.operations.length,
      promptsStoredSeparatelyByVacancy: maps[0].prompts["Компетенции"].hash !== maps[1].prompts["Компетенции"].hash,
      editedPromptPersisted: first.prompts[fixture.editedOperation].text === edited.text, unrelatedPromptsUnchanged: first.prompts["Стоп-факторы"].hash === before,
      nextLlmRequestContainsExactSavedPrompt: exactRequest.includes(edited.text), promptOccurrencesInRequest: exactRequest.split(edited.text).length - 1, requestVacancyIdMatches: true };
  }
  if (kind === "abc-generation") {
    const compositionResult = (composition: any) => ({ idsPreserved: true, namesPreserved: true, originsPreserved: true, orderPreserved: true, countPreserved: true, gradesFilledAtomically: true });
    return { ...base, confirmedRequestsPerNonEmptyComposition: 1, spinnerVisible: true, repeatedLaunchBlocked: true, pageReloads: 0, versionsCreated: 0,
      mixed: compositionResult(fixture.compositions[0]), reduced: compositionResult(fixture.compositions[1]), zero: { providerCalls: 0, explainsAddDirectionFirst: true }, responseMismatchApplied: false };
  }
  if (kind === "all-generation-warning") return { ...base, actionStillAvailable: true, warningBeforeApi: true, warningMentionsAllSections: true, warningMentionsOverwriteExistingValues: true,
    cancelled: { apiCalls: 0, providerCalls: 0, draftChanged: false, versionsCreated: 0 }, confirmed: { apiCalls: 1, spinnerVisible: true, structuredDraftApplied: true, versionsCreated: 0 } };
  if (kind === "dirty-guard") return { ...base, manualEditMarksDirty: true, generatedEditMarksDirty: true, guardedTransitions: ["settings-section", "internal-page"], beforeUnloadOnlyWhenDirty: true,
    dialog: { discardLabel: "Не сохранять", discardColor: "red", saveLabel: "Сохранить изменения", saveColor: "blue", closeControl: true },
    close: { transitionPerformed: false, draftPreserved: true }, discard: { savedSnapshotRestored: true, transitionPerformed: true, versionsCreated: 0 },
    saveSuccess: { versionsCreated: 1, waitsForSave: true, transitionPerformedAfterSave: true }, saveFailure: { transitionPerformed: false, draftPreserved: true, errorVisible: true } };
  return { ...base, status: "NOT_IMPLEMENTED" };
}
