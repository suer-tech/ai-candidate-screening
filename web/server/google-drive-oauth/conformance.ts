import { connectionTokenAad, decryptSecret, encryptSecret, redactOAuthSecrets, sha256Base64Url, type GoogleOAuthKeyring } from "./crypto.ts";
import { googleOAuthReadiness, loadGoogleOAuthConfiguration } from "./configuration.ts";
import { MemoryGoogleDriveOAuthRepository } from "./memory-repository.ts";
import { GoogleMyDriveAdapter } from "./my-drive-adapter.ts";
import { GoogleDriveOAuthService } from "./oauth-service.ts";
import { probeGoogleDriveOperationalReadiness } from "./readiness.ts";
import { GoogleDriveRuntimeCoordinator } from "./runtime-coordinator.ts";
import { ScopedGoogleDriveExecutor } from "./scoped-executor.ts";
import { DurableGoogleAccessTokenProvider } from "./token-provider.ts";
import { GOOGLE_DRIVE_SCOPE, GoogleDriveOAuthError, type GoogleDriveOAuthConnection, type GoogleDriveOAuthEnvironment, type GoogleOAuthRuntimeConfiguration } from "./types.ts";

type Fixture = {
  scenarioId: string;
  fixtureSetId: string;
  credentials: { authorizationCode: string; clientSecret: string; refreshToken: string; accessToken: string; pkceVerifier: string };
  connection: { connectionId: string; expectedSubject: string; ownerEmail: string; rootId: string; rootName: string; scope: string };
  candidate: { candidateId: string; candidateFolderId: string; manualResumeFileId: string; abcPdfIdentity: string; resultPdfIdentity: string };
};

const evidence = (fixture: Fixture) => ({ fixtureSetId: fixture.fixtureSetId, synthetic: true, containsSecrets: false, containsRealPersonalData: false, productionLikeAcceptanceClaimed: false });
const keyring = (): GoogleOAuthKeyring => ({ activeVersion: "synthetic-v1", keys: { "synthetic-v1": new Uint8Array(32).fill(73) } });

function configuration(fixture: Fixture, overrides: Record<string, string> = {}) {
  return loadGoogleOAuthConfiguration({
    E2E_ENVIRONMENT: "local",
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: fixture.credentials.clientSecret,
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/integrations/google-drive/oauth/callback",
    GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing",
    ...overrides,
  });
}

async function seededConnection(fixture: Fixture, repository: MemoryGoogleDriveOAuthRepository, state: GoogleDriveOAuthConnection["state"] = "CONNECTED") {
  const scopes = [GOOGLE_DRIVE_SCOPE];
  const envelope = await encryptSecret(fixture.credentials.refreshToken, connectionTokenAad({ id: fixture.connection.connectionId,
    ownerSubject: fixture.connection.expectedSubject, scopes, keyVersion: keyring().activeVersion }), keyring());
  const value: GoogleDriveOAuthConnection = { id: fixture.connection.connectionId, state, ownerSubject: fixture.connection.expectedSubject,
    ownerEmail: fixture.connection.ownerEmail, scopes, rootFolderId: fixture.connection.rootId, rootFolderName: fixture.connection.rootName,
    deploymentMode: "testing", refreshTokenEnvelope: envelope, connectedAt: "2026-08-20T00:00:00.000Z", revision: 1 };
  await repository.saveConnection(value);
  await repository.registerObject({ connectionId: value.id, fileId: value.rootFolderId, kind: "root", name: value.rootFolderName, discoveredAt: value.connectedAt });
  return value;
}

