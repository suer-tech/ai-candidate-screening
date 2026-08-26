import path from "node:path";
import { pathToFileURL } from "node:url";

const adapterPath = path.resolve(import.meta.dirname, "../../server/candidate-pipeline/production-discovery.ts");

export async function runProductionDiscoveryScenario(fixture) {
  let adapter;
  try {
    adapter = await import(`${pathToFileURL(adapterPath).href}?acceptance=${Date.now()}`);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  if (typeof adapter?.runProductionDriveDiscoveryWorkerConformanceScenario !== "function") {
    return {
      scenarioId: fixture.scenarioId,
      status: "NOT_IMPLEMENTED",
      reason: "Production discovery conformance boundary is absent: export runProductionDriveDiscoveryWorkerConformanceScenario(fixture) from server/candidate-pipeline/production-discovery.ts",
      evidence: fixture.evidence,
    };
  }
  return adapter.runProductionDriveDiscoveryWorkerConformanceScenario(structuredClone(fixture));
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, part) => current?.[part], value);
}

export function verify(result, checks) {
  const failures = [];
  if (result?.status === "NOT_IMPLEMENTED") failures.push(result.reason);
  for (const check of checks) {
    const actual = readPath(result, check.path);
    if (!check.accept(actual, result)) failures.push(`${check.path}: ${check.message}; actual=${JSON.stringify(actual)}`);
  }
  return failures;
}

export const equal = (pathName, expected) => ({ path: pathName, accept: (actual) => JSON.stringify(actual) === JSON.stringify(expected), message: `expected ${JSON.stringify(expected)}` });
export const includes = (pathName, expected) => ({ path: pathName, accept: (actual) => Array.isArray(actual) && expected.every((item) => actual.includes(item)), message: `expected to include ${JSON.stringify(expected)}` });
export const every = (pathName, message, predicate) => ({ path: pathName, accept: (actual) => Array.isArray(actual) && actual.length > 0 && actual.every(predicate), message });
