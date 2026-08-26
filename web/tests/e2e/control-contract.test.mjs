import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("./fixtures/canonical-candidate-v1/manifest.json", import.meta.url);
const contractUrl = new URL("./control-contract.v1.json", import.meta.url);
const requirementsBasisUrl = new URL("./requirements-basis.v1.json", import.meta.url);

async function load(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("canonical control fixture covers every production-like external boundary", async () => {
  const fixture = await load(fixtureUrl);
  assert.equal(fixture.schemaVersion, "1.1");
  assert.equal(fixture.dataClassification, "synthetic-no-pii-no-secrets");
  assert.equal(fixture.requirementsBasisRef, "../../requirements-basis.v1.json");
  assert.equal(fixture.googleMyDrive.providerMode, "real");
  assert.equal(fixture.googleMyDrive.workspaceKind, "personal-google-my-drive-oauth");
  assert.deepEqual(fixture.googleMyDrive.permissions, { readInputs: true, createOutputs: true, manageMembers: false });
  assert.equal(fixture.controlledRouterAi.mode, "deterministic-test-gateway");
  assert.equal(fixture.controlledRouterAi.assessmentRouting, "matrix-v2");
  assert.equal(fixture.controlledRouterAi.matrixContract.sharedPerProfileVersion, true);
  assert.equal(fixture.controlledRouterAi.matrixContract.hardRequiredOnlyForStopFactorSourceRef, true);
  assert.equal(fixture.controlledRouterAi.matrixContract.criticalUnmappedRiskRequiresIndependentVerification, true);
  assert.equal(fixture.assemblyAi.providerMode, "real");
  assert.equal(fixture.assemblyAi.endpoint, "https://api.eu.assemblyai.com");
  assert.equal(fixture.pdfPublication.userDocumentCount, 2);
  assert.equal(fixture.telegram.botCount, 1);
  assert.equal(fixture.telegram.baseRecipientRefs.length, 1);
  assert.equal(fixture.identity.requiresFreshDriveFolderIds, true);
  assert.equal(fixture.identity.requiresFreshInternalUuids, true);
  assert.equal(fixture.cleanup.alwaysRun, true);
  assert.equal(fixture.cleanup.archiveIsNotCleanup, true);
  assert.equal(fixture.cleanup.requiresCleanupCompleteAttestation, true);
});

test("external control contract exposes every fixture, evidence and cleanup operation", async () => {
  const contract = await load(contractUrl);
  const capabilities = new Set(contract.requiredCapabilities);
  for (const capability of [
    "personalMyDriveFixture", "controlledRouterAi", "matrixDrivenAssessment", "observedEvidenceChecks", "requirementsBasisGuard", "realAssemblyAi", "pdfPublication",
    "telegramRecipients", "uniqueRunIdentities", "completeCleanup", "driveCleanup",
  ]) assert.equal(capabilities.has(capability), true, `missing capability ${capability}`);
  const endpointKeys = new Set(contract.endpoints.map(({ method, path }) => `${method} ${path}`));
  for (const endpoint of [
    "POST /preflight", "POST /runs", "POST /runs/{runId}/candidates",
    "GET /runs/{runId}/evidence/vacancy", "GET /runs/{runId}/evidence/transcript",
    "GET /runs/{runId}/evidence/abc", "GET /runs/{runId}/evidence/result",
    "GET /runs/{runId}/evidence/comparison", "GET /runs/{runId}/evidence/lifecycle",
    "POST /runs/{runId}/cleanup",
  ]) assert.equal(endpointKeys.has(endpoint), true, `missing endpoint ${endpoint}`);
  assert.equal(contract.schemaVersion, "1.1");
  assert.equal(contract.responseRules.deriveEvidenceFromDeployedState, true);
  assert.equal(contract.responseRules.hardCodedSuccessForbidden, true);
  assert.equal(contract.responseRules.booleanSelfAttestationsForbidden, true);
  assert.equal(contract.responseRules.staticSourceInspectionForbidden, true);
  assert.equal(contract.responseRules.everyCheckRequiresObservedAtUtc, true);
  assert.equal(contract.responseRules.everyCheckRequiresArtifactRefs, true);
  assert.equal(contract.responseRules.requirementsBasisMustBeSynchronized, true);
  assert.equal(contract.responseRules.unsynchronizedDeviationBlocksProductionAcceptance, true);
  assert.equal(contract.responseRules.requirementsBasisIsNotProductEvidence, true);
  assert.deepEqual(contract.responseRules.artifactReferenceSchemes, ["postgresql", "my-drive", "provider", "http", "browser", "pdf", "outbox", "trace"]);
  assert.equal(contract.responseRules.secretsForbidden, true);
});

test("checked-in requirements basis machine-readably blocks personal OAuth production acceptance", async () => {
  const basis = await load(requirementsBasisUrl);
  assert.equal(basis.schemaVersion, "1.0");
  assert.equal(basis.status, "UNSYNCHRONIZED_DEVIATION");
  assert.equal(basis.productionAcceptanceAllowed, false);
  assert.equal(basis.normativeSource, "openspec/specs");
  assert.deepEqual(basis.normativeRequirements, ["INT-005", "SEC-003", "TST-011"]);
  assert.equal(basis.normativeIntegration, "corporate-shared-drive-service-account");
  assert.equal(basis.harnessIntegration, "personal-google-my-drive-oauth");
  assert.equal(basis.productEvidence, false);
});

test("fixture and contract do not contain concrete secrets, recipient IDs or real personal data", async () => {
  const text = `${await readFile(fixtureUrl, "utf8")}\n${await readFile(contractUrl, "utf8")}`;
  assert.doesNotMatch(text, /-----BEGIN (?:PRIVATE KEY|CERTIFICATE)-----/);
  assert.doesNotMatch(text, /(?:api[_-]?key|authorization|bearer|bot[_-]?token)\s*[=:]\s*["'][^"']+/i);
  assert.doesNotMatch(text, /"chatId"\s*:/i);
  assert.doesNotMatch(text, /@(gmail|mail|yandex)\./i);
});
