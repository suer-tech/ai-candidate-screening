import { pathToFileURL } from "node:url";
import { request } from "@playwright/test";
import { E2eControlClient } from "./control-client.mjs";
import { readE2eConfig } from "./config.mjs";

const REQUIRED_CONTROL_CAPABILITIES = [
  "fixtureSeed",
  "processingObservation",
  "artifactInspection",
  "completeCleanup",
  "driveCleanup",
  "crossHrAccess",
  "controlledLlmGateway",
  "telegramInspection",
  "protectedTraceInspection",
];

function failures(payload) {
  return (payload?.checks ?? []).filter((check) => check.ready !== true).map((check) => `${check.name}: ${check.detail}`);
}

export async function runPreflight(environment = process.env) {
  const config = readE2eConfig(environment);
  const authenticated = await request.newContext({ baseURL: config.baseUrl, storageState: config.storageState });
  const anonymous = await request.newContext({ baseURL: config.baseUrl });
  try {
    const readinessResponse = await authenticated.get("/api/readiness/e2e", { headers: { "x-e2e-preflight-token": config.preflightToken } });
    const readiness = await readinessResponse.json().catch(() => ({}));
    if (!readinessResponse.ok() || readiness.ready !== true || readiness.mode !== "production-like") {
      const diagnostics = failures(readiness);
      throw new Error(`Application production-readiness failed${diagnostics.length ? `: ${diagnostics.join("; ")}` : ` with HTTP ${readinessResponse.status()}`}`);
    }

    const workspace = await authenticated.get("/api/workspace");
    if (!workspace.ok()) throw new Error(`Authenticated HR workspace check failed with HTTP ${workspace.status()}`);
    const anonymousWorkspace = await anonymous.get("/api/workspace");
    if (anonymousWorkspace.status() !== 401) throw new Error("Anonymous workspace request was not rejected with HTTP 401");

    const control = new E2eControlClient(config);
    const controlReadiness = await control.request("/preflight", {
      method: "POST",
      body: { fixtureSetId: config.fixtureSetId, buildId: config.buildId, environment: config.environment },
    });
    if (controlReadiness.ready !== true || controlReadiness.mode !== "production-like") throw new Error("E2E control plane is not production-like ready");
    const missingCapabilities = REQUIRED_CONTROL_CAPABILITIES.filter((name) => controlReadiness.capabilities?.[name] !== true);
    if (missingCapabilities.length) throw new Error(`E2E control plane lacks capabilities: ${missingCapabilities.join(", ")}`);
    if (controlReadiness.providerSmoke?.llm !== "real" || controlReadiness.providerSmoke?.stt !== "real") {
      throw new Error("E2E control plane did not attest real LLM and STT provider smoke");
    }
    if (controlReadiness.controlledLlmGateway?.mode !== "deterministic-test-gateway") {
      throw new Error("E2E control plane did not attest the canonical controlled LLM gateway");
    }
    if (typeof controlReadiness.fixtureDigest !== "string" || !controlReadiness.fixtureDigest) {
      throw new Error("E2E control plane did not identify an immutable synthetic fixture digest");
    }
    return { config, readiness, controlReadiness };
  } finally {
    await authenticated.dispose();
    await anonymous.dispose();
  }
}

async function main() {
  try {
    const result = await runPreflight();
    process.stdout.write(`E2E preflight READY for ${result.config.environment} build ${result.config.buildId}\n`);
  } catch (error) {
    process.stderr.write(`E2E preflight BLOCKED: ${error instanceof Error ? error.message : "unknown failure"}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