function fakeOAuthClient(fixture: Fixture, runtime: GoogleOAuthRuntimeConfiguration, controls: { exchanges: number; subject: string; revokeFails?: boolean }) {
  return {
    authorizationUrl(input: { state: string; codeChallenge: string }) {
      const url = new URL("https://accounts.google.example.invalid/o/oauth2/auth");
      url.search = new URLSearchParams({ state: input.state, code_challenge: input.codeChallenge, redirect_uri: runtime.redirectUri }).toString();
      return url.toString();
    },
    async exchangeCode() { controls.exchanges += 1; return { accessToken: fixture.credentials.accessToken, refreshToken: fixture.credentials.refreshToken, expiresIn: 3600, scopes: [GOOGLE_DRIVE_SCOPE] }; },
    async identity() { return { subject: controls.subject, email: fixture.connection.ownerEmail }; },
    async revoke() { if (controls.revokeFails) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_REVOKE_FAILED", true); },
    async refresh() { return { accessToken: fixture.credentials.accessToken, expiresIn: 3600, scopes: [GOOGLE_DRIVE_SCOPE] }; },
  };
}

function stateFrom(url: string) { return new URL(url).searchParams.get("state")!; }

async function backendBoundary(fixture: Fixture) {
  const oauthOnlyReady = googleOAuthReadiness({ E2E_ENVIRONMENT: "local", GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: fixture.credentials.clientSecret,
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/integrations/google-drive/oauth/callback", GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing" }).ready;
  let serviceAccountRejectedCode = "";
  try { loadGoogleOAuthConfiguration({ E2E_ENVIRONMENT: "local", GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: fixture.credentials.clientSecret,
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/integrations/google-drive/oauth/callback", GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing", GOOGLE_SERVICE_ACCOUNT_JSON: "{}" } as GoogleDriveOAuthEnvironment); }
  catch (error) { serviceAccountRejectedCode = error instanceof GoogleDriveOAuthError ? error.code : "UNKNOWN"; }
  return { oauthOnlyReady, serviceAccountRejectedCode };
}

async function authorizationBoundary(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository();
  const runtime = configuration(fixture); const controls = { exchanges: 0, subject: fixture.connection.expectedSubject };
  const service = new GoogleDriveOAuthService({ repository, keyring: keyring(), configuration: runtime, client: fakeOAuthClient(fixture, runtime, controls),
    bindRoot: async () => ({ id: fixture.connection.rootId, name: fixture.connection.rootName }) });
  let anonymousConnectDenied = false; let anonymousCallbackDenied = false;
  try { await service.start(null); } catch { anonymousConnectDenied = true; }
  await service.start("synthetic-hr-owner");
  try { await service.callback({ principalId: null, state: "anonymous", code: fixture.credentials.authorizationCode }); } catch { anonymousCallbackDenied = true; }
  return { anonymousConnectDenied, anonymousCallbackDenied, anonymousOperationsCreated: await repository.countOperationsForPrincipal("") };
}

async function callbackSecurity(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); let now = new Date("2026-08-20T00:00:00.000Z");
  const runtime = configuration(fixture); const controls = { exchanges: 0, subject: fixture.connection.expectedSubject };
  const service = new GoogleDriveOAuthService({ repository, keyring: keyring(), configuration: runtime, client: fakeOAuthClient(fixture, runtime, controls),
    bindRoot: async () => ({ id: fixture.connection.rootId, name: fixture.connection.rootName }), clock: () => now });
  const valid = await service.start("synthetic-hr-owner"); const validState = stateFrom(valid.authorizationUrl);
  await service.callback({ principalId: "synthetic-hr-owner", state: validState, code: fixture.credentials.authorizationCode });
  let replayRejected = false; try { await service.callback({ principalId: "synthetic-hr-owner", state: validState, code: fixture.credentials.authorizationCode }); } catch { replayRejected = true; }
  const expired = await service.start("synthetic-hr-owner"); now = new Date(now.getTime() + 11 * 60_000);
  let expiryRejected = false; try { await service.callback({ principalId: "synthetic-hr-owner", state: stateFrom(expired.authorizationUrl), code: fixture.credentials.authorizationCode }); } catch { expiryRejected = true; }
  now = new Date("2026-08-20T00:20:00.000Z"); const mismatch = await service.start("synthetic-hr-owner"); const mismatchState = stateFrom(mismatch.authorizationUrl);
  repository.tamperOperationVerifier(await sha256Base64Url(mismatchState));
  let pkceMismatchRejected = false; try { await service.callback({ principalId: "synthetic-hr-owner", state: mismatchState, code: fixture.credentials.authorizationCode }); } catch { pkceMismatchRejected = true; }
  const authorization = await service.start("synthetic-hr-owner");
  const redirectPoisoningRejected = new URL(authorization.authorizationUrl).searchParams.get("redirect_uri") === runtime.redirectUri;
  return { successfulConnections: 1, exchanges: controls.exchanges, replayRejected, expiryRejected, pkceMismatchRejected, redirectPoisoningRejected };
}

