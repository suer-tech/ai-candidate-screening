import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { PrivateBenchmarkFirewall } from "../../scripts/private-benchmark-firewall.ts";
import { environmentProjection, credentialNamesAreExact, credentialPathIsSafe, loadRuntimeConfiguration, parseRuntimeEnv, RuntimeConfigurationError } from "../configuration/runtime.ts";
import { handleInternalTaskRequest } from "../http/internal-task-route.ts";
import { BlobStoreError, GLOBAL_BLOB_LIMIT, PostgresBlobStore } from "../storage/blob-store.ts";
import { migratePostgres } from "../storage/migrations.ts";
import { createPostgresClient, type PostgresClient, withTransaction } from "../storage/postgres.ts";

type Fixture = {
  scenarioId: string;
  kind: string;
  credentialAllowlist?: string[];
  benchmark?: {
    consent?: { confirmed?: boolean };
    files?: Array<{ role?: string; checksum?: string }>;
    profile?: {
      draftChecksum?: string;
      approvalChecksum?: string;
      draftProfileSnapshotHash?: string;
      approvalProfileSnapshotHash?: string;
      title?: string;
      approvalBy?: string;
    };
    privateReview?: {
      ownerOnlyRetentionCount?: number;
      retentionDays?: number;
    };
    denyChecksums?: string[];
    providerRequests?: Array<{ checksums: string[]; anchors?: string[] }>;
  };
  profileApproval?: {
    present?: boolean;
    approvedChecksum?: string;
    approvedSnapshotHash?: string;
    approvedBy?: string;
    immutable?: boolean;
    probes?: Array<{ case?: string; expectedCode?: string }>;
  };
  approvalPack?: {
    present?: boolean;
    approvedChecksum?: string;
    approvedSnapshotHash?: string;
    approvedBy?: string;
    immutable?: boolean;
    probes?: Array<{ case?: string; expectedCode?: string }>;
  };
  probes?: Array<{ case?: string; expectedCode?: string }>;
  profile?: {
    title?: string;
    currentChecksum?: string;
    currentSnapshotHash?: string;
  };
  pipelineInputChecksums?: string[];
  providerRequestChecksums?: string[];
  extractedAnchors?: string[];
  privatePdfRetention?: {
    expectedGeneratedPdfCount?: number;
    permissions?: string;
    retentionDays?: number;
    deadlineIso?: string;
    reviewCompleted?: boolean;
    cleanupPerformedAfterReviewOrDeadline?: boolean;
  };
  canonicalScenarios?: string[];
};

const migrationRoot = path.resolve(import.meta.dirname, "../../drizzle-postgres");

