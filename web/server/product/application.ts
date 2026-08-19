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
  type CandidateRecord,
  type ResultDocumentType,
  type ResultPair,
  type VacancyCreateInput,
  type VacancyRecord,
} from "../../app/product-model.ts";

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
  candidateId: number;
  vacancyId: string;
  version: number;
  type: ResultDocumentType;
  storageId: string;
  fileName: string;
  published: boolean;
  valid: boolean;
};

export interface ProductRepository {
  isVacancyTitleAvailable(normalizedTitle: string): Promise<boolean>;
  reserveVacancy(input: VacancyCreateInput): Promise<VacancyOperation>;
  commitVacancy(operationId: string, folderId: string): Promise<VacancyRecord>;
  getCandidate(candidateId: number): Promise<StoredCandidate | null>;
  commitCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent): Promise<StoredCandidate>;
  deleteCandidate(candidate: StoredCandidate, expectedRevision: number, audit: AuditEvent): Promise<void>;
  findCurrentResult(principalId: string, candidateId: number, type: ResultDocumentType, version: number): Promise<ResultDocumentDescriptor | null>;
  appendAudit(event: AuditEvent): Promise<void>;
  commitResultPair(candidate: StoredCandidate, expectedRevision: number, descriptors: readonly [ResultDocumentDescriptor, ResultDocumentDescriptor]): Promise<StoredCandidate>;
  dashboardSource(): Promise<{ candidates: CandidateRecord[]; vacancies: VacancyRecord[] }>;
}

export interface VacancyFolderGateway {
  ensureVacancyFolder(input: { operationId: string; vacancyId: string; title: string }): Promise<string>;
}

export interface ResultArtifactGateway {
  readPdf(storageId: string): Promise<Uint8Array>;
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
  const missing = validateFullVacancyProfile(input);
  if (missing.length) throw new ProductConflictError(`Заполните обязательные поля: ${missing.join(", ")}`);

  const operation = await repository.reserveVacancy(input);
  if (operation.state === "committed" && operation.folderId) {
    return repository.commitVacancy(operation.operationId, operation.folderId);
  }
  const folderId = await folders.ensureVacancyFolder({
    operationId: operation.operationId,
    vacancyId: operation.vacancyId,
    title: input.title.trim().replace(/\s+/g, " "),
  });
  if (!folderId.trim()) throw new Error("Google Drive folder binding не подтверждён");
  return repository.commitVacancy(operation.operationId, folderId);
}

type LifecycleAction = "archive" | "restore" | "delete" | "reprocess";

export async function executeLifecycleCommand(
  repository: ProductRepository,
  input: { candidateId: number; action: LifecycleAction; actor: string; expectedRevision: number; timestamp?: string },
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
  input: { principalId: string; candidateId: number; type: ResultDocumentType; version: number; mode: "preview" | "download" },
) {
  const descriptor = await repository.findCurrentResult(input.principalId, input.candidateId, input.type, input.version);
  if (!descriptor || !descriptor.published || !descriptor.valid) {
    throw new ProductNotFoundError("Документ недоступен или не соответствует актуальной версии");
  }
  const bytes = await artifacts.readPdf(descriptor.storageId);
  if (!isPdf(bytes)) throw new ProductNotFoundError("Документ недоступен или повреждён");
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
    candidateId: number;
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
  readonly candidates = new Map<number, StoredCandidate>();
  readonly audits: AuditEvent[] = [];
  readonly tombstones = new Set<number>();
  readonly results = new Map<string, ResultDocumentDescriptor>();

  constructor(seed: { vacancies?: VacancyRecord[]; candidates?: StoredCandidate[]; results?: ResultDocumentDescriptor[] } = {}) {
    seed.vacancies?.forEach((item) => this.vacancies.set(item.id, structuredClone(item)));
    seed.candidates?.forEach((item) => this.candidates.set(item.id, structuredClone(item)));
    seed.results?.forEach((item) => this.results.set(this.resultKey(item.candidateId, item.type, item.version), structuredClone(item)));
  }

  async isVacancyTitleAvailable(normalizedTitle: string) {
    return ![...this.vacancies.values()].some((item) => item.normalizedTitle === normalizedTitle)
      && ![...this.operations.values()].some((item) => item.normalizedTitle === normalizedTitle);
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

  async getCandidate(candidateId: number) {
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

  async findCurrentResult(_principalId: string, candidateId: number, type: ResultDocumentType, version: number) {
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

  private resultKey(candidateId: number, type: ResultDocumentType, version: number) {
    return `${candidateId}:${type}:${version}`;
  }
}
