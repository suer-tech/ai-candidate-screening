import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSE_SCHEMA_ARTIFACTS } from "../server/llm/artifacts.ts";
import { matrixResponseSchemaForProfile } from "../server/llm/matrix-response-schema.ts";
import { validateMatrixWithPydanticAi } from "../server/candidate-pipeline/pydantic-matrix-validator.ts";
import type { JsonValue } from "../server/llm/value-utils.ts";

const context = { sourceFragments: { "vacancy.result.goal": "Редакционный план" } };
const schema = JSON.parse(JSON.stringify(matrixResponseSchemaForProfile("matrix_compiler",
  RESPONSE_SCHEMA_ARTIFACTS["vacancy-matrix-draft/v1"], context).schema)) as JsonValue;
const criterion = {
  temporaryId: "criterion-1", sourceRefs: ["vacancy.result.goal"], sourceText: "Редакционный план",
  interpretation: "Проверить опыт", category: "competency", required: true,
  requiredExplanation: "Указано в вакансии", hardRequired: false, operator: "ALL_OF", atLeast: null,
  evaluationRule: "Нужен пример", expectedEvidence: ["План"],
  allowedStates: ["Соответствует", "Не соответствует", "Недостаточно данных"],
  decisionEffect: "required-gap", missingDataQuestion: "Как составляли план?", interpretationNotes: [], children: [],
};
const draft = { schemaVersion: "vacancy-matrix-draft/v1", criteria: [criterion] };
const criticSchema = JSON.parse(JSON.stringify(matrixResponseSchemaForProfile("matrix_critic",
  RESPONSE_SCHEMA_ARTIFACTS["vacancy-matrix-critic/v2"], context).schema)) as JsonValue;

async function validate(output: unknown) {
  return validateMatrixWithPydanticAi({ capability: "matrix_compiler", schema, output: output as JsonValue,
    sourceRefs: ["vacancy.result.goal"] });
}

test("PydanticAI parses a complete vacancy matrix", async () => {
  await assert.doesNotReject(validate(draft));
});

test("PydanticAI rejects a missing required matrix field", async () => {
  const { requiredExplanation: _omitted, ...incomplete } = criterion;
  await assert.rejects(validate({ ...draft, criteria: [incomplete] }), /MATRIX_CRITERIA_INVALID/);
});

test("PydanticAI rejects an empty question and an unknown vacancy source", async () => {
  await assert.rejects(validate({ ...draft, criteria: [{ ...criterion, missingDataQuestion: " " }] }), /MATRIX_MISSING_QUESTION_INVALID/);
  await assert.rejects(validate({ ...draft, criteria: [{ ...criterion, sourceRefs: ["vacancy.unknown"] }] }), /MATRIX_SOURCE_REF_INVALID/);
});

test("PydanticAI rejects duplicated decision points", async () => {
  await assert.rejects(validate({ ...draft, criteria: [criterion, { ...criterion, temporaryId: "criterion-2" }] }), /MATRIX_OVER_SPLIT/);
});

test("PydanticAI validates the critic's complete successor", async () => {
  const critic = { schemaVersion: "vacancy-matrix-critic/v2", decision: "PASS", changes: [],
    successor: draft, interpretationNotes: [] };
  const input = (output: unknown) => validateMatrixWithPydanticAi({ capability: "matrix_critic", schema: criticSchema,
    output: output as JsonValue, sourceRefs: ["vacancy.result.goal"] });
  await assert.doesNotReject(input(critic));
  await assert.rejects(input({ ...critic, successor: { ...draft, criteria: [{ ...criterion, missingDataQuestion: "" }] } }),
    /MATRIX_MISSING_QUESTION_INVALID/);
});
