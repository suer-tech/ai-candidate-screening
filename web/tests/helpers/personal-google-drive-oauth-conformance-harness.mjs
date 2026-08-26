import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { forbiddenEvidenceValues } from "../fixtures/personal-google-drive-oauth/synthetic-conformance.mjs";

export const adapterPath = path.resolve(import.meta.dirname, "../../server/google-drive-oauth/conformance.ts");

let adapterPromise;

async function loadAdapter() {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      try {
        await access(adapterPath);
      } catch {
        return null;
      }
      const loaded = await import(pathToFileURL(adapterPath).href);
      if (typeof loaded.runPersonalGoogleDriveOAuthConformanceScenario !== "function") {
        throw new TypeError("TST-120 conformance adapter must export runPersonalGoogleDriveOAuthConformanceScenario(fixture)");
      }
      return loaded;
    })();
  }
  return adapterPromise;
}

export async function runPersonalGoogleDriveOAuthConformanceScenario(fixture) {
  const adapter = await loadAdapter();
  if (!adapter) {
    return {
      scenarioId: fixture.scenarioId,
      status: "NOT_IMPLEMENTED",
      safeCode: "GOOGLE_DRIVE_OAUTH_CONFORMANCE_ADAPTER_MISSING",
      reason: `Personal Google Drive OAuth conformance adapter is absent at ${adapterPath}`,
      evidence: {
        fixtureSetId: fixture.fixtureSetId,
        synthetic: true,
        containsSecrets: false,
        containsRealPersonalData: false,
        productionLikeAcceptanceClaimed: false,
      },
    };
  }
  const result = await adapter.runPersonalGoogleDriveOAuthConformanceScenario(structuredClone(fixture));
  if (!result || typeof result !== "object") throw new TypeError(`No conformance result for ${fixture.scenarioId}`);
  return result;
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, part) => current?.[part], value);
}

export function equal(pathName, expected) {
  return { path: pathName, message: `expected ${JSON.stringify(expected)}`, accept: (actual) => JSON.stringify(actual) === JSON.stringify(expected) };
}

export function verify(result, checks) {
  const failures = [];
  const serialized = JSON.stringify(result);
  for (const forbidden of forbiddenEvidenceValues) {
    if (serialized.includes(forbidden)) failures.push(`evidence leaked forbidden synthetic credential marker for ${forbidden.split("-").slice(0, 2).join("-")}`);
  }
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

export const commonChecks = Object.freeze([
  equal("status", "SUCCEEDED"),
  equal("evidence.synthetic", true),
  equal("evidence.containsSecrets", false),
  equal("evidence.containsRealPersonalData", false),
  equal("evidence.productionLikeAcceptanceClaimed", false),
]);

