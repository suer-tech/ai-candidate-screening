import assert from "node:assert/strict";
import test from "node:test";
import { projectVacancyProfileForAssessment } from "./assessment-profile.ts";

const direction = (id: string, grades: [string, string, string]) => ({ id, name: `Направление ${id}`, origin: "standard", gradeA: grades[0], gradeB: grades[1], gradeC: grades[2] });

test("assessment keeps complete ABC rules", () => {
  const projected = projectVacancyProfileForAssessment({ abcDirections: [direction("full", ["A", "B", "C"])] });
  assert.equal(projected?.abcDirections.length, 1);
  assert.deepEqual(projected?.abcUnavailableDirections, []);
});

test("assessment excludes partial ABC rules and identifies them as unavailable", () => {
  const projected = projectVacancyProfileForAssessment({ abcDirections: [direction("full", ["A", "B", "C"]), direction("partial", ["A", "", "C"])] });
  assert.deepEqual(projected?.abcDirections.map((item) => item.id), ["full"]);
  assert.deepEqual(projected?.abcUnavailableDirections, ["Направление partial"]);
});

test("assessment accepts an empty ABC snapshot without inventing directions", () => {
  const projected = projectVacancyProfileForAssessment({ abcDirections: [] });
  assert.deepEqual(projected?.abcDirections, []);
  assert.deepEqual(projected?.abcUnavailableDirections, []);
});
