import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAbcDirectionName,
  type AbcProfileDirection,
  validateAbcProfile,
} from "./abc-profile-validation";

const validDirections = (): AbcProfileDirection[] => [
  {
    id: "standard-productivity",
    name: "Продуктивность",
    gradeA: "Стабильно превосходит ожидаемый результат",
    gradeB: "Выполняет ожидаемый результат",
    gradeC: "Не достигает ожидаемого результата",
    origin: "standard",
  },
  {
    id: "custom-teamwork",
    name: "Командная работа",
    gradeA: "Проактивно устраняет блокеры команды",
    gradeB: "Конструктивно участвует после запроса",
    gradeC: "Игнорирует зависимости команды",
    origin: "custom",
  },
];

test("accepts an empty ABC profile", () => {
  assert.deepEqual(validateAbcProfile([]), { valid: true, errors: [] });
});

for (const blankValue of ["", " \t "]) {
    test("localizes a trimmed-empty name error to its direction and field", () => {
      const directions = validDirections();
      directions[1] = { ...directions[1], name: blankValue };

      const result = validateAbcProfile(directions);

      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.deepEqual(
        { ...result.errors[0], message: undefined },
        {
          code: "abc-direction.field.required",
          level: "field",
          directionId: "custom-teamwork",
          directionIndex: 1,
          field: "name",
          message: undefined,
        },
      );
      assert.match(result.errors[0].message, /название/i);
    });
}

test("accepts empty A, B and C descriptions", () => {
  const directions = validDirections().map((direction) => ({ ...direction, gradeA: "", gradeB: "", gradeC: "" }));
  assert.deepEqual(validateAbcProfile(directions), { valid: true, errors: [] });
});

test("rejects missing or duplicate ids and an invalid origin", () => {
  const directions = validDirections();
  directions[0] = { ...directions[0], id: "same" };
  directions[1] = { ...directions[1], id: "same", origin: "external" as "custom" };
  const result = validateAbcProfile(directions);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code).sort(), ["abc-direction.id.duplicate", "abc-direction.id.duplicate", "abc-direction.origin.invalid"].sort());
});

test("normalizes names only for trim and case-insensitive comparison", () => {
  assert.equal(normalizeAbcDirectionName("  Инициатива\t"), "инициатива");
  assert.equal(normalizeAbcDirectionName("Командная  работа"), "командная  работа");
});

test("reports every direction participating in a normalized duplicate", () => {
  const directions = validDirections();
  directions[0] = { ...directions[0], name: " Инициатива" };
  directions[1] = { ...directions[1], name: "иНиЦиАтИвА  " };

  const result = validateAbcProfile(directions);

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => ({
    code: error.code,
    level: error.level,
    directionId: "directionId" in error ? error.directionId : undefined,
    field: error.field,
  })), [
    { code: "abc-direction.name.duplicate", level: "direction", directionId: "standard-productivity", field: "name" },
    { code: "abc-direction.name.duplicate", level: "direction", directionId: "custom-teamwork", field: "name" },
  ]);
});

test("accepts a complete profile and does not mutate values, identities or order", () => {
  const directions = validDirections();
  const snapshot = structuredClone(directions);
  const identities = [...directions];

  const result = validateAbcProfile(directions);

  assert.deepEqual(result, { valid: true, errors: [] });
  assert.deepEqual(directions, snapshot);
  assert.equal(directions[0], identities[0]);
  assert.equal(directions[1], identities[1]);
});