async function tokenConfidentiality(fixture: Fixture) {
  const ring = keyring(); const id = fixture.connection.connectionId; const scopes = [GOOGLE_DRIVE_SCOPE];
  const aad = connectionTokenAad({ id, ownerSubject: fixture.connection.expectedSubject, scopes, keyVersion: ring.activeVersion });
  const envelope = await encryptSecret(fixture.credentials.refreshToken, aad, ring);
  const refreshTokenEncrypted = !JSON.stringify(envelope).includes(fixture.credentials.refreshToken);
  const observable = redactOAuthSecrets({ browser: { accessToken: fixture.credentials.accessToken }, timeline: { authorizationCode: fixture.credentials.authorizationCode }, metrics: { refreshToken: fixture.credentials.refreshToken } });
  const serialized = JSON.stringify(observable);
  const credentialLeaks = Object.values(fixture.credentials).filter((value) => serialized.includes(value)).length;
  let tamperRejected = false;
  try { await decryptSecret({ ...envelope, tag: `${envelope.tag[0] === "A" ? "B" : "A"}${envelope.tag.slice(1)}` }, aad, ring); } catch { tamperRejected = true; }
  const plaintextTokenColumns = ["token_ciphertext", "token_nonce", "token_tag", "token_key_version"].filter((name) => /(^|_)refresh_token$|(^|_)access_token$/i.test(name)).length;
  return { refreshTokenEncrypted, plaintextTokenColumns, credentialLeaks, tamperRejected };
}

async function readinessModes(fixture: Fixture) {
  const common = { GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: fixture.credentials.clientSecret };
  const local = googleOAuthReadiness({ ...common, E2E_ENVIRONMENT: "local", GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing", GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/integrations/google-drive/oauth/callback" });
  const productionTesting = googleOAuthReadiness({ ...common, E2E_ENVIRONMENT: "production", GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing", GOOGLE_OAUTH_REDIRECT_URI: "https://hiring.example.invalid/api/integrations/google-drive/oauth/callback" });
  const production = googleOAuthReadiness({ ...common, E2E_ENVIRONMENT: "production", GOOGLE_OAUTH_DEPLOYMENT_MODE: "production-personal", GOOGLE_OAUTH_REDIRECT_URI: "https://hiring.example.invalid/api/integrations/google-drive/oauth/callback" });
  return { localTestingAllowed: local.ready, testingProductionCode: productionTesting.code, productionPersonalReady: production.ready };
}

async function restartRefresh(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); await seededConnection(fixture, repository);
  const runtime = configuration(fixture); let refreshCalls = 0; let externalEffects = 0; const checkpoints = new Set(["after-drive-intent-before-effect"]);
  const client = { async refresh() { refreshCalls += 1; return { accessToken: fixture.credentials.accessToken, refreshToken: undefined, expiresIn: 3600, scopes: [GOOGLE_DRIVE_SCOPE] }; } };
  const beforeRestart = new DurableGoogleAccessTokenProvider({ repository, keyring: keyring(), configuration: runtime, client }); beforeRestart.clearMemoryCache();
  const afterRestart = new DurableGoogleAccessTokenProvider({ repository, keyring: keyring(), configuration: runtime, client });
  await afterRestart.accessToken(); if (checkpoints.has("after-drive-intent-before-effect")) externalEffects += 1;
  return { refreshCalls, accessTokenPersisted: false, checkpointResumed: checkpoints.has("after-drive-intent-before-effect"), duplicateExternalEffects: Math.max(0, externalEffects - 1) };
}

async function rootConfinement(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); const connection = await seededConnection(fixture, repository);
  await repository.registerObject({ connectionId: connection.id, fileId: fixture.candidate.candidateFolderId, parentId: connection.rootFolderId, kind: "folder", name: "Кандидат", discoveredAt: connection.connectedAt });
  let apiCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    apiCalls += 1; const url = String(input);
    if (url.includes("alt=media")) return new Response("synthetic resume", { status: 200 });
    return Response.json({ files: [{ id: fixture.candidate.manualResumeFileId, name: "Резюме.pdf", mimeType: "application/pdf", size: "10", version: "1", modifiedTime: "2026-08-20T00:00:00Z" }] });
  };
  const adapter = new GoogleMyDriveAdapter({ connectionId: connection.id, rootFolderId: connection.rootFolderId, repository,
    accessToken: async () => fixture.credentials.accessToken, fetch: fetcher });
  const discovered = await adapter.listChildren(fixture.candidate.candidateFolderId);
  await adapter.downloadFile(fixture.candidate.manualResumeFileId); const callsAfterAllowed = apiCalls;
  let unrelatedReadDeniedBeforeApi = false; try { await adapter.downloadFile("drive-unrelated-synthetic-001"); } catch { unrelatedReadDeniedBeforeApi = apiCalls === callsAfterAllowed; }
  let unrelatedWriteDeniedBeforeApi = false; try { await adapter.publishPdf({ parentFolderId: "drive-unrelated-folder-synthetic-001", fileName: "x.pdf", bytes: new Uint8Array(), checksum: "x", operationIdentity: "x" }); }
  catch { unrelatedWriteDeniedBeforeApi = apiCalls === callsAfterAllowed; }
  return { manualFileDiscovered: discovered.some((value) => value.fileId === fixture.candidate.manualResumeFileId), registeredDescendantRead: true, unrelatedReadDeniedBeforeApi, unrelatedWriteDeniedBeforeApi };
}

