import type { AbcProfileDirection } from "./abc-profile-validation";

export const WORKFLOW_STATUS = {
  NEW: "Новый",
  WAITING_FOR_STABILITY: "Ожидание стабильности",
  MATERIALS_INCOMPLETE: "Недостаточно материалов",
  MATERIALS_READY: "Материалы готовы",
  TRANSCRIBING: "Транскрибация",
  ANALYZING: "Анализ",
  VALIDATING: "Проверка результата",
  READY: "Готово",
  FAILED: "Ошибка",
} as const;

export type WorkflowStatus = keyof typeof WORKFLOW_STATUS;
export type Recommendation = "Не рекомендовать" | "Недостаточно данных" | "Рекомендовать с оговорками" | "Рекомендовать";
export type ResultDocumentType = "candidate-results" | "abc-test";

export type ResultDocument = {
  id: string;
  type: ResultDocumentType;
  fileName: string;
  version: number;
  candidateId: number;
  vacancyId: string;
  published: boolean;
  valid: boolean;
};

export type ResultPair = {
  version: number;
  completedAt: string;
  summary: string;
  recommendation: Recommendation;
  documents: readonly [ResultDocument, ResultDocument];
};

export type CandidateRecord = {
  id: number;
  name: string;
  initials: string;
  vacancyId: string;
  vacancy: string;
  status: WorkflowStatus;
  archived: boolean;
  stageStartedAt: string;
  elapsedMinutes: number;
  etaMinutes: number | null;
  result: ResultPair | null;
  failedStage?: string;
  failureReason?: string;
  attempts?: number;
  automaticRetriesExhausted?: boolean;
};

export type VacancyRecord = {
  id: string;
  title: string;
  normalizedTitle: string;
  active: true;
  version: 1;
  templateVersion: string;
  driveFolderId: string;
  profile: Record<string, string>;
  abcDirections: AbcProfileDirection[];
};

export type VacancyCreateState = {
  vacancies: VacancyRecord[];
  operationBindings: Record<string, { vacancyId: string; folderId: string }>;
};

export type VacancyCreateInput = {
  operationId: string;
  title: string;
  profile: Record<string, string>;
  abcDirections: AbcProfileDirection[];
  templateVersion: string;
};

export type AuditEvent = {
  action: "archive" | "restore" | "delete" | "reprocess" | "export";
  actor: string;
  candidateId: number;
  timestamp: string;
  outcome: "success" | "rejected";
  details?: string;
};

export type CandidateRun = {
  runId: string;
  resultVersion: number;
  candidateId: number;
  inputVersion: string;
  profileVersion: string;
  startedAt: string;
  reusedStages: string[];
};

const PROCESSING = new Set<WorkflowStatus>(["MATERIALS_READY", "TRANSCRIBING", "ANALYZING", "VALIDATING"]);

export function normalizeVacancyTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

export function validateVacancyTitle(title: string, existing: readonly VacancyRecord[]) {
  const normalized = normalizeVacancyTitle(title);
  if (!normalized) return "Название вакансии обязательно";
  if (existing.some((item) => item.normalizedTitle === normalized)) return "Вакансия с таким названием уже существует";
  return null;
}

export function validateFullVacancyProfile(input: VacancyCreateInput) {
  const missing = ["Образ результата", "Компетенции", "Стоп-факторы", "Допуск к КЕ"].filter((key) => !input.profile[key]?.trim());
  if (!input.abcDirections.length) missing.push("ABC-профиль");
  for (const direction of input.abcDirections) {
    if (![direction.name, direction.gradeA, direction.gradeB, direction.gradeC].every((value) => value.trim())) {
      missing.push(`ABC: ${direction.name || "без названия"}`);
    }
  }
  const names = input.abcDirections.map((item) => normalizeVacancyTitle(item.name));
  if (new Set(names).size !== names.length) missing.push("Уникальные названия ABC-направлений");
  return [...new Set(missing)];
}

