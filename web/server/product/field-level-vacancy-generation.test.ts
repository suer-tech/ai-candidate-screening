import assert from "node:assert/strict";
import test from "node:test";
import { validateAbcGenerationResult, validateFieldGenerationResult } from "./field-level-vacancy-generation.ts";
import { generationPromptMapWithDefaults, VACANCY_GENERATION_PROMPT_KEYS } from "./prompt-contracts.ts";
import { exactVacancyFieldResponseSchema } from "../llm/artifacts.ts";
import { strictSchemaErrors } from "../llm/strict-schema.ts";

const directions = [
  { id: "standard-productivity", name: "Продуктивность", origin: "standard" as const, gradeA: "", gradeB: "", gradeC: "" },
  { id: "custom-care", name: "Забота", origin: "custom" as const, gradeA: "", gradeB: "", gradeC: "" },
];

test("five default prompts are Russian, structured, vacancy-specific snapshots", () => {
  const title = "Руководитель клиентского сервиса";
  const prompts = generationPromptMapWithDefaults(title);
  assert.deepEqual(Object.keys(prompts), [...VACANCY_GENERATION_PROMPT_KEYS]);
  for (const snapshot of Object.values(prompts)) {
    assert.match(snapshot.text, /[А-Яа-яЁё]/);
    assert.match(snapshot.text, /## Задача[\s\S]+## Требования/);
    assert.match(snapshot.text, new RegExp(title));
  }
  assert.equal(new Set(Object.values(prompts).map((snapshot) => snapshot.hash)).size, 5);
});

test("field response changes exactly the requested field", () => {
  const schema = exactVacancyFieldResponseSchema("Компетенции");
  assert.deepEqual(strictSchemaErrors(schema.schema), []);
  assert.equal(((schema.schema as Record<string, any>).properties.field as Record<string, unknown>).const, "Компетенции");
  assert.deepEqual(validateFieldGenerationResult({ normalizedOutput: { schemaVersion: "vacancy-field/v1", field: "Компетенции", text: "  Наблюдаемый навык  " } }, "Компетенции"), { field: "Компетенции", text: "Наблюдаемый навык" });
  assert.throws(() => validateFieldGenerationResult({ normalizedOutput: { schemaVersion: "vacancy-field/v1", field: "Стоп-факторы", text: "x" } }, "Компетенции"), /GENERATION_RESPONSE_INVALID/);
  assert.throws(() => validateFieldGenerationResult({ normalizedOutput: { schemaVersion: "vacancy-field/v1", field: "Компетенции", text: "x", extra: true } }, "Компетенции"), /GENERATION_RESPONSE_INVALID/);
});

test("ABC response preserves identity, name, origin, order and applies all grades atomically", () => {
  const output = { normalizedOutput: { schemaVersion: "vacancy-abc/v1", abcDirections: directions.map((direction) => ({ id: direction.id, gradeA: `A ${direction.id}`, gradeB: `B ${direction.id}`, gradeC: `C ${direction.id}` })) } };
  const result = validateAbcGenerationResult(output, directions);
  assert.deepEqual(result.map(({ id, name, origin }) => ({ id, name, origin })), directions.map(({ id, name, origin }) => ({ id, name, origin })));
  assert.ok(result.every((direction) => direction.gradeA && direction.gradeB && direction.gradeC));
  assert.throws(() => validateAbcGenerationResult({ normalizedOutput: { schemaVersion: "vacancy-abc/v1", abcDirections: [...output.normalizedOutput.abcDirections].reverse() } }, directions), /GENERATION_RESPONSE_MISMATCH/);
  assert.deepEqual(directions.map(({ gradeA, gradeB, gradeC }) => ({ gradeA, gradeB, gradeC })), [{ gradeA: "", gradeB: "", gradeC: "" }, { gradeA: "", gradeB: "", gradeC: "" }]);
});
