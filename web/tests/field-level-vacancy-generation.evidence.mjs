import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cases } from "./fixtures/field-level-vacancy-generation/synthetic-conformance.mjs";
import { runFieldLevelVacancyGenerationScenario, verifyFieldLevelVacancyGenerationOracle } from "./helpers/field-level-vacancy-generation-conformance-harness.mjs";

const output = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : "tests/acceptance/evidence/field-level-vacancy-generation-red.json";
const results = [];
for (const item of cases) {
  const actual = await runFieldLevelVacancyGenerationScenario(item.fixture);
  const mismatches = verifyFieldLevelVacancyGenerationOracle(actual, item.oracle);
  results.push({ scenarioId: item.fixture.scenarioId, requirements: item.requirements, title: item.title, status: mismatches.length ? "RED" : "GREEN", classification: "product-contract", mismatches });
}
const summary = { total: results.length, green: results.filter((item) => item.status === "GREEN").length, red: results.filter((item) => item.status === "RED").length, infrastructureErrors: 0 };
const phase = summary.red ? "RED" : "GREEN";
const evidence = {
  schemaVersion: "field-level-vacancy-generation-acceptance-evidence/v1", change: "add-field-level-vacancy-generation", generatedAtUtc: new Date().toISOString(), phase,
  author: "/root/analysis_prompt_acceptance", executor: "/root/analysis_prompt_acceptance", independenceDeclared: true, productionCodeChangedByAuthor: false,
  command: `node tests/field-level-vacancy-generation.evidence.mjs --output ${output}`,
  junit: output.replace(/\.json$/i, ".junit.xml"),
  safety: { fixtureSetId: "field-level-vacancy-generation-synthetic-v1", syntheticOnly: true, containsSecrets: false, containsRealPersonalData: false, providerCallsAllowed: false },
  summary, results,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ output, summary })}\n`);
if (phase === "RED") process.exitCode = 1;
