import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const requirementsBasisUrl = new URL("./requirements-basis.v1.json", import.meta.url);

function loadRequirementsBasis() {
  const bytes = readFileSync(requirementsBasisUrl);
  return {
    value: JSON.parse(bytes.toString("utf8")),
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

function assertSynchronizedRequirementsBasis(basis) {
  if (basis?.value?.schemaVersion !== "1.0" || typeof basis?.value?.basisId !== "string") {
    throw new Error("E2E_REQUIREMENTS_BASIS_INVALID");
  }
  if (basis.value.status !== "SYNCHRONIZED" || basis.value.productionAcceptanceAllowed !== true) {
    throw new Error(`E2E_REQUIREMENTS_BASIS_UNSYNCHRONIZED:${basis.value.basisId}`);
  }
  if (basis.value.normativeSource !== "openspec/specs" || basis.value.productEvidence !== false) {
    throw new Error("E2E_REQUIREMENTS_BASIS_INVALID");
  }
}

const REQUIRED = [
  "E2E_BASE_URL",
  "E2E_AUTH_STORAGE_STATE",
  "E2E_PREFLIGHT_TOKEN",
  "E2E_CONTROL_URL",
  "E2E_CONTROL_TOKEN",
  "E2E_FIXTURE_SET_ID",
  "E2E_BUILD_ID",
  "E2E_ENVIRONMENT",
  "E2E_ALLOW_DESTRUCTIVE_CLEANUP",
];

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function productionLikeUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  if (/localhost|127\.0\.0\.1|\.test$|\.invalid$/i.test(parsed.hostname)) throw new Error(`${name} must target a provisioned production-like environment`);
  if (/mock|demo/i.test(parsed.href)) throw new Error(`${name} must not target a demo or mock service`);
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

export function readE2eConfig(environment = process.env, options = {}) {
  const missing = REQUIRED.filter((name) => !environment[name]?.trim());
  if (missing.length) throw new Error(`Missing E2E configuration: ${missing.join(", ")}`);
  const targetEnvironment = required(environment, "E2E_ENVIRONMENT");
  if (!new Set(["staging", "preproduction"]).has(targetEnvironment)) {
    throw new Error("E2E_ENVIRONMENT must be staging or preproduction; production is not a destructive test target");
  }
  if (required(environment, "E2E_ALLOW_DESTRUCTIVE_CLEANUP") !== "true") {
    throw new Error("E2E_ALLOW_DESTRUCTIVE_CLEANUP=true is required for isolated test-data cleanup");
  }
  const requirementsBasis = options.requirementsBasis ?? loadRequirementsBasis();
  assertSynchronizedRequirementsBasis(requirementsBasis);
  const storageState = path.resolve(required(environment, "E2E_AUTH_STORAGE_STATE"));
  const fileExists = options.fileExists ?? existsSync;
  if (!fileExists(storageState)) throw new Error("E2E_AUTH_STORAGE_STATE does not exist");
  return Object.freeze({
    baseUrl: productionLikeUrl(required(environment, "E2E_BASE_URL"), "E2E_BASE_URL"),
    controlUrl: productionLikeUrl(required(environment, "E2E_CONTROL_URL"), "E2E_CONTROL_URL"),
    storageState,
    preflightToken: required(environment, "E2E_PREFLIGHT_TOKEN"),
    controlToken: required(environment, "E2E_CONTROL_TOKEN"),
    fixtureSetId: required(environment, "E2E_FIXTURE_SET_ID"),
    buildId: required(environment, "E2E_BUILD_ID"),
    environment: targetEnvironment,
    requirementsBasis: Object.freeze({
      basisId: requirementsBasis.value.basisId,
      status: requirementsBasis.value.status,
      digest: requirementsBasis.digest,
      normativeSource: requirementsBasis.value.normativeSource,
    }),
  });
}