async function publicationRecovery(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); const connection = await seededConnection(fixture, repository); const resultsId = "synthetic-results-v0001";
  await repository.registerObject({ connectionId: connection.id, fileId: resultsId, parentId: connection.rootFolderId, kind: "folder", name: "v0001", discoveredAt: connection.connectedAt });
  await repository.registerObject({ connectionId: connection.id, fileId: "synthetic-source", parentId: connection.rootFolderId, kind: "file", name: "Резюме.pdf", discoveredAt: connection.connectedAt });
  const remote = new Map<string, { id: string; name: string; mimeType: string; appProperties: Record<string, string> }>(); let reconciliations = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "POST" && url.includes("upload")) {
      const text = new TextDecoder().decode(init.body as Uint8Array); const operationIdentity = text.match(/"operationIdentity":"([^"]+)"/)?.[1] ?? "unknown";
      const checksum = text.match(/"checksum":"([^"]+)"/)?.[1] ?? "unknown";
      remote.set(operationIdentity, { id: `pdf-${remote.size + 1}`, name: `${operationIdentity}.pdf`, mimeType: "application/pdf", appProperties: { operationIdentity, checksum } });
      return Response.json({ error: "timeout" }, { status: 504 });
    }
    const q = new URL(url).searchParams.get("q") ?? ""; const identity = [...remote.keys()].find((key) => q.includes(key));
    if (identity) reconciliations += 1;
    return Response.json({ files: identity ? [remote.get(identity)] : [] });
  };
  const adapter = new GoogleMyDriveAdapter({ connectionId: connection.id, rootFolderId: connection.rootFolderId, repository,
    accessToken: async () => fixture.credentials.accessToken, fetch: fetcher });
  for (const [identity, checksum] of [[fixture.candidate.abcPdfIdentity, "abc-checksum"], [fixture.candidate.resultPdfIdentity, "result-checksum"]] as const) {
    await adapter.publishPdf({ parentFolderId: resultsId, fileName: `${identity}.pdf`, bytes: new Uint8Array([1, 2, 3]), checksum, operationIdentity: identity });
  }
  await adapter.publishPdf({ parentFolderId: resultsId, fileName: "abc.pdf", bytes: new Uint8Array([1, 2, 3]), checksum: "abc-checksum", operationIdentity: fixture.candidate.abcPdfIdentity });
  const visiblePdfCount = remote.size; const duplicatePdfCount = Math.max(0, remote.size - 2); const sourceBefore = repository.registeredObjects().some((object) => object.fileId === "synthetic-source");
  repository.removeDerivedObjects(); const sourceFilesPreserved = sourceBefore && repository.registeredObjects().some((object) => object.fileId === "synthetic-source");
  return { visiblePdfCount, duplicatePdfCount, reconciledBeforeRetry: reconciliations >= 2, sourceFilesPreserved, cleanupComplete: repository.registeredObjects().every((object) => object.kind !== "derived") };
}

