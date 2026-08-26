import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { request } from "@playwright/test";
import { E2eControlClient } from "./control-client.mjs";
import { readE2eConfig } from "./config.mjs";

const REQUIRED_CONTROL_CAPABILITIES = [
  "fixtureSeed",
  "processingObservation",
  "artifactInspection",
  "personalMyDriveFixture",
  "controlledRouterAi",
  "matrixDrivenAssessment",
  "observedEvidenceChecks",
  "requirementsBasisGuard",
  "realAssemblyAi",
  "pdfPublication",
  "telegramRecipients",
  "uniqueRunIdentities",
  "completeCleanup",
  "driveCleanup",
  "crossHrAccess",
  "inputVersioningMatrix",
  "failureMatrix",
  "comparisonMatrix",
  "immutabilityMatrix",
  "archiveLifecycle",
  "protectedTraceInspection",
];

function failures(payload) {
  return (payload?.checks ?? []).filter((check) => check.ready !== true).map((check) => `${check.name}: ${check.detail}`);
}

function assertRealProviderProbe(probe, name) {
  if (probe?.ready !== true || probe?.providerMode !== "real") throw new Error(`${name} smoke did not execute a real provider request`);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(probe.executedAtUtc ?? "")) throw new Error(`${name} smoke has no execution timestamp`);
  if (typeof probe.requestRef !== "string" || !probe.requestRef.startsWith("provider:")) throw new Error(`${name} smoke has no provider request evidence`);
  if (typeof probe.provider !== "string" || !probe.provider) throw new Error(`${name} smoke did not identify the provider`);
  if (typeof probe.model !== "string" || !probe.model) throw new Error(`${name} smoke did not identify the actual model`);
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

    const driveResponse = await authenticated.get("/api/integrations/google-drive/health");
    const drive = await driveResponse.json().catch(() => ({}));
    if (!driveResponse.ok() || drive.connected !== true || drive.providerMode !== "real") throw new Error("Personal Google My Drive OAuth is not connected in real-provider mode");
    if (drive.permissions?.readInputs !== true || drive.permissions?.createOutputs !== true || drive.permissions?.manageMembers !== false) {
      throw new Error("Personal Google My Drive OAuth permissions do not match the production contract");
    }

    const control = new E2eControlClient(config);
    const controlReadiness = await control.request("/preflight", {
      method: "POST",
      body: {
        fixtureSetId: config.fixtureSetId,
        buildId: config.buildId,
        environment: config.environment,
        requirementsBasis: config.requirementsBasis,
      },
    });
    if (controlReadiness.ready !== true || controlReadiness.mode !== "production-like") throw new Error("E2E control plane is not production-like ready");
    if (controlReadiness.contractVersion !== "1.1") throw new Error("E2E control plane does not implement canonical control contract 1.1");
    if (controlReadiness.fixtureSetId !== config.fixtureSetId) throw new Error("E2E control plane attested a different fixture set");
    if (controlReadiness.buildId !== config.buildId) throw new Error("E2E control plane attested a different deployed build");
    if (controlReadiness.requirementsBasis?.basisId !== config.requirementsBasis.basisId
      || controlReadiness.requirementsBasis?.digest !== config.requirementsBasis.digest
      || controlReadiness.requirementsBasis?.status !== "SYNCHRONIZED"
      || controlReadiness.requirementsBasis?.productionAcceptanceAllowed !== true) {
      throw new Error("E2E control plane did not accept the exact synchronized requirements basis");
    }
    const missingCapabilities = REQUIRED_CONTROL_CAPABILITIES.filter((name) => controlReadiness.capabilities?.[name] !== true);
    if (missingCapabilities.length) throw new Error(`E2E control plane lacks capabilities: ${missingCapabilities.join(", ")}`);
    assertRealProviderProbe(controlReadiness.providerSmoke?.analysisLlm, "RouterAI analysis");
    assertRealProviderProbe(controlReadiness.providerSmoke?.ocrLlm, "RouterAI OCR");
    assertRealProviderProbe(controlReadiness.providerSmoke?.stt, "AssemblyAI STT");
    if (controlReadiness.controlledLlmGateway?.mode !== "deterministic-test-gateway") {
      throw new Error("E2E control plane did not attest the canonical controlled LLM gateway");
    }
    if (typeof controlReadiness.fixtureDigest !== "string" || !controlReadiness.fixtureDigest) {
      throw new Error("E2E control plane did not identify an immutable synthetic fixture digest");
    }
    if (typeof controlReadiness.configurationFingerprint !== "string" || !controlReadiness.configurationFingerprint) {
      throw new Error("E2E control plane did not identify the tested configuration");
    }
    return { config, readiness, drive, controlReadiness };
  } finally {
    await authenticated.dispose();
    await anonymous.dispose();
  }
}

async function main() {
  const outputFlag = process.argv.indexOf("--json-output");
  const outputPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined;
  try {
    const result = await runPreflight();
    const evidence = {
      schemaVersion: "1.0",
      generatedAtUtc: new Date().toISOString(),
      status: "READY",
      classification: "environment-preflight",
      environment: result.config.environment,
      buildId: result.config.buildId,
      fixtureSetId: result.config.fixtureSetId,
      requirementsBasis: result.config.requirementsBasis,
      applicationChecks: result.readiness.checks,
      drive: {
        connected: result.drive.connected,
        providerMode: result.drive.providerMode,
        permissions: result.drive.permissions,
      },
      controlPlane: {
        contractVersion: result.controlReadiness.contractVersion,
        fixtureDigest: result.controlReadiness.fixtureDigest,
        configurationFingerprint: result.controlReadiness.configurationFingerprint,
      },
    };
    if (outputPath) {
      const resolved = path.resolve(outputPath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`E2E preflight READY for ${result.config.environment} build ${result.config.buildId}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    const code = message.match(/^[A-Z][A-Z0-9_]+/)?.[0] ?? "E2E_PREFLIGHT_BLOCKED";
    const evidence = {
      schemaVersion: "1.0",
      generatedAtUtc: new Date().toISOString(),
      status: "BLOCKED",
      classification: "environment-preflight",
      productionAcceptanceClaimed: false,
      checks: [{ name: "preflight", ready: false, code, detail: message }],
    };
    if (outputPath) {
      const resolved = path.resolve(outputPath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
    process.stderr.write(`E2E preflight BLOCKED: ${message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
