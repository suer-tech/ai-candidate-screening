import path from "node:path";
import { pathToFileURL } from "node:url";

const authAdapterPath = path.resolve(import.meta.dirname, "../../server/auth/conformance.ts");
const uiAdapterPath = path.resolve(import.meta.dirname, "../../app/auth/login-conformance.ts");

async function load(pathname) {
  try {
    return await import(pathToFileURL(pathname).href);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  }
}

function missing(scenarioId, reason) {
  return {
    scenarioId,
    status: "NOT_IMPLEMENTED",
    reason,
    evidence: {
      synthetic: true,
      containsRealPersonalData: false,
      containsCredentials: false,
      containsSessionTokens: false,
      containsCsrfSecrets: false,
      containsPlaintextSourceIdentifiers: false,
    },
  };
}

export async function runAuthScenario(fixture) {
  const adapter = await load(authAdapterPath);
  if (typeof adapter?.runEmailPasswordAuthConformanceScenario !== "function") {
    return missing(fixture.scenarioId, "Email/password auth conformance boundary is absent: export runEmailPasswordAuthConformanceScenario(fixture) from server/auth/conformance.ts");
  }
  return adapter.runEmailPasswordAuthConformanceScenario(structuredClone(fixture));
}

export async function runLoginUiScenario(fixture) {
  const adapter = await load(uiAdapterPath);
  if (typeof adapter?.runEmailPasswordLoginUiConformanceScenario !== "function") {
    return missing(fixture.scenarioId, "Login UI conformance boundary is absent: export runEmailPasswordLoginUiConformanceScenario(fixture) from app/auth/login-conformance.ts");
  }
  return adapter.runEmailPasswordLoginUiConformanceScenario(structuredClone(fixture));
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, part) => current?.[part], value);
}

export function verify(result, checks) {
  const failures = [];
  if (result?.status === "NOT_IMPLEMENTED") failures.push(result.reason);
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

export function none(pathName, forbidden) {
  return { path: pathName, accept: (actual) => Array.isArray(actual) && forbidden.every((item) => !actual.some((entry) => String(entry).startsWith(item))), message: `must not include product requests matching ${JSON.stringify(forbidden)}` };
}