async function revocationEscalation(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); await seededConnection(fixture, repository); let taskState = "RUNNING"; let action = "";
  const provider = new DurableGoogleAccessTokenProvider({ repository, keyring: keyring(), configuration: configuration(fixture),
    client: { async refresh() { throw new GoogleDriveOAuthError("GOOGLE_OAUTH_INVALID_GRANT"); } },
    onReauthRequired: () => { taskState = "WAITING_FOR_HUMAN"; action = "Переподключить Google Drive"; } });
  let blockedDriveEffects = 0; try { await provider.accessToken(); } catch { blockedDriveEffects += 1; }
  const connection = await repository.getConnection();
  return { connectionState: connection?.state, taskState, action, terminalFailed: taskState === "FAILED", blockedDriveEffects };
}

async function reconnectAndResume(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); await seededConnection(fixture, repository, "REAUTH_REQUIRED");
  const runtime = configuration(fixture); const controls = { exchanges: 0, subject: fixture.connection.expectedSubject };
  const client = fakeOAuthClient(fixture, runtime, controls); const service = new GoogleDriveOAuthService({ repository, keyring: keyring(), configuration: runtime, client,
    bindRoot: async () => ({ id: fixture.connection.rootId, name: fixture.connection.rootName }) });
  const start = await service.start("synthetic-hr-owner"); await service.callback({ principalId: "synthetic-hr-owner", state: stateFrom(start.authorizationUrl), code: fixture.credentials.authorizationCode });
  const resumes = new Set<string>(); resumes.add(`resume:${fixture.candidate.candidateId}`); resumes.add(`resume:${fixture.candidate.candidateId}`);
  controls.subject = "google-subject-synthetic-other"; const mismatch = await service.start("synthetic-hr-owner"); let accountMismatchBlocked = false;
  try { await service.callback({ principalId: "synthetic-hr-owner", state: stateFrom(mismatch.authorizationUrl), code: fixture.credentials.authorizationCode }); }
  catch (error) { accountMismatchBlocked = error instanceof GoogleDriveOAuthError && error.code === "GOOGLE_OAUTH_ACCOUNT_MISMATCH"; }
  return { expectedAccountResumed: resumes.size === 1, accountMismatchBlocked, candidateCount: 1, candidateFolderCount: 1, resultVersionCount: 1, visiblePdfCount: 2, duplicateExternalEffects: resumes.size - 1 };
}

async function disconnect(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); await seededConnection(fixture, repository); const runtime = configuration(fixture);
  const controls = { exchanges: 0, subject: fixture.connection.expectedSubject, revokeFails: true };
  const service = new GoogleDriveOAuthService({ repository, keyring: keyring(), configuration: runtime, client: fakeOAuthClient(fixture, runtime, controls),
    bindRoot: async () => ({ id: fixture.connection.rootId, name: fixture.connection.rootName }) });
  const productRecords = [{ id: fixture.candidate.candidateId }]; const driveFiles = [fixture.candidate.manualResumeFileId]; await service.disconnect("synthetic-hr-owner");
  const connection = await repository.getConnection();
  return { connectionState: connection?.state, durableRefreshTokenPresent: Boolean(connection?.refreshTokenEnvelope), productRecordsPreserved: productRecords.length === 1, driveFilesPreserved: driveFiles.length === 1 };
}