export function createVacancyAtomically(state: VacancyCreateState, input: VacancyCreateInput): { state: VacancyCreateState; vacancy: VacancyRecord } {
  const existingBinding = state.operationBindings[input.operationId];
  if (existingBinding) {
    const existing = state.vacancies.find((item) => item.id === existingBinding.vacancyId);
    if (!existing) throw new Error("Нарушена идемпотентная связь операции");
    return { state, vacancy: existing };
  }
  const titleError = validateVacancyTitle(input.title, state.vacancies);
  if (titleError) throw new Error(titleError);
  const missing = validateFullVacancyProfile(input);
  if (missing.length) throw new Error(`Заполните обязательные поля: ${missing.join(", ")}`);
  const sequence = state.vacancies.length + 1;
  const vacancyId = `vac-${String(sequence).padStart(4, "0")}`;
  const folderId = `drive-folder-${vacancyId}`;
  const vacancy: VacancyRecord = {
    id: vacancyId,
    title: input.title.trim().replace(/\s+/g, " "),
    normalizedTitle: normalizeVacancyTitle(input.title),
    active: true,
    version: 1,
    templateVersion: input.templateVersion,
    driveFolderId: folderId,
    profile: structuredClone(input.profile),
    abcDirections: structuredClone(input.abcDirections),
  };
  return {
    vacancy,
    state: {
      vacancies: [...state.vacancies, vacancy],
      operationBindings: { ...state.operationBindings, [input.operationId]: { vacancyId, folderId } },
    },
  };
}

export function isProcessingStatus(status: WorkflowStatus) {
  return PROCESSING.has(status);
}

export function canArchive(candidate: CandidateRecord) {
  return !candidate.archived && !isProcessingStatus(candidate.status);
}

export function canReprocess(candidate: CandidateRecord) {
  return !candidate.archived && (candidate.status === "READY" || (candidate.status === "FAILED" && candidate.automaticRetriesExhausted === true));
}

export function archiveCandidate(candidate: CandidateRecord) {
  if (!canArchive(candidate)) throw new Error("Архивирование доступно после завершения обработки");
  return { ...candidate, archived: true };
}

export function restoreCandidate(candidate: CandidateRecord) {
  if (!candidate.archived) throw new Error("Кандидат не находится в архиве");
  return { ...candidate, archived: false };
}

export function deleteArchivedCandidate(candidate: CandidateRecord) {
  if (!candidate.archived) throw new Error("Окончательное удаление доступно только после архивации");
  return { candidateId: candidate.id, deletedApplicationData: true, driveOperation: null, tombstone: { candidateId: candidate.id } };
}

export function executeCandidateLifecycleCommand(candidate: CandidateRecord, action: "archive" | "restore" | "delete", actor: string, timestamp = new Date().toISOString()) {
  try {
    const value = action === "archive" ? archiveCandidate(candidate) : action === "restore" ? restoreCandidate(candidate) : deleteArchivedCandidate(candidate);
    return { value, audit: { action, actor, candidateId: candidate.id, timestamp, outcome: "success" } satisfies AuditEvent };
  } catch (error) {
    return { value: candidate, audit: { action, actor, candidateId: candidate.id, timestamp, outcome: "rejected", details: error instanceof Error ? error.message : "rejected" } satisfies AuditEvent };
  }
}

export function beginManualReprocess(candidate: CandidateRecord, now = new Date().toISOString()) {
  if (!canReprocess(candidate)) throw new Error("Повторная обработка сейчас недоступна");
  return { ...candidate, status: "WAITING_FOR_STABILITY" as const, stageStartedAt: now, elapsedMinutes: 0, etaMinutes: null, result: null };
}

export function createVersionedCandidateRun(candidate: CandidateRecord, binding: { inputVersion: string; profileVersion: string }, now = new Date().toISOString()): CandidateRun {
  const nextVersion = (candidate.result?.version ?? 0) + 1;
  return { runId: `run-${candidate.id}-v${String(nextVersion).padStart(4, "0")}`, resultVersion: nextVersion, candidateId: candidate.id, inputVersion: binding.inputVersion, profileVersion: binding.profileVersion, startedAt: now, reusedStages: [] };
}

export function selectReusableStages(completed: readonly string[], failedStage: string, inputsChanged: boolean) {
  if (inputsChanged) return [];
  return completed.filter((stage) => stage !== failedStage && ["EXTRACTION", "OCR", "TRANSCRIPTION"].includes(stage));
}

export function completeCandidateStabilityCheck(candidate: CandidateRecord, stableAndComplete: boolean, binding: { inputVersion: string; profileVersion: string }, now = new Date().toISOString()) {
  if (candidate.status !== "WAITING_FOR_STABILITY") throw new Error("Проверка стабильности не была запрошена");
  if (!stableAndComplete) return { candidate, run: null };
  const run = createVersionedCandidateRun(candidate, binding, now);
  return { candidate: { ...candidate, status: "MATERIALS_READY" as const, stageStartedAt: now }, run };
}

