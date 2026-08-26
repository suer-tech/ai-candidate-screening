import path from "node:path";
import { pathToFileURL } from "node:url";

const adapterPath = path.resolve(import.meta.dirname, "../../server/product/application.ts");
let adapterPromise;

async function loadAdapter() {
  if (!adapterPromise) adapterPromise = import(pathToFileURL(adapterPath).href);
  return adapterPromise;
}

export async function runEditableVacancyPromptsScenario(fixture) {
  const adapter = await loadAdapter();
  if (typeof adapter.runEditableVacancyPromptsConformanceScenario !== "function") {
    return {
      scenarioId: fixture.scenarioId,
      status: "NOT_IMPLEMENTED",
      reason: "Editable vacancy prompts conformance boundary is absent: export runEditableVacancyPromptsConformanceScenario(fixture) from server/product/application.ts",
      evidence: { synthetic: true, containsSecrets: false, containsRawProviderResponse: false, containsRealPersonalData: false },
    };
  }
  const result = await adapter.runEditableVacancyPromptsConformanceScenario(structuredClone(fixture));
  if (!result || typeof result !== "object") throw new TypeError(`Editable vacancy prompts adapter returned no result for ${fixture.scenarioId}`);
  return result;
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

export function verifyEditableVacancyPromptsOracle(actual, oracle) {
  const mismatches = [];
  if (actual?.status === "NOT_IMPLEMENTED") mismatches.push(actual.reason ?? `Acceptance scenario is not implemented: ${actual?.scenarioId ?? "unknown"}`);
  compare(actual, oracle, "", mismatches);
  const safety = actual?.evidence;
  if (safety?.synthetic !== true) mismatches.push("evidence.synthetic: expected true");
  for (const field of ["containsSecrets", "containsRawProviderResponse", "containsRealPersonalData"]) {
    if (safety?.[field] !== false) mismatches.push(`evidence.${field}: expected false`);
  }
  return mismatches;
}

export { adapterPath };
