import path from "node:path";
import { pathToFileURL } from "node:url";

const adapterPath = path.resolve(import.meta.dirname, "../../server/product/application.ts");
let adapterPromise;

async function loadAdapter() {
  if (!adapterPromise) adapterPromise = import(pathToFileURL(adapterPath).href);
  return adapterPromise;
}

export async function runFieldLevelVacancyGenerationScenario(fixture) {
  const adapter = await loadAdapter();
  if (typeof adapter.runFieldLevelVacancyGenerationConformanceScenario !== "function") return {
    scenarioId: fixture.scenarioId, status: "NOT_IMPLEMENTED",
    reason: "Field-level vacancy generation conformance boundary is absent: export runFieldLevelVacancyGenerationConformanceScenario(fixture) from server/product/application.ts",
    evidence: { synthetic: true, containsSecrets: false, containsRawProviderResponse: false, containsRealPersonalData: false },
  };
  return adapter.runFieldLevelVacancyGenerationConformanceScenario(structuredClone(fixture));
}

function compare(actual, expected, pathName, mismatches) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(`${pathName}: expected exact ${JSON.stringify(expected)}; actual=${JSON.stringify(actual)}`);
    return;
  }
  if (expected && typeof expected === "object") {
    for (const [key, value] of Object.entries(expected)) compare(actual?.[key], value, pathName ? `${pathName}.${key}` : key, mismatches);
    return;
  }
  if (actual !== expected) mismatches.push(`${pathName}: expected ${JSON.stringify(expected)}; actual=${JSON.stringify(actual)}`);
}

export function verifyFieldLevelVacancyGenerationOracle(actual, oracle) {
  const mismatches = [];
  if (actual?.status === "NOT_IMPLEMENTED") mismatches.push(actual.reason);
  compare(actual, oracle, "", mismatches);
  if (actual?.evidence?.synthetic !== true) mismatches.push("evidence.synthetic: expected true");
  for (const key of ["containsSecrets", "containsRawProviderResponse", "containsRealPersonalData"]) if (actual?.evidence?.[key] !== false) mismatches.push(`evidence.${key}: expected false`);
  return mismatches;
}
