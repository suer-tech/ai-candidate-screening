import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cases, normalizedSyntheticPrompt, secretSentinels, syntheticPrompt } from "./fixtures/editable-vacancy-prompts/synthetic-conformance.mjs";
import { runEditableVacancyPromptsScenario, verifyEditableVacancyPromptsOracle } from "./helpers/editable-vacancy-prompts-conformance-harness.mjs";

const output = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : "tests/acceptance/evidence/editable-vacancy-prompts-red.json";
const scenarioFilter = process.argv.includes("--scenario") ? process.argv[process.argv.indexOf("--scenario") + 1] : null;
const scenarioPrefix = process.argv.includes("--scenario-prefix") ? process.argv[process.argv.indexOf("--scenario-prefix") + 1] : null;
const evidenceAuthor = process.argv.includes("--author") ? process.argv[process.argv.indexOf("--author") + 1] : "/root/prompt_acceptance";
const selectedCases = scenarioFilter
  ? cases.filter((item) => item.fixture.scenarioId === scenarioFilter)
  : scenarioPrefix
    ? cases.filter((item) => item.title.startsWith(scenarioPrefix))
    : cases;
if (scenarioFilter && selectedCases.length !== 1) throw new Error(`UNKNOWN_ACCEPTANCE_SCENARIO:${scenarioFilter}`);
if (scenarioPrefix && selectedCases.length === 0) throw new Error(`UNKNOWN_ACCEPTANCE_SCENARIO_PREFIX:${scenarioPrefix}`);
const results = [];
for (const item of selectedCases) {
  const actual = await runEditableVacancyPromptsScenario(item.fixture);
  const mismatches = verifyEditableVacancyPromptsOracle(actual, item.oracle);
  results.push({ scenarioId: item.fixture.scenarioId, requirements: item.requirements, title: item.title, status: mismatches.length ? "RED" : "GREEN", classification: "product-contract", mismatches });
}

const summary = { total: results.length, green: results.filter((item) => item.status === "GREEN").length, red: results.filter((item) => item.status === "RED").length, infrastructureErrors: 0 };
const phase = summary.red === 0 && summary.infrastructureErrors === 0 ? "GREEN" : "RED";
const evidence = {
  schemaVersion: "editable-vacancy-prompts-acceptance-evidence/v1",
  change: "add-editable-vacancy-prompts",
  generatedAtUtc: new Date().toISOString(),
  phase,
  author: evidenceAuthor,
  executor: evidenceAuthor,
  independenceDeclared: true,
  productionCodeChangedByAuthor: false,
  command: `node tests/editable-vacancy-prompts.evidence.mjs${scenarioFilter ? ` --scenario ${scenarioFilter}` : ""}${scenarioPrefix ? ` --scenario-prefix ${JSON.stringify(scenarioPrefix)}` : ""}${evidenceAuthor !== "/root/prompt_acceptance" ? ` --author ${evidenceAuthor}` : ""} --output ${output}`,
  junit: output.replace(/\.json$/i, ".junit.xml"),
  safety: { fixtureSetId: "editable-vacancy-prompts-synthetic-v1", scenarioFilter, scenarioPrefix, syntheticOnly: true, containsSecrets: false, containsRealPersonalData: false, providerCallsAllowed: false },
  summary,
  results,
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
const forbiddenEvidenceSentinels = [...secretSentinels, syntheticPrompt, normalizedSyntheticPrompt];
if (forbiddenEvidenceSentinels.some((sentinel) => serialized.includes(sentinel))) throw new Error("PROMPT_EVIDENCE_SENTINEL_LEAK");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, serialized, "utf8");
process.stdout.write(`${JSON.stringify({ output, summary })}\n`);
if (phase === "RED") process.exitCode = 1;