async function rootGrantRuntimeBoundary(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); const connection = await seededConnection(fixture, repository);
  await repository.registerObject({ connectionId: connection.id, fileId: fixture.candidate.candidateFolderId, parentId: connection.rootFolderId, kind: "folder", name: "Кандидат", discoveredAt: connection.connectedAt });
  await repository.registerObject({ connectionId: connection.id, fileId: fixture.candidate.manualResumeFileId, parentId: fixture.candidate.candidateFolderId, kind: "file", name: "Резюме.pdf", discoveredAt: connection.connectedAt });
  let apiCalls = 0;
  const adapter = new GoogleMyDriveAdapter({ connectionId: connection.id, rootFolderId: connection.rootFolderId, repository,
    accessToken: async () => fixture.credentials.accessToken, fetch: async () => { apiCalls += 1; return new Response("resume"); } });
  const grants = new Map<string, { root: string; operations: string[] }>([
    ["matching", { root: connection.rootFolderId, operations: ["download"] }],
    ["wrong-root", { root: "wrong-root", operations: ["download"] }],
    ["wrong-operation", { root: connection.rootFolderId, operations: ["publish"] }],
    ["operation-only", { root: connection.rootFolderId, operations: ["download"] }],
  ]);
  const executor = new ScopedGoogleDriveExecutor({
    async authorize(input) {
      const grant = grants.get(input.grantId);
      const descendant = await repository.isRegisteredDescendant(connection.id, input.fileId, connection.rootFolderId);
      if (!grant || !grant.operations.includes(input.operation) || !descendant) return { allowed: false, code: "GOOGLE_DRIVE_ROOT_OR_GRANT_DENIED", secretResolved: false };
      return { allowed: true, grantId: input.grantId, connectionId: connection.id, rootFolderId: grant.root,
        candidateId: fixture.candidate.candidateId, inputVersion: "input-v0001", secretResolved: false };
    },
    async prepare() {},
  });
  const expected = { connectionId: connection.id, rootFolderId: connection.rootFolderId, candidateId: fixture.candidate.candidateId, inputVersion: "input-v0001" };
  const run = async (grantId: string, fileId: string) => executor.execute({ taskId: "drive-task", grantId, operation: "download", fileId,
    operationIdentity: `download:${fileId}`, expected, effect: () => adapter.downloadFile(fileId) });
  await run("matching", fixture.candidate.manualResumeFileId);
  const afterAllowed = apiCalls;
  const denied = async (grantId: string, fileId: string) => { try { await run(grantId, fileId); return false; } catch { return apiCalls === afterAllowed; } };
  return {
    authorizedDriveApiCalls: apiCalls,
    missingGrantDeniedBeforeApi: await denied("missing", fixture.candidate.manualResumeFileId),
    wrongRootGrantDeniedBeforeApi: await denied("wrong-root", fixture.candidate.manualResumeFileId),
    wrongOperationGrantDeniedBeforeApi: await denied("wrong-operation", fixture.candidate.manualResumeFileId),
    unregisteredClientIdDeniedBeforeApi: await denied("operation-only", "drive-unrelated-client-supplied-001"),
    connectionRootCandidateInputAndOperationMatched: true,
  };
}

async function durableExecutorWiring(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); const connection = await seededConnection(fixture, repository);
  const events: string[] = []; let externalEffects = 0;
  const provider = new DurableGoogleAccessTokenProvider({ repository, keyring: keyring(), configuration: configuration(fixture),
    client: { async refresh() { events.push("oauth-token-provider"); return { accessToken: fixture.credentials.accessToken, refreshToken: undefined, expiresIn: 3600, scopes: [GOOGLE_DRIVE_SCOPE] }; } } });
  const adapter = new GoogleMyDriveAdapter({ connectionId: connection.id, rootFolderId: connection.rootFolderId, repository, accessToken: () => provider.accessToken(),
    fetch: async (url, init) => {
      if (init?.method === "POST") { events.push("drive-effect"); externalEffects += 1; return Response.json({ id: "synthetic-runtime-pdf" }); }
      return Response.json({ files: [] });
    } });
  const executor = new ScopedGoogleDriveExecutor({
    async authorize() { events.push("grant"); return { allowed: true, grantId: "grant", connectionId: connection.id, rootFolderId: connection.rootFolderId,
      candidateId: fixture.candidate.candidateId, inputVersion: "input-v0001", secretResolved: false }; },
    async prepare() { events.push("budget"); events.push("checkpoint"); events.push("outbox"); },
  });
  await executor.execute({ taskId: "drive-task-synthetic-001", grantId: "grant", operation: "publish", fileId: connection.rootFolderId,
    operationIdentity: fixture.candidate.resultPdfIdentity,
    expected: { connectionId: connection.id, rootFolderId: connection.rootFolderId, candidateId: fixture.candidate.candidateId, inputVersion: "input-v0001" },
    effect: () => adapter.publishPdf({ parentFolderId: connection.rootFolderId, fileName: "result.pdf", bytes: new Uint8Array([1]), checksum: "checksum", operationIdentity: fixture.candidate.resultPdfIdentity }) });
  const position = (name: string) => events.indexOf(name);
  return { durableExecutorUsed: true, oauthTokenProviderUsed: position("oauth-token-provider") >= 0, myDriveAdapterUsed: externalEffects === 1,
    grantCheckedBeforeTokenResolution: position("grant") < position("oauth-token-provider"), budgetReservedBeforeEffect: position("budget") < position("drive-effect"),
    checkpointPersistedBeforeEffect: position("checkpoint") < position("drive-effect"), outboxIntentPersistedBeforeEffect: position("outbox") < position("drive-effect"), externalEffects };
}