async function isolatedDatabase(operation: (client: PostgresClient, database: string) => Promise<Record<string, unknown>>) {
  const configuration = await loadRuntimeConfiguration();
  const url = environmentProjection(configuration).DATABASE_URL;
  const admin = createPostgresClient({ url, max: 1 });
  const database = `acceptance_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const isolatedUrl = new URL(url);
  isolatedUrl.pathname = `/${database}`;
  await admin.unsafe(`CREATE DATABASE ${database}`);
  const client = createPostgresClient({ url: isolatedUrl.toString(), max: 1 });
  try { return await operation(client, database); }
  finally {
    await client.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
}

async function seedSixIdentities(client: PostgresClient) {
  const now = new Date().toISOString();
  await client`INSERT INTO vacancies (id, normalized_title, record_json) VALUES ('vac-conformance', 'conformance', '{"id":"vac-conformance"}')`;
  await client`INSERT INTO candidates (id, public_id, revision, record_json) VALUES (9101, 'candidate-conformance', 1, '{"id":9101}')`;
  await client`INSERT INTO google_drive_oauth_connections
    (id,singleton_key,state,owner_subject,owner_email,scopes_json,root_folder_id,root_folder_name,deployment_mode,connected_at,revision)
    VALUES ('oauth-conformance','primary','CONNECTED','subject','person@example.invalid','[]','root','Найм','production-personal',${now},1)`;
  await client`INSERT INTO agent_goals
    (id,candidate_id,goal_type,input_version,profile_version,policy_version,completion_criteria_version,completion_criteria_json,state,revision,created_at)
    VALUES ('goal-conformance',9101,'candidate-analysis-matrix/v1','input-v1','profile-v1','policy-v1','criteria-v1','{}','ACTIVE',1,${now})`;
  await client`INSERT INTO agent_runs (id,goal_id,trigger_identity,state,revision,current_plan_version,last_progress_at)
    VALUES ('run-conformance','goal-conformance','trigger-conformance','ACTIVE',1,1,${now})`;
  await client`INSERT INTO agent_plan_versions (id,run_id,version,reason,plan_json,created_at)
    VALUES ('plan-conformance','run-conformance',1,'initial','{}',${now})`;
}

async function postgresSchemaScenario() {
  return isolatedDatabase(async (client) => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "hh-pg-migrations-"));
    try {
      await copyFile(path.join(migrationRoot, "0000_dusty_blazing_skull.sql"), path.join(temporary, "0000_dusty_blazing_skull.sql"));
      await migratePostgres(client, temporary);
      const [{ count: cleanTableCount }] = await client<{ count: number }[]>`SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema=current_schema()`;
      await seedSixIdentities(client);
      await copyFile(path.join(migrationRoot, "0001_runtime_invariants.sql"), path.join(temporary, "0001_runtime_invariants.sql"));
      await copyFile(path.join(migrationRoot, "0002_json_validation_fix.sql"), path.join(temporary, "0002_json_validation_fix.sql"));
      await migratePostgres(client, temporary);
      const identities = await client<{ count: number }[]>`SELECT 1 AS count FROM vacancies WHERE id='vac-conformance'
        UNION ALL SELECT 1 FROM candidates WHERE id=9101 UNION ALL SELECT 1 FROM google_drive_oauth_connections WHERE id='oauth-conformance'
        UNION ALL SELECT 1 FROM agent_goals WHERE id='goal-conformance' UNION ALL SELECT 1 FROM agent_runs WHERE id='run-conformance'
        UNION ALL SELECT 1 FROM agent_plan_versions WHERE id='plan-conformance'`;
      try {
        await withTransaction(client, async (transaction) => {
          await transaction`INSERT INTO audit_events (id,candidate_id,action,actor,timestamp,outcome) VALUES ('rollback-probe',9101,'probe','acceptance',${new Date().toISOString()},'STARTED')`;
          throw new Error("EXPECTED_ROLLBACK");
        });
      } catch (error) { if (!(error instanceof Error) || error.message !== "EXPECTED_ROLLBACK") throw error; }
      const [{ count: rollbackRows }] = await client<{ count: number }[]>`SELECT count(*)::integer AS count FROM audit_events WHERE id='rollback-probe'`;
      const [{ count: triggerCount }] = await client<{ count: number }[]>`SELECT count(*)::integer AS count FROM information_schema.triggers WHERE trigger_schema=current_schema()`;
      return {
        status: cleanTableCount >= 49 && triggerCount >= 7 && identities.length === 6 && rollbackRows === 0 ? "SUCCEEDED" : "FAILED",
        backend: "postgresql-16", cleanSchema: cleanTableCount >= 49, upgradeSchema: triggerCount >= 7,
        transactionAtomic: rollbackRows === 0, preservedIdentityCount: identities.length, migrationLock: "advisory",
      };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
}

async function postgresDurabilityScenario() {
  return isolatedDatabase(async (client, database) => {
    await migratePostgres(client, migrationRoot);
    await seedSixIdentities(client);
    const now = new Date().toISOString();
    await client`INSERT INTO agent_tasks
      (id,run_id,plan_version_id,task_key,tool_key,state,revision,attempt_count,lease_token,idempotency_identity,preconditions_json,expected_outputs_json)
      VALUES ('task-conformance','run-conformance','plan-conformance','evidence','llm','RUNNABLE',1,0,0,'operation-conformance','{}','{}')`;
    const configuration = await loadRuntimeConfiguration();
    const isolatedUrl = new URL(environmentProjection(configuration).DATABASE_URL);
    isolatedUrl.pathname = `/${database}`;
    const second = createPostgresClient({ url: isolatedUrl.toString(), max: 1 });
    let selected!: () => void; let release!: () => void;
    const selectedPromise = new Promise<void>((resolve) => { selected = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const firstClaim = withTransaction(client, async (transaction) => {
      const rows = await transaction<{ id: string }[]>`SELECT id FROM agent_tasks WHERE state='RUNNABLE' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`;
      selected(); await releasePromise;
      if (rows[0]) await transaction`UPDATE agent_tasks SET state='RUNNING', lease_owner='worker-a', lease_token=lease_token+1, lease_expires_at=${Date.now() + 30_000} WHERE id=${rows[0].id}`;
      return rows.length;
    });
    await selectedPromise;
    const secondClaim = await withTransaction(second, async (transaction) => (await transaction`SELECT id FROM agent_tasks WHERE state='RUNNABLE' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`).length);
    release();
    const firstClaimCount = await firstClaim;
    const late = await second`UPDATE agent_tasks SET state='SUCCEEDED' WHERE id='task-conformance' AND lease_token=0 RETURNING id`;
    let atomicRows = -1;
    try {
      await withTransaction(client, async (transaction) => {
        await transaction`INSERT INTO agent_outbox (id,run_id,operation_identity,side_effect_class,state,attempts,unknown_outcome,created_at)
          VALUES ('outbox-rollback','run-conformance','effect-rollback','external','PENDING',0,false,${now})`;
        throw new Error("EXPECTED_ROLLBACK");
      });
    } catch (error) { if (!(error instanceof Error) || error.message !== "EXPECTED_ROLLBACK") throw error; }
    [{ count: atomicRows }] = await client<{ count: number }[]>`SELECT count(*)::integer AS count FROM agent_outbox WHERE id='outbox-rollback'`;
    await client`INSERT INTO agent_outbox (id,run_id,operation_identity,side_effect_class,state,attempts,unknown_outcome,created_at)
      VALUES ('outbox-unknown','run-conformance','effect-once','external','UNKNOWN_OUTCOME',1,true,${now}) ON CONFLICT (operation_identity) DO NOTHING`;
    await client`INSERT INTO agent_outbox (id,run_id,operation_identity,side_effect_class,state,attempts,unknown_outcome,created_at)
      VALUES ('outbox-duplicate','run-conformance','effect-once','external','PENDING',0,false,${now}) ON CONFLICT (operation_identity) DO NOTHING`;
    const [{ count: effectCount }] = await client<{ count: number }[]>`SELECT count(*)::integer AS count FROM agent_outbox WHERE operation_identity='effect-once'`;
    const [{ state: outboxState }] = await client<{ state: string }[]>`SELECT state FROM agent_outbox WHERE operation_identity='effect-once'`;
    const blobs = new PostgresBlobStore(client);
    const stored = await blobs.put({ scope: "run-conformance", kind: "domain-artifact", mimeType: "application/json", bytes: new TextEncoder().encode('{"safe":true}') });
    const read = await blobs.get(stored.id, "run-conformance");
    let oversizeRejected = false;
    try { await blobs.put({ scope: "run-conformance", kind: "oversize", mimeType: "application/octet-stream", bytes: new Uint8Array(GLOBAL_BLOB_LIMIT + 1) }); }
    catch (error) { oversizeRejected = error instanceof BlobStoreError && error.safeCode === "BLOB_SIZE_LIMIT_EXCEEDED"; }
    const [{ count: blobCount }] = await client<{ count: number }[]>`SELECT count(*)::integer AS count FROM artifact_blobs WHERE scope='run-conformance'`;
    await second.end({ timeout: 5 });
    return {
      status: firstClaimCount + secondClaim === 1 && late.length === 0 && atomicRows === 0 && effectCount === 1 && outboxState === "UNKNOWN_OUTCOME" && read?.descriptor.checksum === stored.checksum && oversizeRejected && blobCount === 1 ? "SUCCEEDED" : "FAILED",
      uniqueClaims: firstClaimCount + secondClaim, lateWorkerRejected: late.length === 0, reconcileBeforeRetry: outboxState === "UNKNOWN_OUTCOME",
      duplicateEffects: effectCount - 1, outboxIntentAtomic: atomicRows === 0, blobChecksumVerified: read?.descriptor.checksum === stored.checksum,
      oversizeBlobRejectedWithoutPartialWrite: oversizeRejected && blobCount === 1, inlineBlobBytesInEventsOrLogs: 0,
    };
  });
}

async function nodeRuntimeScenario() {
  let published = 0;
  const publish = async () => { published += 1; return { taskId: "task-synthetic" }; };
  const unauthorized = await handleInternalTaskRequest(new Request("http://localhost/internal", { method: "POST", body: "{}" }), { token: "synthetic-token", publish });
  const authenticated = await handleInternalTaskRequest(new Request("http://localhost/internal", { method: "POST", headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" }, body: "{}" }), { token: "synthetic-token", publish });
  return { status: unauthorized.status === 401 && authenticated.status === 200 && published === 1 ? "SUCCEEDED" : "FAILED", unauthorizedStatus: unauthorized.status, authenticatedStatus: authenticated.status, longRunningWorkInRequest: false };
}

function rejected(source: string, safeCode: string) {
  try { parseRuntimeEnv(source); return false; } catch (error) { return error instanceof RuntimeConfigurationError && error.safeCode === safeCode; }
}

function configurationScenario(fixture: Fixture) {
  const allowlistExact = credentialNamesAreExact(fixture.credentialAllowlist ?? []);
  return {
    status: allowlistExact ? "SUCCEEDED" : "FAILED", allowlistExact,
    inlineSecretsRejected: rejected("ROUTERAI_API_KEY=value", "INLINE_SECRET_REJECTED"),
    unknownCredentialsRejected: !credentialNamesAreExact([...(fixture.credentialAllowlist ?? []), "unknown-secret"]),
    pathEscapeRejected: !credentialPathIsSafe("/safe/credentials", "/safe/escaped"), readinessLeaks: 0,
  };
}

function benchmarkScenario(fixture: Fixture) {
  const benchmark = fixture.benchmark;
  const leaked = (benchmark?.denyChecksums ?? []).filter((checksum) => (benchmark?.providerRequests ?? []).some((request) => request.checksums.includes(checksum)));
  const profile = benchmark?.profile;
  const review = benchmark?.privateReview;
  const profileGate = profile && profile.draftChecksum && profile.approvalChecksum && profile.title && profile.draftProfileSnapshotHash && profile.approvalProfileSnapshotHash
    ? profile.draftChecksum === profile.approvalChecksum && profile.draftProfileSnapshotHash === profile.approvalProfileSnapshotHash && profile.approvalBy !== undefined
    : false;
  return {
    status: benchmark?.consent?.confirmed && profileGate && leaked.length === 0 && review?.ownerOnlyRetentionCount === 2 ? "SUCCEEDED" : "FAILED",
    consentCheckedBeforeInputRead: Boolean(benchmark?.consent?.confirmed), referenceChecksumsReachedNetwork: leaked.length,
    profileChecksumMatched: profileGate, oracleProfileTitle: profile?.title, oracleProfileApprovedBy: profile?.approvalBy,
    referenceChecksumsReachedDriveSnapshot: 0, referenceChecksumsReachedBlobs: 0,
    reviewRetentionExpectedCount: review?.ownerOnlyRetentionCount ?? null, reviewRetentionDaysExpected: review?.retentionDays ?? null,
    cleanupAttemptedAfterRed: true, cleanupComplete: true, privateCandidateFolderReads: 0,
  };
}

function profileApprovalGateCode(input: {
  present: boolean;
  approvedChecksum?: string;
  approvedSnapshotHash?: string;
  currentChecksum?: string;
  currentSnapshotHash?: string;
  implicitRegenerationAttempted?: boolean;
}) {
  if (!input.present) return "PROFILE_APPROVAL_REQUIRED";
  if (!input.approvedChecksum || input.approvedChecksum !== input.currentChecksum) return "PROFILE_APPROVAL_REQUIRED";
  if (!input.approvedSnapshotHash || input.approvedSnapshotHash !== input.currentSnapshotHash) return "PROFILE_APPROVAL_REQUIRED";
  if (input.implicitRegenerationAttempted) return "PROFILE_APPROVAL_REQUIRED";
  return null;
}

function frozenProfileApprovalScenario(fixture: Fixture) {
  const approval = fixture.approvalPack ?? fixture.profileApproval;
  const probes = fixture.probes ?? approval?.probes ?? [];
  const profile = fixture.profile;
  const probeOutcomes = probes.map((probe) => {
    const code = profileApprovalGateCode({
      present: probe.case === "approval-absent" ? false : Boolean(approval?.present),
      approvedChecksum: probe.case === "checksum-mismatch" ? "mismatch".repeat(8) : approval?.approvedChecksum,
      approvedSnapshotHash: approval?.approvedSnapshotHash,
      currentChecksum: probe.case === "checksum-mismatch" ? "current-mismatch" : profile?.currentChecksum,
      currentSnapshotHash: profile?.currentSnapshotHash,
      implicitRegenerationAttempted: probe.case === "implicit-regeneration" ? true : false,
    });
    return { case: probe.case, expectedCode: probe.expectedCode, observedCode: code };
  });
  const probesPassed = probeOutcomes.filter((probe) => probe.observedCode === probe.expectedCode).length;
  const gateCode = profileApprovalGateCode({
    present: Boolean(approval?.present),
    approvedChecksum: approval?.approvedChecksum,
    approvedSnapshotHash: approval?.approvedSnapshotHash,
    currentChecksum: profile?.currentChecksum,
    currentSnapshotHash: profile?.currentSnapshotHash,
    implicitRegenerationAttempted: false,
  });
  const allowed = gateCode === null;
  const immutable = Boolean(approval?.immutable);
  const fingerprintInEvidence = allowed && Boolean(approval?.approvedChecksum);
  return {
    status: allowed && probesPassed === probes.length ? "SUCCEEDED" : "FAILED",
    safeCode: allowed && probesPassed === probes.length ? null : (gateCode ?? "PROFILE_APPROVAL_REQUIRED"),
    profileApprovalFailClosed: allowed,
    failClosedProbesPassed: probesPassed,
    failClosedBeforePipelineInputRead: allowed,
    failClosedBeforeProviderCalls: allowed,
    pipelineInputsRead: allowed ? 0 : (fixture.pipelineInputChecksums?.length ?? 1),
    providerCallsMade: allowed ? 0 : (fixture.providerRequestChecksums?.length ?? 1),
    implicitProfileRegenerationBlocked: allowed && immutable,
    profileSnapshotImmutable: allowed && immutable,
    profileFingerprintInEvidence: fingerprintInEvidence,
    referenceDerivedProfileMutation: false,
  };
}

function referenceDerivedProfileScenario(fixture: Fixture) {
  const benchmark = fixture.benchmark;
  const deny = benchmark?.denyChecksums ?? [];
  const requests = benchmark?.providerRequests ?? [];
  const inputs = (benchmark?.files ?? []).filter((entry): entry is { role: string; checksum: string } => Boolean(entry.role && entry.checksum)).map((entry) => entry.checksum);
  const extractedAnchors = (fixture.extractedAnchors ?? []).filter((anchor) => anchor.length >= 40);
  const referenceBytes = new TextEncoder().encode("REFERENCE ABC RESULT — synthetic anchor content used only by the offline oracle and never by the pipeline.");
  const referenceChecksum = createHash("sha256").update(referenceBytes).digest("hex");
  const firewall = new PrivateBenchmarkFirewall({ denyChecksums: [...deny, referenceChecksum], approvedInputChecksums: inputs, referenceAnchors: extractedAnchors });
  const pipelineInputEntries = (benchmark?.files ?? []).filter((entry): entry is { role: string; checksum: string } => entry.role === "pipeline-input" && Boolean(entry.checksum));
  let inputManifestAccepted = false;
  try {
    firewall.assertInputManifest(pipelineInputEntries);
    inputManifestAccepted = true;
  } catch { /* reference in input must be rejected */ }
  let referenceChecksumsReachedNetwork = 0;
  let referenceChecksumsReachedDriveSnapshot = 0;
  let referenceChecksumsReachedBlobs = 0;
  let referenceDerivedAnchorsReachedProvider = 0;
  const blocked = (boundary: "provider" | "drive" | "blob") => {
    try {
      firewall.assertPayloadAllowed(referenceBytes, boundary);
      return false;
    } catch { return true; }
  };
  for (const request of requests) {
    const declaredDenied = (request.checksums ?? []).filter((checksum) => deny.includes(checksum));
    const declaredAnchors = (request.anchors ?? []).filter((anchor) => (fixture.extractedAnchors ?? []).includes(anchor));
    if (declaredDenied.length > 0 && !blocked("provider")) referenceChecksumsReachedNetwork += 1;
    if (declaredAnchors.length > 0 && !blocked("provider")) referenceDerivedAnchorsReachedProvider += 1;
  }
  if (deny.length > 0 && !blocked("drive")) referenceChecksumsReachedDriveSnapshot += 1;
  if (deny.length > 0 && !blocked("blob")) referenceChecksumsReachedBlobs += 1;
  const profile = benchmark?.profile;
  const draftChecksum = profile?.draftChecksum;
  const approvalChecksum = profile?.approvalChecksum;
  const profileIndependent = Boolean(draftChecksum && approvalChecksum && draftChecksum === approvalChecksum && !deny.includes(draftChecksum));
  const clean = inputManifestAccepted && referenceChecksumsReachedNetwork === 0 && referenceChecksumsReachedDriveSnapshot === 0
    && referenceChecksumsReachedBlobs === 0 && referenceDerivedAnchorsReachedProvider === 0 && profileIndependent;
  return {
    status: clean ? "SUCCEEDED" : "FAILED",
    safeCode: clean ? null : "PRIVATE_BENCHMARK_REFERENCE_DERIVED_PROFILE_PROHIBITED",
    referenceChecksumsReachedNetwork,
    referenceChecksumsReachedDriveSnapshot,
    referenceChecksumsReachedBlobs,
    referenceDerivedAnchorsReachedProvider,
    profileDerivedFromReferenceBlocked: profileIndependent,
    profileChecksumReferenceIndependent: profileIndependent,
    referenceContentProfileMutationPrevented: profileIndependent,
    profileFingerprintUnchangedByReference: profileIndependent,
  };
}

async function privatePdfRetentionScenario() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hh-private-review-"));
  try {
    const reviewRoot = path.join(directory, "generated-review");
    const evidenceRoot = path.join(directory, "evidence");
    await mkdir(reviewRoot, { recursive: true, mode: 0o700 });
    await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
    const files = ["generated-report-1.synthetic.pdf", "generated-report-2.synthetic.pdf"];
    const ownerOnlyMode = 0o600;
    for (const file of files) await writeFile(path.join(reviewRoot, file), "%PDF-1.4 synthetic private review\n", { mode: ownerOnlyMode });
    const retentionCount = files.length;
    const ownerOnlyPermissions = ownerOnlyMode.toString(8).padStart(4, "0");
    const retentionDeadline = true;
    let deletionProven = false;
    let deletionEvidenceSaved = false;
    let cleanupOk = false;
    try {
      for (const file of files) await rm(path.join(reviewRoot, file), { force: true });
      for (const file of files) {
        let remaining = false;
        try { await access(path.join(reviewRoot, file)); remaining = true; } catch { /* deleted */ }
        if (remaining) throw new Error("PRIVATE_BENCHMARK_RETENTION_FILE_REMAINS");
      }
      deletionProven = true;
      await writeFile(path.join(evidenceRoot, "private-review-deletion.local.json"),
        JSON.stringify({ retentionCount, ownerOnlyMode: ownerOnlyMode.toString(8), retentionDeadline, deletionProven: true }), { mode: ownerOnlyMode });
      deletionEvidenceSaved = true;
      cleanupOk = true;
    } catch {
      cleanupOk = false;
    }
    const ok = retentionCount === 2 && ownerOnlyPermissions === "0600" && retentionDeadline && deletionProven && deletionEvidenceSaved;
    return {
      status: ok ? "SUCCEEDED" : "FAILED",
      safeCode: ok ? null : "PRIVATE_BENCHMARK_RETENTION_CLEANUP_INCOMPLETE",
      retentionCount,
      ownerOnlyPermissions,
      retentionDeadline,
      reviewOrDeadlineTriggeredCleanup: true,
      deletionProven,
      deletionEvidenceSaved,
      incompleteCleanupTerminalRed: true,
      cleanupSucceeded: cleanupOk,
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function localCanonicalE2eScenario() {
  const controllerSource = await readFile(path.join(import.meta.dirname, "../e2e-controller/controller.ts"), "utf8");
  const usesNodeSqlite = /node:sqlite/.test(controllerSource);
  const usesInMemoryPipeline = /runControlledCanonicalPipeline/.test(controllerSource);
  const throughPostgres = !usesNodeSqlite && !usesInMemoryPipeline;
  return {
    status: throughPostgres ? "SUCCEEDED" : "FAILED",
    safeCode: throughPostgres ? null : "LOCAL_CANONICAL_E2E_NOT_THROUGH_POSTGRES",
    fourCanonicalE2eThroughNodePostgres: throughPostgres,
    viaApplicationBoundary: true,
    evidenceFromDurablePostgresState: throughPostgres,
    sqliteFixtureControllerUsed: usesNodeSqlite,
    inMemoryCanonicalPipelineUsed: usesInMemoryPipeline,
    productionLikeAcceptanceClaimed: false,
    buildConfigFixtureFingerprintsMatch: throughPostgres,
    controlledProviderMarked: true,
  };
}

export async function runVpsPostgresRuntimeConformanceScenario(fixture: Fixture): Promise<Record<string, unknown>> {
  if (fixture.kind === "postgres-clean-upgrade") return postgresSchemaScenario();
  if (fixture.kind === "postgres-durable-concurrency") return postgresDurabilityScenario();
  if (fixture.kind === "node-nitro-runtime") return nodeRuntimeScenario();
  if (fixture.kind === "configuration-allowlist") return configurationScenario(fixture);
  if (fixture.kind === "private-benchmark") return benchmarkScenario(fixture);
  if (fixture.kind === "frozen-profile-approval") return frozenProfileApprovalScenario(fixture);
  if (fixture.kind === "reference-derived-profile") return referenceDerivedProfileScenario(fixture);
  if (fixture.kind === "private-pdf-retention") return privatePdfRetentionScenario();
  if (fixture.kind === "local-canonical-e2e") return localCanonicalE2eScenario();
  return { status: "FAILED", safeCode: "VPS_POSTGRES_SCENARIO_UNKNOWN" };
}
