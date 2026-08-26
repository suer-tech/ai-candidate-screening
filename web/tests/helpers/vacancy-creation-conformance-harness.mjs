import path from "node:path";
import { pathToFileURL } from "node:url";

const adapterPath = path.resolve(import.meta.dirname, "../../server/product/application.ts");
let adapterPromise;

async function loadAdapter() {
  if (!adapterPromise) adapterPromise = import(pathToFileURL(adapterPath).href);
  return adapterPromise;
}

export async function runVacancyCreationScenario(fixture) {
  const adapter = await loadAdapter();
  if (typeof adapter.runVacancyCreationConformanceScenario !== "function") {
    return {
      scenarioId: fixture.scenarioId,
      status: "NOT_IMPLEMENTED",
      reason: "Create-vacancy LLM conformance boundary is absent: export runVacancyCreationConformanceScenario(fixture) from server/product/application.ts",
      evidence: { synthetic: true, containsSecrets: false, containsRawProviderResponse: false, containsRealPersonalData: false },
      timeline: [],
    };
  }
  const result = await adapter.runVacancyCreationConformanceScenario(structuredClone(fixture));
  if (!result || typeof result !== "object") throw new TypeError(`Vacancy creation conformance adapter returned no result for ${fixture.scenarioId}`);
  return result;
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, part) => current?.[part], value);
}

export function verify(result, checks) {
  const failures = [];
  if (result.status === "NOT_IMPLEMENTED") failures.push(result.reason);
  for (const check of checks) {
    const actual = readPath(result, check.path);
    let accepted = false;
    try { accepted = check.accept(actual, result); }
    catch (error) { failures.push(`${check.path}: validator threw ${error instanceof Error ? error.message : String(error)}`); continue; }
    if (!accepted) failures.push(`${check.path}: ${check.message}; actual=${JSON.stringify(actual)}`);
  }
  return failures;
}

export function equal(pathName, expected) {
  return { path: pathName, accept: (actual) => JSON.stringify(actual) === JSON.stringify(expected), message: `expected ${JSON.stringify(expected)}` };
}

export function includes(pathName, expected) {
  return { path: pathName, accept: (actual) => Array.isArray(actual) && expected.every((item) => actual.includes(item)), message: `expected to include ${JSON.stringify(expected)}` };
}

export function every(pathName, message, predicate) {
  return { path: pathName, accept: (actual) => Array.isArray(actual) && actual.length > 0 && actual.every(predicate), message };
}

export { adapterPath };