export async function createVacancyWithDrive(state: VacancyCreateState, input: VacancyCreateInput, provisionFolder: (context: { operationId: string; vacancyId: string; title: string }) => Promise<string>) {
  const bound = state.operationBindings[input.operationId];
  if (bound) return createVacancyAtomically(state, input);
  const titleError = validateVacancyTitle(input.title, state.vacancies);
  if (titleError) throw new Error(titleError);
  const missing = validateFullVacancyProfile(input);
  if (missing.length) throw new Error(`Заполните обязательные поля: ${missing.join(", ")}`);
  const vacancyId = `vac-${String(state.vacancies.length + 1).padStart(4, "0")}`;
  const folderId = await provisionFolder({ operationId: input.operationId, vacancyId, title: input.title.trim() });
  if (!folderId) throw new Error("Google Drive folder binding не подтверждён");
  const created = createVacancyAtomically(state, input);
  const vacancy = { ...created.vacancy, driveFolderId: folderId };
  return { vacancy, state: { vacancies: [...state.vacancies, vacancy], operationBindings: { ...state.operationBindings, [input.operationId]: { vacancyId: vacancy.id, folderId } } } };
}

export function validateResultPair(candidate: CandidateRecord) {
  if (candidate.status !== "READY" || !candidate.result) return false;
  const [first, second] = candidate.result.documents;
  return first.type !== second.type && [first, second].every((document) => document.candidateId === candidate.id && document.vacancyId === candidate.vacancyId && document.version === candidate.result?.version && document.published && document.valid);
}

export function getGreeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Yekaterinburg", hour: "2-digit", hourCycle: "h23" }).format(date));
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 18) return "Добрый день";
  return "Добрый вечер";
}

export function buildDashboardSnapshot(candidates: readonly CandidateRecord[], vacancies: readonly VacancyRecord[], period: 7 | 30 | 90, asOf = new Date()) {
  const current = candidates.filter((candidate) => !candidate.archived);
  const archivedCandidates = candidates.filter((candidate) => candidate.archived).length;
  const counts = {
    MATERIALS_INCOMPLETE: current.filter((item) => item.status === "MATERIALS_INCOMPLETE").length,
    TRANSCRIBING: current.filter((item) => item.status === "TRANSCRIBING").length,
    ANALYZING: current.filter((item) => item.status === "ANALYZING").length,
    VALIDATING: current.filter((item) => item.status === "VALIDATING").length,
    READY: current.filter((item) => item.status === "READY").length,
    FAILED: current.filter((item) => item.status === "FAILED").length,
  };
  const queue = current.filter((item) => item.status === "FAILED" || isProcessingStatus(item.status)).sort((a, b) => {
    if (a.status === "FAILED" && b.status !== "FAILED") return -1;
    if (b.status === "FAILED" && a.status !== "FAILED") return 1;
    return Date.parse(a.stageStartedAt) - Date.parse(b.stageStartedAt);
  }).slice(0, 5);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(asOf).map((part) => [part.type, part.value]));
  const localMidnightUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 5 * 60 * 60 * 1_000;
  const startMs = localMidnightUtc - (period - 1) * 24 * 60 * 60 * 1_000;
  const endMs = localMidnightUtc + 24 * 60 * 60 * 1_000 - 1;
  const ready = current.filter((item) => {
    const completedAt = item.result ? Date.parse(item.result.completedAt) : Number.NaN;
    return validateResultPair(item) && completedAt >= startMs && completedAt <= endMs;
  });
  const recommendations = Object.fromEntries(["Не рекомендовать", "Недостаточно данных", "Рекомендовать с оговорками", "Рекомендовать"].map((name) => [name, ready.filter((item) => item.result?.recommendation === name).length])) as Record<Recommendation, number>;
  const flow = vacancies.filter((item) => item.active).map((vacancy) => ({ vacancyId: vacancy.id, title: vacancy.title, count: ready.filter((item) => item.vacancyId === vacancy.id).length }));
  return { asOf: asOf.toISOString(), period, counts, archivedCandidates, queue, ready, recommendations, flow };
}
