import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scenarios } from "./fixtures/matrix-driven-assessment/synthetic-scenarios.mjs";
import { runMatrixDrivenScenario, toSafeEvidenceCase, verifyMatrixDrivenScenario } from "./helpers/matrix-driven-assessment-harness.mjs";

const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error("Usage: node tests/matrix-driven-assessment.evidence.mjs --output <file>");
const prefixIndex = process.argv.indexOf("--scenario-prefix");
const scenarioPrefix = prefixIndex >= 0 ? process.argv[prefixIndex + 1] : null;
const selectedScenarios = scenarioPrefix ? scenarios.filter((scenario) => scenario.scenarioId.startsWith(scenarioPrefix)) : scenarios;
if (selectedScenarios.length === 0) throw new Error(`No scenarios match prefix ${JSON.stringify(scenarioPrefix)}`);

const cases = [];
for (const scenario of selectedScenarios) {
  const result = await runMatrixDrivenScenario(scenario);
  cases.push(toSafeEvidenceCase(scenario, result, verifyMatrixDrivenScenario(result, scenario)));
}

const evidence = {
  schemaVersion: "matrix-driven-red-evidence/v1",
  change: "implement-matrix-driven-candidate-assessment",
  generatedAtUtc: new Date().toISOString(),
  author: "independent acceptance subagent /root/matrix_acceptance_red",
  independence: "The acceptance author did not implement or edit production code.",
  fixtureSetId: "matrix-driven-assessment-synthetic-v1",
  dataClassification: "synthetic-no-real-candidate-data-no-secrets-no-network-no-provider-expense",
  exactTestCommand: scenarioPrefix === "MDA-REVISED"
    ? "cd web && node --test --test-name-pattern=MDA-REVISED --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/matrix-driven-requiredness-risk-red.junit.xml tests/matrix-driven-assessment.acceptance.test.mjs"
    : "cd web && node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/matrix-driven-assessment-red.junit.xml tests/matrix-driven-assessment.acceptance.test.mjs",
  exactEvidenceCommand: scenarioPrefix === "MDA-REVISED"
    ? "cd web && node tests/matrix-driven-assessment.evidence.mjs --scenario-prefix MDA-REVISED --output tests/acceptance/evidence/matrix-driven-requiredness-risk-red.json"
    : "cd web && node tests/matrix-driven-assessment.evidence.mjs --output tests/acceptance/evidence/matrix-driven-assessment-red.json",
  expectedBaseline: scenarioPrefix === "MDA-REVISED" ? "RED until revised requiredness and independently verified critical-risk behavior is implemented" : "RED until the production conformance adapter and matrix-driven workflow are implemented",
  summary: {
    total: cases.length,
    green: cases.filter((item) => item.status === "GREEN").length,
    red: cases.filter((item) => item.status === "RED").length,
    environmentBlocked: 0,
    externalCalls: cases.reduce((sum, item) => sum + (item.externalCalls ?? 0), 0),
  },
  groups: Object.fromEntries([...new Set(cases.map((item) => item.group))].map((group) => [group, {
    total: cases.filter((item) => item.group === group).length,
    red: cases.filter((item) => item.group === group && item.status === "RED").length,
  }])),
  cases,
};

const target = path.resolve(process.argv[outputIndex + 1]);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: target, summary: evidence.summary }, null, 2));