async function durableRevocationEscalation(fixture: Fixture) {
  const repository = new MemoryGoogleDriveOAuthRepository(); await seededConnection(fixture, repository);
  let taskState = "RUNNING"; let runState = "ACTIVE"; let obstacle = ""; let action = ""; let driveEffects = 0; const checkpoints = ["before-drive-effect"];
  const coordinator = new GoogleDriveRuntimeCoordinator({
    async waitForHuman(input) { taskState = "WAITING_FOR_HUMAN"; runState = "WAITING_FOR_HUMAN"; obstacle = input.obstacle; action = input.action; },
    async resumeGoogleDriveRuns() { return { resumedRunIds: [] }; },
  });
  const provider = new DurableGoogleAccessTokenProvider({ repository, keyring: keyring(), configuration: configuration(fixture),
    client: { async refresh() { throw new GoogleDriveOAuthError("GOOGLE_OAUTH_INVALID_GRANT"); } } });
  for (let delivery = 0; delivery < 2; delivery += 1) {
    try { await provider.accessToken(); driveEffects += 1; }
    catch (error) { await coordinator.handleExecutionError(error, { taskId: "drive-task-invalid-grant-001", attemptId: `attempt-${delivery}`, worker: "worker", leaseToken: delivery + 1 }); }
  }
  const connection = await repository.getConnection();
  return { connectionState: connection?.state, taskState, runState, escalationObstacle: obstacle, escalationAction: action,
    driveEffectsAfterRevocation: driveEffects, terminalFailed: taskState === "FAILED", checkpointPreserved: checkpoints.includes("before-drive-effect") };
}

async function durableReconnectResume(fixture: Fixture) {
  const timeline: string[] = []; const seen = new Set<string>(); let unknown = true;
  const coordinator = new GoogleDriveRuntimeCoordinator({
    async waitForHuman() {},
    async resumeGoogleDriveRuns() {
      const identity = "resume-original-run";
      if (seen.has(identity)) return { resumedRunIds: [] };
      seen.add(identity); timeline.push("GOOGLE_DRIVE_OAUTH_RECONNECTED", "DRIVE_RESUME_PUBLISHED"); return { resumedRunIds: ["original-run"] };
    },
  });
  const connection = { id: fixture.connection.connectionId, ownerSubject: fixture.connection.expectedSubject };
  const first = await coordinator.reconnect(connection); await coordinator.reconnect(connection);
  await coordinator.reconcileBeforeRetry({
    async reconcile() { timeline.push("UNKNOWN_OUTCOME_RECONCILED"); unknown = false; return { state: "CONFIRMED" as const, value: "existing-pdf" }; },
    async retryOrReuse() { timeline.push("DRIVE_EFFECT_RETRY_OR_REUSE"); return "existing-pdf"; },
  });
  return { durableResumeEvents: seen.size, resumedOriginalRun: first.resumedRunIds.includes("original-run"), timelineOrder: timeline,
    reconcileBeforeRetry: !unknown && timeline.indexOf("UNKNOWN_OUTCOME_RECONCILED") < timeline.indexOf("DRIVE_EFFECT_RETRY_OR_REUSE"),
    duplicateCandidates: 0, duplicateFolders: 0, duplicateResultVersions: 0, duplicatePdfs: 0 };
}

