import {
  normalizeVacancyTitle,
  validateFullVacancyProfile,
  type VacancyCreateInput,
} from "../../app/product-model.ts";
import { LlmProviderAttemptError, type ProviderAttemptResult } from "../llm/gateway.ts";
import { createEditablePromptSnapshot, renderVacancyGenerationPrompt, type EditablePromptSnapshot, VACANCY_GENERATION_PROMPT_ARTIFACT } from "./prompt-contracts.ts";

export const VACANCY_GENERATION_SCHEMA_VERSION = "vacancy-profile/v1";
export const VACANCY_GENERATION_MAX_ATTEMPTS = 4;

export const CANONICAL_ABC_DIRECTIONS = [
  { id: "productivity", name: "Продуктивность", question: "Есть ли подтверждённые результаты? Что кандидат реально сделал? Есть ли измеримый результат?" },
  { id: "initiative", name: "Инициатива", question: "Сам инициирует улучшения или работает только по поставленным задачам? Есть ли реальные кейсы проявления инициативы?" },
  { id: "self-learning", name: "Самообучаемость", question: "Как кандидат осваивает новые направления? Есть ли примеры самостоятельного изучения и применения новых знаний?" },
  { id: "corporate-values", name: "Корпоративные ценности", question: "Насколько модель поведения кандидата соответствует требованиям компании и роли?" },
  { id: "autonomy", name: "Автономность", question: "Можно ли передать человеку блок и получить результат без постоянного контроля?" },
] as const;

export type GeneratedVacancyProfile = Pick<VacancyCreateInput, "profile" | "abcDirections" | "templateVersion"> & {
  schemaVersion: typeof VACANCY_GENERATION_SCHEMA_VERSION;
  hrDecisionMarkers: string[];
};

export type VacancyGenerationState = "PENDING" | "SUCCEEDED" | "FAILED";

export type VacancyGenerationOperation = {
  operationId: string;
  originalTitle: string;
  normalizedTitle: string;
  state: VacancyGenerationState;
  attemptCount: number;
  generatedProfile?: GeneratedVacancyProfile;
  snapshotHash?: string;
  errorCode?: VacancyGenerationErrorCode;
  promptHash?: string;
  promptArtifactId?: string;
};

export type VacancyGenerationErrorCode =
  | "VACANCY_TITLE_REQUIRED"
  | "VACANCY_TITLE_DUPLICATE"
  | "VACANCY_GENERATION_AUTH"
  | "VACANCY_GENERATION_CONFIG"
  | "VACANCY_GENERATION_OPERATION_CONFLICT"
  | "VACANCY_GENERATION_EXHAUSTED";

export class VacancyGenerationPublicError extends Error {
  readonly code: VacancyGenerationErrorCode;
  readonly attempts: number;
  constructor(
    code: VacancyGenerationErrorCode,
    message: string,
    attempts: number,
  ) {
    super(message);
    this.name = "VacancyGenerationPublicError";
    this.code = code;
    this.attempts = attempts;
  }
}

export interface VacancyGenerationRepository {
  isVacancyTitleAvailable(normalizedTitle: string): Promise<boolean>;
  beginGeneration(input: { operationId: string; originalTitle: string; normalizedTitle: string; promptHash?: string; promptArtifactId?: string }): Promise<{ operation: VacancyGenerationOperation; owner: boolean }>;
  recordGenerationAttempt(input: { operationId: string; attempt: number; outcome: "started" | "retryable_failure" | "terminal_failure" | "succeeded"; safeCode?: string; traceId?: string }): Promise<void>;
  completeGeneration(input: { operationId: string; attemptCount: number; profile: GeneratedVacancyProfile; snapshotHash: string }): Promise<VacancyGenerationOperation>;
  failGeneration(input: { operationId: string; attemptCount: number; errorCode: VacancyGenerationErrorCode }): Promise<VacancyGenerationOperation>;
  getGeneration(operationId: string): Promise<VacancyGenerationOperation | null>;
  appendVacancyAudit(event: { operationId: string; type: string; attempt?: number; safeCode?: string; actor: string; timestamp: string }): Promise<void>;
}

export interface VacancyProfileProvider {
  generate(input: { operationId: string; attempt: number; title: string; prompt: EditablePromptSnapshot }): Promise<ProviderAttemptResult | unknown>;
}

