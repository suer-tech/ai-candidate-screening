import type { AbcProfileDirection } from "../../app/abc-profile-validation.ts";

function completeDirection(value: unknown): value is AbcProfileDirection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const direction = value as Record<string, unknown>;
  return [direction.id, direction.name, direction.gradeA, direction.gradeB, direction.gradeC]
    .every((field) => typeof field === "string" && field.trim().length > 0)
    && (direction.origin === "standard" || direction.origin === "custom");
}

export function projectVacancyProfileForAssessment(vacancy: Record<string, unknown> | null) {
  if (!vacancy) return null;
  const sourceDirections = Array.isArray(vacancy.abcDirections) ? vacancy.abcDirections : [];
  const abcDirections = sourceDirections.filter(completeDirection).map((direction) => ({ ...direction }));
  const abcUnavailableDirections = sourceDirections.flatMap((value) => {
    if (completeDirection(value) || !value || typeof value !== "object" || Array.isArray(value)) return [];
    const direction = value as Record<string, unknown>;
    return typeof direction.name === "string" && direction.name.trim() ? [direction.name.trim()] : [];
  });
  return { ...vacancy, abcDirections, abcUnavailableDirections };
}