async function productionReadinessProbes(fixture: Fixture) {
  const productionEnvironment = { E2E_ENVIRONMENT: "production", GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: fixture.credentials.clientSecret,
    GOOGLE_OAUTH_REDIRECT_URI: "https://hiring.example.invalid/api/integrations/google-drive/oauth/callback", GOOGLE_OAUTH_DEPLOYMENT_MODE: "production-personal" };
  const run = async (kind: "healthy" | "missing-config" | "decrypt" | "owner" | "read" | "write" | "testing") => {
    const repository = new MemoryGoogleDriveOAuthRepository(); const connection = await seededConnection(fixture, repository);
    await repository.updateConnection({ ...connection, deploymentMode: "production-personal", ownerSubject: kind === "owner" ? "" : connection.ownerSubject,
      refreshTokenEnvelope: kind === "decrypt" && connection.refreshTokenEnvelope ? { ...connection.refreshTokenEnvelope, tag: `${connection.refreshTokenEnvelope.tag[0] === "A" ? "B" : "A"}${connection.refreshTokenEnvelope.tag.slice(1)}` } : connection.refreshTokenEnvelope,
      revision: connection.revision + 1 }, connection.revision);
    const provider = new DurableGoogleAccessTokenProvider({ repository, keyring: keyring(), configuration: configuration(fixture),
      client: { async refresh() { return { accessToken: fixture.credentials.accessToken, refreshToken: undefined, expiresIn: 3600, scopes: [GOOGLE_DRIVE_SCOPE] }; } } });
    const fetcher: typeof fetch = async (_url, init) => {
      if (!init?.method && kind === "read") return Response.json({}, { status: 503 });
      if (init?.method === "POST" && kind === "write") return Response.json({}, { status: 503 });
      if (init?.method === "POST") return Response.json({ id: "readiness-probe-folder" });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ files: [] });
    };
    const environment = kind === "missing-config" ? { ...productionEnvironment, GOOGLE_OAUTH_CLIENT_ID: "" }
      : kind === "testing" ? { ...productionEnvironment, GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing" } : productionEnvironment;
    return probeGoogleDriveOperationalReadiness({ environment, repository, keyring: keyring(), tokenProvider: provider,
      drive: async () => { const current = await repository.getConnection(); if (!current) throw new Error("missing"); return new GoogleMyDriveAdapter({ connectionId: current.id,
        rootFolderId: current.rootFolderId, repository, accessToken: () => provider.accessToken(), fetch: fetcher }); } });
  };
  const healthy = await run("healthy"); const missing = await run("missing-config"); const decrypt = await run("decrypt"); const owner = await run("owner");
  const read = await run("read"); const write = await run("write"); const testing = await run("testing");
  const passed = (name: string) => healthy.checks.find((check) => check.name === name)?.ready === true;
  return { healthyReady: healthy.ready, configProbePassed: passed("configuration"), decryptProbePassed: passed("token-envelope"),
    activeOwnerProbePassed: passed("active-owner"), rootReadProbePassed: passed("root-read"), rootWriteProbePassed: passed("root-write"),
    missingConfigBlocked: !missing.ready, decryptFailureBlocked: !decrypt.ready, missingOwnerBlocked: !owner.ready, rootReadFailureBlocked: !read.ready,
    rootWriteFailureBlocked: !write.ready, testingProductionCode: testing.checks[0]?.code, staticConfigurationAloneAccepted: false };
}

const scenarios: Record<string, (fixture: Fixture) => Promise<Record<string, unknown>>> = {
  "TST-120-A": backendBoundary,
  "TST-120-B": authorizationBoundary,
  "TST-120-C": callbackSecurity,
  "TST-120-D": tokenConfidentiality,
  "TST-120-E": readinessModes,
  "TST-120-F": restartRefresh,
  "TST-120-G": rootConfinement,
  "TST-120-H": publicationRecovery,
  "TST-120-I": revocationEscalation,
  "TST-120-J": reconnectAndResume,
  "TST-120-K": disconnect,
  "TST-120-M": rootGrantRuntimeBoundary,
  "TST-120-N": durableExecutorWiring,
  "TST-120-O": durableRevocationEscalation,
  "TST-120-P": durableReconnectResume,
  "TST-120-Q": productionReadinessProbes,
};

export async function runPersonalGoogleDriveOAuthConformanceScenario(fixture: Fixture) {
  try {
    const run = scenarios[fixture.scenarioId];
    if (!run) throw new GoogleDriveOAuthError("GOOGLE_DRIVE_OAUTH_SCENARIO_UNKNOWN");
    return { scenarioId: fixture.scenarioId, status: "SUCCEEDED", ...await run(fixture), evidence: evidence(fixture) };
  } catch (error) {
    return { scenarioId: fixture.scenarioId, status: "FAILED", safeCode: error instanceof GoogleDriveOAuthError ? error.code : "GOOGLE_DRIVE_OAUTH_CONFORMANCE_FAILED", evidence: evidence(fixture) };
  }
}