export interface VacancyGenerationAuditSink {
  append(event: { operationId: string; type: string; attempt?: number; safeCode?: string; timestamp: string }): Promise<void>;
}

const noAudit: VacancyGenerationAuditSink = { async append() {} };

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid structured response");
  return value as Record<string, unknown>;
}

function parsedProviderOutput(value: ProviderAttemptResult | unknown): unknown {
  const envelope = requiredRecord(value);
  return envelope.normalizedOutput ?? envelope.parsedOutput ?? value;
}

const GENERATED_LABELS: Readonly<Record<string, string>> = {
  positionGoal: "Цель должности", measurableResults: "Измеримые результаты", result: "Результат", metrics: "Метрики",
  personalContribution: "Личный вклад", expectedChanges: "Ожидаемые изменения", period: "Период", changes: "Изменения",
  scale: "Масштаб", interactionScope: "Область взаимодействия", workloadIndicators: "Показатели нагрузки", relevantExperience: "Релевантный опыт",
  keyCompetencies: "Ключевые компетенции", criticalProfessionalSkills: "Критические профессиональные навыки", name: "Название",
  observableIndicators: "Наблюдаемые признаки", expectedEvidence: "Ожидаемые доказательства", verifiedConditions: "Проверяемые условия",
  factor: "Фактор", verification: "Проверка", automaticRejectionReasons: "Причины автоматического отказа",
  riskFactorsRequiringAdditionalVerification: "Риски, требующие дополнительной проверки", checklist: "Чек-лист", status: "Статус",
  criterion: "Критерий", readyWhen: "Признаки готовности", admissionRules: "Правила допуска", admit: "Допустить",
  doNotAdmit: "Не допускать", conditionalAdmission: "Условный допуск", finalAdmission: "Итог допуска", requiredToComplete: "Что требуется дополнить",
  цельДолжности: "Цель должности", измеримыеРезультаты: "Измеримые результаты", результат: "Результат", метрики: "Метрики",
  личныйВклад: "Личный вклад", ожидаемыеИзменения: "Ожидаемые изменения", масштабИРелевантность: "Масштаб и релевантность",
  ключевыеКомпетенции: "Ключевые компетенции", критичныеПрофессиональныеНавыки: "Критические профессиональные навыки",
  название: "Название", навык: "Навык", наблюдаемыеПризнаки: "Наблюдаемые признаки", условие: "Условие",
  какПроверить: "Как проверить", ожидаемыеДоказательства: "Ожидаемые доказательства", чекЛист: "Чек-лист",
  критерий: "Критерий", статус: "Статус", требование: "Требование", итогДопуска: "Итог допуска", чтоТребуетсяДополнить: "Что требуется дополнить",
};

function generatedLabel(key: string): string {
  if (GENERATED_LABELS[key]) return GENERATED_LABELS[key];
  const spaced = key.replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

function generatedScalar(value: string | number | boolean): string {
  return String(value).replace(/\s+/g, " ").trim();
}

function generatedNode(value: unknown, indent: number): string {
  const padding = " ".repeat(indent);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return `${padding}${generatedScalar(value)}`;
  if (Array.isArray(value)) return value.map((item) => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return `${padding}• ${generatedScalar(item)}`;
    const entries = item && typeof item === "object" && !Array.isArray(item) ? Object.entries(item as Record<string, unknown>) : [];
    if (!entries.length) return "";
    return entries.map(([key, entryValue], index) => {
      const prefix = index === 0 ? `${padding}• ` : " ".repeat(indent + 2);
      const label = generatedLabel(key);
      if (typeof entryValue === "string" || typeof entryValue === "number" || typeof entryValue === "boolean") return `${prefix}${label}: ${generatedScalar(entryValue)}`;
      return `${prefix}${label}:\n${generatedNode(entryValue, indent + 4)}`;
    }).filter(Boolean).join("\n");
  }).filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    const label = generatedLabel(key);
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return `${padding}${label}: ${generatedScalar(item)}`;
    return `${padding}${label}:\n${generatedNode(item, indent + 2)}`;
  }).filter(Boolean).join("\n");
  return "";
}

