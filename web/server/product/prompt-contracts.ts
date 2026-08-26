import { PROMPT_ARTIFACTS } from "../llm/artifacts.ts";
import { artifactHash } from "../llm/value-utils.ts";

export const EDITABLE_PROMPT_MAX_LENGTH = 100_000;
export const VACANCY_GENERATION_PROMPT_ARTIFACT = "vacancy-profile/v1" as const;
export const CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT = "candidate-assessment/v1" as const;
export const VACANCY_TITLE_TEMPLATE_TOKEN = "{{VACANCY_TITLE}}" as const;
export const VACANCY_GENERATION_PROMPT_KEYS = ["Образ результата", "Компетенции", "Стоп-факторы", "Допуск к КЕ", "ABC-критерии"] as const;
export type VacancyGenerationPromptKey = typeof VACANCY_GENERATION_PROMPT_KEYS[number];
export type VacancyGenerationPromptMap = Partial<Record<VacancyGenerationPromptKey, EditablePromptSnapshot<typeof VACANCY_GENERATION_PROMPT_ARTIFACT>>>;

export type EditablePromptArtifactId =
  | typeof VACANCY_GENERATION_PROMPT_ARTIFACT
  | typeof CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT;

export type EditablePromptSnapshot<T extends EditablePromptArtifactId = EditablePromptArtifactId> = {
  text: string;
  artifactId: T;
  hash: string;
};

export class EditablePromptError extends Error {
  readonly code: "PROMPT_REQUIRED" | "PROMPT_TOO_LONG" | "PROMPT_INTEGRITY_MISMATCH";
  constructor(code: "PROMPT_REQUIRED" | "PROMPT_TOO_LONG" | "PROMPT_INTEGRITY_MISMATCH", message: string) {
    super(message);
    this.name = "EditablePromptError";
    this.code = code;
  }
}

export function normalizeEditablePrompt(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

export function createEditablePromptSnapshot<T extends EditablePromptArtifactId>(value: unknown, artifactId: T): EditablePromptSnapshot<T> {
  const text = normalizeEditablePrompt(value);
  if (!text) throw new EditablePromptError("PROMPT_REQUIRED", "Инструкция не должна быть пустой");
  if (text.length > EDITABLE_PROMPT_MAX_LENGTH) throw new EditablePromptError("PROMPT_TOO_LONG", `Инструкция не должна превышать ${EDITABLE_PROMPT_MAX_LENGTH} символов`);
  return { text, artifactId, hash: artifactHash(text) };
}

export function standardEditablePrompt<T extends EditablePromptArtifactId>(artifactId: T): EditablePromptSnapshot<T> {
  return createEditablePromptSnapshot(PROMPT_ARTIFACTS[artifactId].template, artifactId);
}

export function renderVacancyGenerationPrompt(title: unknown): EditablePromptSnapshot<typeof VACANCY_GENERATION_PROMPT_ARTIFACT> {
  const normalizedTitle = typeof title === "string" ? title.trim().replace(/\s+/g, " ") : "";
  if (!normalizedTitle) throw new EditablePromptError("PROMPT_REQUIRED", "Название вакансии обязательно для стандартной инструкции");
  const template = PROMPT_ARTIFACTS[VACANCY_GENERATION_PROMPT_ARTIFACT].template;
  if (!template.includes(VACANCY_TITLE_TEMPLATE_TOKEN)) throw new Error("VACANCY_PROMPT_TEMPLATE_INVALID");
  return createEditablePromptSnapshot(template.replaceAll(VACANCY_TITLE_TEMPLATE_TOKEN, () => normalizedTitle), VACANCY_GENERATION_PROMPT_ARTIFACT);
}

const FIELD_PROMPT_PURPOSE: Record<VacancyGenerationPromptKey, string> = {
  "Образ результата": "Сформируй цель должности, ожидаемые измеримые результаты и наблюдаемый личный вклад сотрудника.",
  "Компетенции": "Сформируй ключевые компетенции, наблюдаемые признаки и ожидаемые доказательства владения навыками.",
  "Стоп-факторы": "Сформируй проверяемые стоп-факторы, условия срабатывания, способ проверки и ожидаемые доказательства.",
  "Допуск к КЕ": "Сформируй критерии готовности кандидата к собеседованию с собственником. Для каждого критерия явно укажи обязательность, правила проверки и недостающие проверки.",
  "ABC-критерии": "Для каждого переданного ABC-направления сформируй конкретные наблюдаемые описания уровней A, B и C, не изменяя направления.",
};

export function renderVacancyFieldGenerationPrompt(title: unknown, key: VacancyGenerationPromptKey) {
  const normalizedTitle = typeof title === "string" ? title.trim().replace(/\s+/g, " ") : "";
  if (!normalizedTitle) throw new EditablePromptError("PROMPT_REQUIRED", "Название вакансии обязательно для стандартной инструкции");
  if (!VACANCY_GENERATION_PROMPT_KEYS.includes(key)) throw new EditablePromptError("PROMPT_REQUIRED", "Операция генерации не поддерживается");
  return createEditablePromptSnapshot(`## Роль\n\nТы — эксперт по проектированию профилей вакансий.\n\n## Вакансия\n\n${normalizedTitle}\n\n## Задача\n\n${FIELD_PROMPT_PURPOSE[key]}\n\n## Требования\n\n- Пиши на русском языке.\n- Используй конкретные, наблюдаемые и проверяемые формулировки.\n- Не выдумывай факты о компании, команде или условиях работы.\n- Верни только структурированный результат по системной схеме.`, VACANCY_GENERATION_PROMPT_ARTIFACT);
}

export function generationPromptMapWithDefaults(title: unknown, stored?: VacancyGenerationPromptMap) {
  return Object.fromEntries(VACANCY_GENERATION_PROMPT_KEYS.map((key) => [key, stored?.[key] ?? renderVacancyFieldGenerationPrompt(title, key)])) as Record<VacancyGenerationPromptKey, EditablePromptSnapshot<typeof VACANCY_GENERATION_PROMPT_ARTIFACT>>;
}

export function verifiedEditablePrompt(snapshot: EditablePromptSnapshot, missingCode = "ASSESSMENT_PROMPT_SNAPSHOT_MISSING", mismatchCode = "ASSESSMENT_PROMPT_INTEGRITY_MISMATCH") {
  if (!snapshot?.text || !snapshot.artifactId || !snapshot.hash) throw new Error(missingCode);
  const normalized = createEditablePromptSnapshot(snapshot.text, snapshot.artifactId);
  if (normalized.hash !== snapshot.hash) throw new Error(mismatchCode);
  return normalized;
}

export function composeProtectedAssessmentInstruction(snapshot: EditablePromptSnapshot) {
  const prompt = verifiedEditablePrompt(snapshot);
  const immutable = PROMPT_ARTIFACTS[CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT].template;
  return [
    `[immutable-server-envelope]\n${immutable}\nВерни только структурированный результат, заданный системным response contract.`,
    `[untrusted-business-instruction]\n${prompt.text}`,
    "[structured-candidate-input]",
  ].join("\n\n");
}
