import assert from "node:assert/strict";
import test from "node:test";
import { scenarios } from "./fixtures/matrix-driven-assessment/synthetic-scenarios.mjs";
import { runMatrixDrivenScenario, verifyMatrixDrivenScenario } from "./helpers/matrix-driven-assessment-harness.mjs";

for (const scenario of scenarios) {
  test(`${scenario.scenarioId} [${scenario.requirements.join(", ")}]: ${scenario.oracle.kind}`, async () => {
    const result = await runMatrixDrivenScenario(scenario);
    const failures = verifyMatrixDrivenScenario(result, scenario);
    assert.equal(failures.length, 0, failures.join("\n"));
  });
}