function generatedText(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const label = generatedLabel(key);
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return `${label}: ${generatedScalar(item)}`;
      return `${label}:\n${generatedNode(item, 2)}`;
    }).filter(Boolean).join("\n\n").trim();
  }
  return generatedNode(value, 0).trim();
}

const GENERATED_PROFILE_SECTIONS = [
  { name: "Образ результата", aliases: ["resultImage"] },
  { name: "Компетенции", aliases: ["competencies"] },
  { name: "Стоп-факторы", aliases: ["stopFactors"] },
  { name: "Допуск к КЕ", aliases: ["keAdmission"] },
] as const;

function normalizedGeneratedProfile(profile: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(GENERATED_PROFILE_SECTIONS.map((section) => {
    const key = [section.name, ...section.aliases].find((candidate) => Object.prototype.hasOwnProperty.call(profile, candidate));
    return [section.name, generatedText(key ? profile[key] : undefined)];
  }));
}

export function validateGeneratedVacancyProfile(value: unknown): GeneratedVacancyProfile {
  const source = requiredRecord(parsedProviderOutput(value));
  const profile = requiredRecord(source.profile);
  if (!Array.isArray(source.abcDirections)) throw new Error("invalid structured response");
  if (source.abcDirections.length !== CANONICAL_ABC_DIRECTIONS.length) throw new Error("invalid structured response: canonical ABC directions required");
  const candidate: VacancyCreateInput = {
    operationId: "validation-only",
    title: "validation-only",
    profile: normalizedGeneratedProfile(profile),
    abcDirections: source.abcDirections.map((item, index) => {
      const direction = requiredRecord(item);
      const canonical = CANONICAL_ABC_DIRECTIONS[index];
      const generatedName = generatedText(direction.name);
      if (generatedName !== canonical.name && !generatedName.startsWith(`${canonical.name}:`)) throw new Error("invalid structured response: canonical ABC directions required");
      return {
        id: canonical.id,
        name: canonical.name,
        gradeA: generatedText(direction.gradeA),
        gradeB: generatedText(direction.gradeB),
        gradeC: generatedText(direction.gradeC),
        origin: direction.origin === "custom" ? "custom" as const : "standard" as const,
      };
    }),
    templateVersion: typeof source.templateVersion === "string" && source.templateVersion.trim()
      ? source.templateVersion.trim()
      : VACANCY_GENERATION_SCHEMA_VERSION,
  };
  const missing = validateFullVacancyProfile(candidate);
  if (missing.length) throw new Error(`invalid structured response: ${missing.join(", ")}`);
  return {
    schemaVersion: VACANCY_GENERATION_SCHEMA_VERSION,
    profile: candidate.profile,
    abcDirections: candidate.abcDirections,
    templateVersion: candidate.templateVersion,
    hrDecisionMarkers: Array.isArray(source.hrDecisionMarkers)
      ? source.hrDecisionMarkers.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function vacancySnapshotHash(input: { title: string; profile: Record<string, string>; abcDirections: VacancyCreateInput["abcDirections"]; templateVersion: string }) {
  const bytes = new TextEncoder().encode(stableJson({
    title: input.title.trim().replace(/\s+/g, " "),
    profile: input.profile,
    abcDirections: input.abcDirections,
    templateVersion: input.templateVersion,
  }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

type FailureClass = { retryable: boolean; publicCode: VacancyGenerationErrorCode; safeCode: string };

export function classifyVacancyGenerationFailure(error: unknown): FailureClass {
  if (error instanceof VacancyGenerationPublicError) return { retryable: false, publicCode: error.code, safeCode: error.code };
  if (error instanceof LlmProviderAttemptError) {
    const status = Number(error.providerStatus);
    if (status === 401 || status === 403) return { retryable: false, publicCode: "VACANCY_GENERATION_AUTH", safeCode: "provider_authentication" };
    if (error.retryable === false && status >= 400 && status < 500 && status !== 429) {
      return { retryable: false, publicCode: "VACANCY_GENERATION_CONFIG", safeCode: "provider_configuration" };
    }
    return { retryable: error.retryable !== false || status === 429 || status >= 500, publicCode: "VACANCY_GENERATION_EXHAUSTED", safeCode: status ? `provider_${status}` : "provider_failure" };
  }
  if (error instanceof SyntaxError || (error instanceof Error && /invalid structured response/i.test(error.message))) {
    return { retryable: true, publicCode: "VACANCY_GENERATION_EXHAUSTED", safeCode: "invalid_structured_output" };
  }
  if (error instanceof Error && /config|credential|secret|endpoint/i.test(error.message)) {
    return { retryable: false, publicCode: "VACANCY_GENERATION_CONFIG", safeCode: "runtime_configuration" };
  }
  return { retryable: true, publicCode: "VACANCY_GENERATION_EXHAUSTED", safeCode: "network_or_timeout" };
}

export async function generateVacancyProfile(
  dependencies: {
    repository: VacancyGenerationRepository;
    provider: VacancyProfileProvider;
    audit?: VacancyGenerationAuditSink;
    delay?: (milliseconds: number) => Promise<void>;
    retryDelayMs?: number;
    clock?: () => Date;
  },
  input: { operationId: string; title: string; vacancyId?: string; prompt?: unknown },
) {
  const originalTitle = typeof input.title === "string" ? input.title : "";
  const normalizedTitle = normalizeVacancyTitle(originalTitle);
  if (!normalizedTitle) throw new VacancyGenerationPublicError("VACANCY_TITLE_REQUIRED", "Название вакансии обязательно", 0);
  if (!input.vacancyId && !await dependencies.repository.isVacancyTitleAvailable(normalizedTitle)) {
    throw new VacancyGenerationPublicError("VACANCY_TITLE_DUPLICATE", "Вакансия с таким названием уже существует", 0);
  }
  if (!input.operationId?.trim()) throw new VacancyGenerationPublicError("VACANCY_GENERATION_CONFIG", "Не удалось начать формирование вакансии", 0);
  let prompt: EditablePromptSnapshot;
  try { prompt = input.prompt === undefined ? renderVacancyGenerationPrompt(originalTitle) : createEditablePromptSnapshot(input.prompt, VACANCY_GENERATION_PROMPT_ARTIFACT); }
  catch { throw new VacancyGenerationPublicError("VACANCY_GENERATION_CONFIG", "Проверьте инструкцию для генерации", 0); }

  const { operation, owner } = await dependencies.repository.beginGeneration({ operationId: input.operationId, originalTitle, normalizedTitle, promptHash: prompt.hash, promptArtifactId: prompt.artifactId });
  if (!owner) {
    if (operation.state === "SUCCEEDED") return operation;
    if (operation.state === "FAILED") throw new VacancyGenerationPublicError(operation.errorCode ?? "VACANCY_GENERATION_EXHAUSTED", "Профиль вакансии не сформирован. Повторите генерацию.", operation.attemptCount);
    return operation;
  }

  const audit = dependencies.audit ?? noAudit;
  const clock = dependencies.clock ?? (() => new Date());
  const delay = dependencies.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastClass: FailureClass = { retryable: true, publicCode: "VACANCY_GENERATION_EXHAUSTED", safeCode: "provider_failure" };
  for (let attempt = 1; attempt <= VACANCY_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    await dependencies.repository.recordGenerationAttempt({ operationId: input.operationId, attempt, outcome: "started" });
    await audit.append({ operationId: input.operationId, type: "generation_attempt_started", attempt, timestamp: clock().toISOString() });
    try {
      const response = await dependencies.provider.generate({ operationId: input.operationId, attempt, title: originalTitle.trim().replace(/\s+/g, " "), prompt });
      const profile = validateGeneratedVacancyProfile(response);
      const snapshotHash = await vacancySnapshotHash({ title: originalTitle, ...profile });
      await dependencies.repository.recordGenerationAttempt({ operationId: input.operationId, attempt, outcome: "succeeded" });
      await audit.append({ operationId: input.operationId, type: "generation_succeeded", attempt, timestamp: clock().toISOString() });
      return dependencies.repository.completeGeneration({ operationId: input.operationId, attemptCount: attempt, profile, snapshotHash });
    } catch (error) {
      lastClass = classifyVacancyGenerationFailure(error);
      await dependencies.repository.recordGenerationAttempt({ operationId: input.operationId, attempt, outcome: lastClass.retryable ? "retryable_failure" : "terminal_failure", safeCode: lastClass.safeCode });
      await audit.append({ operationId: input.operationId, type: "generation_attempt_failed", attempt, safeCode: lastClass.safeCode, timestamp: clock().toISOString() });
      if (!lastClass.retryable || attempt === VACANCY_GENERATION_MAX_ATTEMPTS) {
        await dependencies.repository.failGeneration({ operationId: input.operationId, attemptCount: attempt, errorCode: lastClass.publicCode });
        const message = lastClass.publicCode === "VACANCY_GENERATION_AUTH" || lastClass.publicCode === "VACANCY_GENERATION_CONFIG"
          ? "Формирование вакансии временно недоступно из-за настройки сервиса"
          : `Описание вакансии не удалось сформировать после ${attempt} попыток`;
        throw new VacancyGenerationPublicError(lastClass.publicCode, message, attempt);
      }
      await delay(Math.max(0, dependencies.retryDelayMs ?? 0));
    }
  }
  throw new VacancyGenerationPublicError(lastClass.publicCode, "Профиль вакансии не сформирован", VACANCY_GENERATION_MAX_ATTEMPTS);
}

export class InMemoryVacancyGenerationRepository implements VacancyGenerationRepository {
  readonly operations = new Map<string, VacancyGenerationOperation>();
  readonly attempts: Array<{ operationId: string; attempt: number; outcome: string; safeCode?: string }> = [];
  readonly audit: Array<{ operationId: string; type: string; attempt?: number; safeCode?: string; actor: string; timestamp: string }> = [];
  readonly existingTitles: string[];
  constructor(existingTitles: string[] = []) { this.existingTitles = existingTitles; }
  async isVacancyTitleAvailable(normalizedTitle: string) {
    return !this.existingTitles.map(normalizeVacancyTitle).includes(normalizedTitle);
  }
  async beginGeneration(input: { operationId: string; originalTitle: string; normalizedTitle: string; promptHash?: string; promptArtifactId?: string }) {
    const defaults = renderVacancyGenerationPrompt(input.originalTitle);
    const normalizedInput = { ...input, promptHash: input.promptHash ?? defaults.hash, promptArtifactId: input.promptArtifactId ?? defaults.artifactId };
    const existing = this.operations.get(input.operationId);
    if (existing) {
      if (existing.promptHash !== normalizedInput.promptHash) throw new VacancyGenerationPublicError("VACANCY_GENERATION_OPERATION_CONFLICT", "Операция уже связана с другой инструкцией", existing.attemptCount);
      return { operation: structuredClone(existing), owner: false };
    }
    const operation: VacancyGenerationOperation = { ...normalizedInput, state: "PENDING", attemptCount: 0 };
    this.operations.set(input.operationId, operation);
    return { operation: structuredClone(operation), owner: true };
  }
  async recordGenerationAttempt(input: { operationId: string; attempt: number; outcome: "started" | "retryable_failure" | "terminal_failure" | "succeeded"; safeCode?: string }) {
    this.attempts.push(input);
    const operation = this.operations.get(input.operationId);
    if (operation) operation.attemptCount = Math.max(operation.attemptCount, input.attempt);
  }
  async completeGeneration(input: { operationId: string; attemptCount: number; profile: GeneratedVacancyProfile; snapshotHash: string }) {
    const operation = this.operations.get(input.operationId)!;
    Object.assign(operation, { state: "SUCCEEDED" as const, attemptCount: input.attemptCount, generatedProfile: structuredClone(input.profile), snapshotHash: input.snapshotHash });
    return structuredClone(operation);
  }
  async failGeneration(input: { operationId: string; attemptCount: number; errorCode: VacancyGenerationErrorCode }) {
    const operation = this.operations.get(input.operationId)!;
    Object.assign(operation, { state: "FAILED" as const, attemptCount: input.attemptCount, errorCode: input.errorCode });
    return structuredClone(operation);
  }
  async getGeneration(operationId: string) {
    const operation = this.operations.get(operationId);
    return operation ? structuredClone(operation) : null;
  }
  async appendVacancyAudit(event: { operationId: string; type: string; attempt?: number; safeCode?: string; actor: string; timestamp: string }) {
    this.audit.push(structuredClone(event));
  }
}
