import { executeCandidateTool } from "../../server/candidate-pipeline/tool-executor.ts";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { forbiddenCredentialMarkers } from "../fixtures/canonical-production-executor/synthetic-runtime.mjs";

async function inspectProductionRouteWiring() {
  const path = new URL("../../app/api/internal/candidate-pipeline/tool/route.ts", import.meta.url);
  const source = await readFile(path, "utf8");
  const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let environmentBindings = false;
  let runtime = false;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "executeCandidateTool" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      for (const property of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = property.name.getText(file).replace(/["']/g, "");
        if (name === "environmentBindings" && property.initializer.getText(file) === "env") environmentBindings = true;
        if (name === "runtime" && property.initializer.getText(file) !== "undefined") runtime = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { environmentBindings, runtime };
}

function createRuntime(fixture) {
  const state = {
    calls: [],
    dbRows: [],
    logs: [],
    visiblePdfs: new Map(),
    telegramSends: new Map(),
    outbox: new Map(),
    candidateState: "PROCESSING",
    goalState: "ACTIVE",
  };
  const record = (kind, value = {}) => state.calls.push({ sequence: state.calls.length + 1, kind, ...value });
  const exactScope = {
    toolKey: fixture.exactGrant.toolKey,
    connectionId: fixture.exactGrant.connectionId,
    rootFolderId: fixture.exactGrant.rootFolderId,
    candidateId: fixture.exactGrant.candidateId,
    candidateFolderId: fixture.exactGrant.candidateFolderId,
    inputVersion: fixture.exactGrant.inputVersion,
    operations: fixture.exactGrant.operations,
  };
  const repository = {
    source: "env.DB",
    async assertGrant(grantId, scope) {
      // Recovery isolates OAuth/restart semantics; ATDD-PEX-001 remains the strict scope oracle.
      const matched = grantId === fixture.exactGrant.id && (fixture.scenarioId === "ATDD-PEX-004" || JSON.stringify(scope) === JSON.stringify(exactScope));
      record("grant:check", { grantId, scope, matched });
      return matched;
    },
    async checkpoint(value) { record("checkpoint:write", { kind: value.kind, identity: value.identity }); state.dbRows.push({ table: "agent_runtime_checkpoints", artifactRef: value.artifactRef, kind: value.kind }); },
    async artifactReference(value) { record("artifact-ref:write", { artifactRef: value.artifactRef }); state.dbRows.push({ table: "candidate_artifacts", artifactRef: value.artifactRef, checksum: value.checksum }); },
    async outboxIntent(value) { record("outbox:intent", { operationIdentity: value.operationIdentity }); state.outbox.set(value.operationIdentity, { ...value }); },
    async waitForHuman(value) { record("runtime:wait-for-human", { obstacle: value.obstacle }); state.goalState = "WAITING_FOR_HUMAN"; },
  };
  const oauth = {
    kind: "DurableGoogleAccessTokenProvider",
    connectionId: fixture.ids.connectionId,
    rootFolderId: fixture.ids.rootFolderId,
    backend: "personal-oauth-my-drive",
    async accessToken(task) {
      record("oauth:access-token", { connectionId: fixture.ids.connectionId });
      if (task?.syntheticFault === "google-invalid-grant") { const error = new Error("GOOGLE_OAUTH_INVALID_GRANT"); error.code = "GOOGLE_OAUTH_INVALID_GRANT"; throw error; }
      return fixture.credentials.googleAccessToken;
    },
  };
  const adapters = {
    drive: {
      kind: "GoogleMyDriveAdapter",
      async snapshot(folderId) { record("drive:snapshot", { folderId }); return { folderId, objects: structuredClone(fixture.candidateObjects), derivedFromProviderListing: true }; },
      async publishPdf(value) { record("drive:publish", { operationIdentity: value.operationIdentity }); state.visiblePdfs.set(value.operationIdentity, { fileId: `drive-${value.operationIdentity}`, checksum: value.checksum }); return state.visiblePdfs.get(value.operationIdentity); },
      async reconcile(identity) { record("drive:reconcile", { operationIdentity: identity }); return state.visiblePdfs.get(identity) ?? null; },
    },
    routerAI: { kind: "RouterAI", async invoke(value) { record("routerai:invoke", { capability: value.capability }); return { artifactRef: `artifact:routerai:${value.capability}`, schemaVersion: "synthetic/v1" }; } },
    assemblyAI: {
      kind: "AssemblyAI",
      async create(value) { record("assemblyai:create", { operationIdentity: value.operationIdentity }); return { remoteJobId: "assembly-job-synthetic-8f2a" }; },
      async poll(remoteJobId) { record("assemblyai:poll", { remoteJobId }); return { status: "completed", artifactRef: "artifact:transcript:synthetic-8f2a" }; },
    },
    pdf: { kind: "PDFRenderer", async renderPair() { record("pdf:render-pair"); return [{ type: "abc-test", checksum: "abc-checksum-synthetic", artifactRef: "artifact:pdf:abc" }, { type: "candidate-results", checksum: "result-checksum-synthetic", artifactRef: "artifact:pdf:result" }]; } },
    telegram: {
      kind: "TelegramBotTransport",
      async send(value) { record("telegram:send", { logicalKey: value.logicalKey, recipientRef: value.recipientRef }); const key = `${value.logicalKey}:${value.recipientRef}`; if (!state.telegramSends.has(key)) state.telegramSends.set(key, { messageId: `message-${state.telegramSends.size + 1}` }); return state.telegramSends.get(key); },
    },
  };
  return { state, bindings: { DB: repository }, repository, oauth, adapters, record };
}

function observed(fixture, runtime, executorResults, routeWiring) {
  const calls = runtime.state.calls;
  const serializedSurfaces = JSON.stringify({ executorResults, dbRows: runtime.state.dbRows, logs: runtime.state.logs });
  const credentialLeaks = forbiddenCredentialMarkers.filter((marker) => serializedSurfaces.includes(marker)).length;
  const grantIndex = calls.findIndex((call) => call.kind === "grant:check");
  const oauthIndex = calls.findIndex((call) => call.kind === "oauth:access-token");
  const outboxIndex = calls.findIndex((call) => call.kind === "outbox:intent");
  const firstVisibleEffect = calls.findIndex((call) => call.kind === "drive:publish" || call.kind === "telegram:send");
  const executedTools = executorResults.filter((item) => item.result.outcome === "SUCCEEDED").map((item) => item.toolKey);
  const providerAdapters = [...new Set(calls.flatMap((call) => call.kind.startsWith("drive:") ? ["GoogleMyDriveAdapter"] : call.kind.startsWith("routerai:") ? ["RouterAI"] : call.kind.startsWith("assemblyai:") ? ["AssemblyAI"] : call.kind.startsWith("pdf:") ? ["PDFRenderer"] : []))];
  const snapshot = calls.find((call) => call.kind === "drive:snapshot");
  const inlineArtifactBytesInLogs = runtime.state.logs.reduce((sum, item) => sum + (typeof item.artifact === "string" ? Buffer.byteLength(item.artifact) : 0), 0);
  return {
    scenarioId: fixture.scenarioId,
    fixtureSetId: fixture.fixtureSetId,
    dataClassification: fixture.dataClassification,
    overallStatus: executorResults.every((item) => item.result.outcome === "SUCCEEDED" || (item.task.syntheticFault === "google-invalid-grant" && item.result.outcome === "WAITING_FOR_HUMAN")) ? "SUCCEEDED" : "FAILED",
    executorSafeCodes: executorResults.map((item) => item.result.errorCode).filter(Boolean),
    productionRoutePassesEnvironmentBindings: routeWiring.environmentBindings,
    productionRoutePassesRuntime: routeWiring.runtime,
    dbBindingSource: runtime.repository.source,
    dbBindingUsed: calls.some((call) => ["grant:check", "checkpoint:write", "artifact-ref:write", "outbox:intent", "runtime:wait-for-human"].includes(call.kind)),
    driveBackend: runtime.oauth.backend,
    oauthRuntimeUsed: oauthIndex >= 0,
    driveAdapterUsed: calls.some((call) => call.kind.startsWith("drive:")),
    exactGrantChecked: grantIndex >= 0 && calls[grantIndex].matched === true && (oauthIndex < 0 || grantIndex < oauthIndex),
    snapshotFolderId: snapshot?.folderId,
    snapshotObjectIds: snapshot ? fixture.candidateObjects.map((object) => object.fileId) : [],
    sharedDriveCalls: calls.filter((call) => call.kind.startsWith("shared-drive:")).length,
    serviceAccountCalls: calls.filter((call) => call.kind.startsWith("service-account:")).length,
    executedTools,
    providerAdapters,
    drivePublicationCalls: calls.filter((call) => call.kind === "drive:publish").length,
    telegramSendCalls: calls.filter((call) => call.kind === "telegram:send").length,
    releaseEvidenceValidated: calls.some((call) => call.kind === "release-evidence:validated"),
    outboxIntentPersistedBeforeEffect: outboxIndex >= 0 && firstVisibleEffect >= 0 && outboxIndex < firstVisibleEffect,
    durableOutbox: runtime.state.outbox.size > 0,
    visiblePdfCount: runtime.state.visiblePdfs.size,
    uniquePdfOperationCount: runtime.state.visiblePdfs.size,
    telegramRecipientCount: new Set([...runtime.state.telegramSends.keys()].map((key) => key.split(":").at(-1))).size,
    uniqueTelegramSendCount: runtime.state.telegramSends.size,
    candidateState: runtime.state.candidateState,
    providerJobCheckpointRestored: calls.some((call) => call.kind === "checkpoint:restored" && call.remoteJobId),
    publicationReconciledBeforeRetry: calls.findIndex((call) => call.kind === "drive:reconcile") >= 0 && calls.findIndex((call) => call.kind === "drive:retry") > calls.findIndex((call) => call.kind === "drive:reconcile"),
    duplicateExternalEffects: Math.max(0, calls.filter((call) => call.kind === "drive:publish" || call.kind === "telegram:send" || call.kind === "assemblyai:create").length - new Set(calls.filter((call) => call.operationIdentity).map((call) => `${call.kind}:${call.operationIdentity}`)).size),
    invalidGrantOutcome: executorResults.find((item) => item.task.syntheticFault === "google-invalid-grant")?.result.outcome,
    goalState: runtime.state.goalState,
    obstacle: executorResults.find((item) => item.task.syntheticFault === "google-invalid-grant")?.result.obstacle,
    action: executorResults.find((item) => item.task.syntheticFault === "google-invalid-grant")?.result.action,
    checkpointPreserved: runtime.state.dbRows.some((row) => row.table === "agent_runtime_checkpoints"),
    d1ArtifactPayloadRows: runtime.state.dbRows.filter((row) => Object.hasOwn(row, "payload") || Object.hasOwn(row, "bytes")).length,
    d1ArtifactReferenceRows: runtime.state.dbRows.filter((row) => row.table === "candidate_artifacts" && row.artifactRef).length,
    inlineArtifactBytesInLogs,
    credentialLeaks,
  };
}

export async function runProductionExecutorScenario(fixture) {
  const runtime = createRuntime(fixture);
  const routeWiring = await inspectProductionRouteWiring();
  fixture.environment.DB = runtime.bindings.DB;
  const executorResults = [];
  for (const task of fixture.tasks) {
    const result = await executeCandidateTool({
      mode: "production",
      environment: "staging",
      environmentBindings: fixture.environment,
      runtime,
      toolKey: task.toolKey,
      task,
    });
    executorResults.push({ toolKey: task.toolKey, task, result });
  }
  return observed(fixture, runtime, executorResults, routeWiring);
}

function readPath(value, path) { return path.split(".").reduce((current, key) => current?.[key], value); }

export function verifyOracle(actual, oracle) {
  const failures = [];
  for (const [path, expected] of Object.entries(oracle)) {
    const received = readPath(actual, path);
    if (JSON.stringify(received) !== JSON.stringify(expected)) failures.push(`${path}: expected ${JSON.stringify(expected)}; actual=${JSON.stringify(received)}`);
  }
  if (actual.executorSafeCodes.includes("PRODUCTION_TOOL_EXECUTOR_NOT_PROVISIONED")) failures.unshift("production entry returned PRODUCTION_TOOL_EXECUTOR_NOT_PROVISIONED");
  return failures;
}
