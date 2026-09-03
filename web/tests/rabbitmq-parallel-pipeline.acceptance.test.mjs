import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { scenarios } from "./fixtures/rabbitmq-parallel-pipeline/synthetic-acceptance.mjs";
import { runRabbitAcceptanceScenario, startRabbitAcceptanceInfrastructure, verifyRabbitAcceptanceResult } from "./helpers/rabbitmq-parallel-pipeline-harness.mjs";

let infrastructure;

before(async () => {
  infrastructure = await startRabbitAcceptanceInfrastructure();
});

after(async () => {
  await infrastructure?.stop();
});

for (const fixture of Object.values(scenarios)) {
  test(`${fixture.scenarioId}: RabbitMQ parallel candidate pipeline acceptance`, async () => {
    const result = await runRabbitAcceptanceScenario(structuredClone(fixture), infrastructure);
    const failures = verifyRabbitAcceptanceResult(result, fixture);
    assert.equal(failures.length, 0, `${failures.join("\n")}\nobserved=${JSON.stringify(result)}`);
  });
}
