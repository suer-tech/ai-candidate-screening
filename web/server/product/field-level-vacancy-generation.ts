import type { AbcProfileDirection } from "../../app/abc-profile-validation.ts";
import type { ProviderAttemptResult } from "../llm/gateway.ts";
import { createEditablePromptSnapshot, type EditablePromptSnapshot, type VacancyGenerationPromptKey, VACANCY_GENERATION_PROMPT_ARTIFACT } from "./prompt-contracts.ts";

export type FieldGenerationResult = { field: Exclude<VacancyGenerationPromptKey, "ABC-критерии">; text: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GENERATION_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}

function output(value: ProviderAttemptResult | unknown) {
  const envelope = record(value);
  return record(envelope.normalizedOutput ?? envelope.parsedOutput ?? value);
}

export function validateFieldGenerationResult(value: unknown, field: FieldGenerationResult["field"]): FieldGenerationResult {
  const source = output(value);
  const keys = Object.keys(source);
  if (keys.length !== 3 || source.schemaVersion !== "vacancy-field/v1" || source.field !== field || typeof source.text !== "string" || !source.text.trim()) throw new Error("GENERATION_RESPONSE_INVALID");
  return { field, text: source.text.replace(/\r\n?/g, "\n").trim() };
}

export function validateAbcGenerationResult(value: unknown, directions: readonly AbcProfileDirection[]): AbcProfileDirection[] {
  const source = output(value);
  if (Object.keys(source).length !== 2 || source.schemaVersion !== "vacancy-abc/v1" || !Array.isArray(source.abcDirections) || source.abcDirections.length !== directions.length) throw new Error("GENERATION_RESPONSE_INVALID");
  const received = source.abcDirections.map(record);
  return directions.map((direction, index) => {
    const item = received[index];
    if (item.id !== direction.id || Object.keys(item).some((key) => !["id", "gradeA", "gradeB", "gradeC"].includes(key))) throw new Error("GENERATION_RESPONSE_MISMATCH");
    for (const key of ["gradeA", "gradeB", "gradeC"] as const) if (typeof item[key] !== "string" || !item[key].trim()) throw new Error("GENERATION_RESPONSE_INVALID");
    return { ...direction, gradeA: String(item.gradeA).trim(), gradeB: String(item.gradeB).trim(), gradeC: String(item.gradeC).trim() };
  });
}

export function promptSnapshot(value: unknown): EditablePromptSnapshot<typeof VACANCY_GENERATION_PROMPT_ARTIFACT> {
  return createEditablePromptSnapshot(value, VACANCY_GENERATION_PROMPT_ARTIFACT);
}
