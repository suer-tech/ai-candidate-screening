import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const adapterPath = path.resolve(import.meta.dirname, "../../server/agent-runtime/conformance.ts");

let adapterPromise;

async function loadAdapter() {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      try {
        await access(adapterPath);
      } catch {
        return null;
      }
      const loadedModule = await import(pathToFileURL(adapterPath).href);
      if (typeof loadedModule.runAgentRuntimeConformanceScenario !== "function") {
        throw new TypeError(
          "Agent runtime conformance contract is incomplete: export runAgentRuntimeConformanceScenario(fixture) from server/agent-runtime/conformance.ts",
        );
      }
      return loadedModule;
    })();
  }
  return adapterPromise;
}

export async function runConformanceScenario(fixture) {
  const adapter = await loadAdapter();
  if (!adapter) {
    return {
      scenarioId: fixture.scenarioId,
      status: "NOT_IMPLEMENTED",
      reason: `Durable agent runtime conformance adapter is absent at ${adapterPath}`,
      timeline: [],
      evidence: { synthetic: true, containsSecrets: false, containsRealPersonalData: false },
    };
  }
  const result = await adapter.runAgentRuntimeConformanceScenario(structuredClone(fixture));
  if (!result || typeof result !== "object") {
    throw new TypeError(`Conformance adapter returned no result for ${fixture.scenarioId}`);
  }
  return result;
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, part) => current?.[part], value);
}

export function verify(result, checks) {
  const failures = [];
  for (const check of checks) {
    const actual = readPath(result, check.path);
    let accepted = false;
    try {
      accepted = check.accept(actual, result);
    } catch (error) {
      failures.push(`${check.path}: validator threw ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!accepted) failures.push(`${check.path}: ${check.message}; actual=${JSON.stringify(actual)}`);
  }
  if (result.status === "NOT_IMPLEMENTED") failures.unshift(result.reason);
  return failures;
}

export function equal(pathName, expected) {
  return { path: pathName, accept: (actual) => JSON.stringify(actual) === JSON.stringify(expected), message: `expected ${JSON.stringify(expected)}` };
}

export function includes(pathName, expected) {
  return { path: pathName, accept: (actual) => Array.isArray(actual) && expected.every((item) => actual.includes(item)), message: `expected to include ${JSON.stringify(expected)}` };
}

export function satisfies(pathName, message, predicate) {
  return { path: pathName, accept: predicate, message };
}

export { adapterPath };
