export type AbcDirectionField = "name" | "gradeA" | "gradeB" | "gradeC";

export type AbcDirectionOrigin = "standard" | "custom";

export type AbcProfileDirection = {
  readonly id: string;
  readonly name: string;
  readonly gradeA: string;
  readonly gradeB: string;
  readonly gradeC: string;
  readonly origin: AbcDirectionOrigin;
};

type DirectionValidationError = {
  readonly code: "abc-direction.name.duplicate";
  readonly level: "direction";
  readonly directionId: string;
  readonly directionIndex: number;
  readonly field: "name";
  readonly message: string;
};

type FieldValidationError = {
  readonly code: "abc-direction.field.required" | "abc-direction.id.duplicate" | "abc-direction.origin.invalid";
  readonly level: "field";
  readonly directionId: string;
  readonly directionIndex: number;
  readonly field: AbcDirectionField | "id" | "origin";
  readonly message: string;
};

export type AbcProfileValidationError =
  | DirectionValidationError
  | FieldValidationError;

export type AbcProfileValidationResult = {
  readonly valid: boolean;
  readonly errors: readonly AbcProfileValidationError[];
};

const FIELD_LABELS: Record<AbcDirectionField, string> = {
  name: "название",
  gradeA: "определение A",
  gradeB: "определение B",
  gradeC: "определение C",
};

export function normalizeAbcDirectionName(name: string): string {
  return name.trim().toLocaleLowerCase("ru");
}

export function validateAbcProfile(
  directions: readonly AbcProfileDirection[],
): AbcProfileValidationResult {
  const errors: AbcProfileValidationError[] = [];
  const normalizedNames = directions.map((direction) => normalizeAbcDirectionName(typeof direction?.name === "string" ? direction.name : ""));
  const idIndexes = new Map<string, number[]>();

  directions.forEach((direction, directionIndex) => {
    const id = typeof direction?.id === "string" ? direction.id.trim() : "";
    if (!id) errors.push({ code: "abc-direction.field.required", level: "field", directionId: id, directionIndex, field: "id", message: `Не задан идентификатор ABC-направления ${directionIndex + 1}.` });
    else idIndexes.set(id, [...(idIndexes.get(id) ?? []), directionIndex]);
    if (direction?.origin !== "standard" && direction?.origin !== "custom") errors.push({ code: "abc-direction.origin.invalid", level: "field", directionId: id, directionIndex, field: "origin", message: `Некорректный источник ABC-направления ${directionIndex + 1}.` });
    (["name"] as const).forEach((field) => {
      if (typeof direction?.[field] === "string" && direction[field].trim().length > 0) return;
      errors.push({
        code: "abc-direction.field.required",
        level: "field",
        directionId: direction.id,
        directionIndex,
        field,
        message: `Заполните ${FIELD_LABELS[field]} для ABC-направления ${directionIndex + 1}.`,
      });
    });
  });

  idIndexes.forEach((indexes, id) => {
    if (indexes.length < 2) return;
    indexes.forEach((directionIndex) => errors.push({ code: "abc-direction.id.duplicate", level: "field", directionId: id, directionIndex, field: "id", message: `Идентификатор ABC-направления «${id}» повторяется.` }));
  });

  const indexesByName = new Map<string, number[]>();
  normalizedNames.forEach((name, directionIndex) => {
    if (name.length === 0) return;
    const indexes = indexesByName.get(name) ?? [];
    indexes.push(directionIndex);
    indexesByName.set(name, indexes);
  });

  indexesByName.forEach((directionIndexes) => {
    if (directionIndexes.length < 2) return;
    directionIndexes.forEach((directionIndex) => {
      const direction = directions[directionIndex];
      errors.push({
        code: "abc-direction.name.duplicate",
        level: "direction",
        directionId: direction.id,
        directionIndex,
        field: "name",
        message: `Название ABC-направления «${direction.name}» повторяется. Используйте уникальное название.`,
      });
    });
  });

  return { valid: errors.length === 0, errors };
}
