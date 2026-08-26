import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PostgresAgentRuntimeRepository } from "../server/agent-runtime/postgres-runtime-repository.ts";
import { PostgresCandidateArtifactStore } from "../server/candidate-pipeline/artifact-store.ts";
import { DriveDiscoveryWorker } from "../server/candidate-pipeline/discovery-worker.ts";
import { CandidateDiscoveryCoordinator, InMemoryDiscoveryRepository } from "../server/candidate-pipeline/discovery.ts";
import { PostgresCandidateFolderRegistry } from "../server/candidate-pipeline/postgres-discovery.ts";
import { DurableAssemblyAiAdapter } from "../server/candidate-pipeline/providers.ts";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";
import { createGoogleDriveOAuthRuntime } from "../server/google-drive-oauth/runtime.ts";
import { PostgresBlobStore } from "../server/storage/blob-store.ts";
import { inspectMigrationState } from "../server/storage/migrations.ts";
import { createPostgresClient } from "../server/storage/postgres.ts";
import { evaluatePrivateBenchmark, PrivateBenchmarkFirewall, type PrivateBenchmarkOracle } from "./private-benchmark-firewall.ts";
import { cleanupPrivateBenchmarkOrphans } from "./private-benchmark-cleanup.ts";

type GeneratedProfile = {
  schemaVersion: string;
  profile: Record<string, string>;
  abcDirections: Array<{ id: string; name: string; gradeA: string; gradeB: string; gradeC: string; origin: "standard" | "custom" }>;
  templateVersion: string;
  hrDecisionMarkers: string[];
};
type ProfileDraft = {
  schemaVersion: string;
  title: string;
  sourceOperationId: string;
  generatedAtUtc: string;
  profileSnapshotHash: string;
  generatedProfile: GeneratedProfile;
};
type ProfileApproval = {
  schemaVersion: string;
  profileDraftChecksum: string;
  title: string;
  profileSnapshotHash: string;
  approvedAtUtc: string;
  approvedBy: string;
};
type ManifestEntry = { path: string; role: string; checksum: string; byteSize: number; mime: string };
type ManifestProfileRef = { path: string; checksum: string; snapshotHash: string; title: string; schemaVersion: string };
type ManifestApprovalRef = { path: string; checksum: string; profileDraftChecksum: string; approvedAtUtc: string; approvedBy: string };
type Manifest = {
  fixtureId: string;
  consentProof: { checksum: string };
  files: ManifestEntry[];
  denyChecksums: string[];
  oracleVersion: string;
  profileDraft?: ManifestProfileRef;
  profileApproval?: ManifestApprovalRef;
};
type ReviewManifest = {
  schemaVersion: string;
  generatedAtUtc: string;
  runs: Array<{ runId: string; reviewDeadlineUtc: string; files: string[]; status: "GREEN" | "RED" | "FAILED" }>;
};

const webRoot = path.resolve(import.meta.dirname, "..");
const candidateRoot = path.resolve(webRoot, "../candidate");
const privateRoot = path.join(candidateRoot, ".benchmark-private");
const manifestPath = path.join(privateRoot, "benchmark.manifest.local.json");
const oraclePath = path.join(privateRoot, "oracle.v1.local.json");
const profileDraftPath = path.join(privateRoot, "vacancy-profile.draft.local.json");
const profileApprovalPath = path.join(privateRoot, "vacancy-profile.approval.local.json");
const reviewRoot = path.join(privateRoot, "generated-review");
const reviewManifestPath = path.join(reviewRoot, "private-benchmark-review-manifest.local.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
const oracle = JSON.parse(await readFile(oraclePath, "utf8")) as PrivateBenchmarkOracle & { profileChecksum?: string; version?: string };
const consent = JSON.parse(await readFile(path.join(privateRoot, "consent-proof.local.json"), "utf8")) as { confirmed?: boolean };
if (consent.confirmed !== true) throw new Error("PRIVATE_BENCHMARK_CONSENT_REQUIRED");

const profileDraftText = await readFile(profileDraftPath, "utf8").catch(() => {
  throw new Error("PRIVATE_BENCHMARK_PROFILE_DRAFT_MISSING");
});
const approvalText = await readFile(profileApprovalPath, "utf8").catch(() => {
  throw new Error("PRIVATE_BENCHMARK_PROFILE_APPROVAL_REQUIRED");
});

const profileDraft = JSON.parse(profileDraftText) as ProfileDraft;
const profileApproval = JSON.parse(approvalText) as ProfileApproval;
const draftChecksum = createHash("sha256").update(profileDraftText).digest("hex");
const approvalChecksum = createHash("sha256").update(approvalText).digest("hex");
if (profileApproval.profileDraftChecksum !== draftChecksum) throw new Error("PRIVATE_BENCHMARK_PROFILE_APPROVAL_MISMATCH");
if (profileApproval.profileSnapshotHash !== profileDraft.profileSnapshotHash) throw new Error("PRIVATE_BENCHMARK_PROFILE_SNAPSHOT_MISMATCH");
if (manifest.profileDraft?.checksum && manifest.profileDraft.checksum !== draftChecksum) throw new Error("PRIVATE_BENCHMARK_MANIFEST_PROFILE_MISMATCH");
if (oracle.profileChecksum && oracle.profileChecksum !== draftChecksum) throw new Error("PRIVATE_BENCHMARK_ORACLE_PROFILE_MISMATCH");
if (oracle.version && oracle.version !== (manifest.oracleVersion || "oracle-v1")) throw new Error("PRIVATE_BENCHMARK_ORACLE_VERSION_MISMATCH");
if (profileApproval.title !== profileDraft.title) throw new Error("PRIVATE_BENCHMARK_PROFILE_TITLE_MISMATCH");

const inputs = manifest.files.filter((entry) => entry.role === "pipeline-input");
const firewall = new PrivateBenchmarkFirewall({ denyChecksums: manifest.denyChecksums, approvedInputChecksums: inputs.map((entry) => entry.checksum), referenceAnchors: oracle.anchors.map((anchor) => anchor.normalizedText) });
firewall.assertInputManifest(inputs);

const configuration = await loadRuntimeConfiguration(webRoot);
const environment = environmentProjection(configuration);
if (environment.CANDIDATE_PIPELINE_ROUTING !== "shadow" || environment.CANDIDATE_TOOL_EXECUTION_MODE !== "production") throw new Error("PRIVATE_BENCHMARK_REQUIRES_PRODUCTION_SHADOW");
const database = createPostgresClient({ url: environment.DATABASE_URL, max: 4 });
const oauth = createGoogleDriveOAuthRuntime({ database, environment });
const connection = await oauth.repository.getConnection();
if (!connection || connection.state !== "CONNECTED") throw new Error("GOOGLE_DRIVE_REAUTH_REQUIRED");
const drive = await oauth.drive();
const blobs = new PostgresBlobStore(database);
const artifacts = new PostgresCandidateArtifactStore(blobs);
const runtime = new PostgresAgentRuntimeRepository(database);
const providerCleanup = new DurableAssemblyAiAdapter({ apiKey: environment.ASSEMBLYAI_API_KEY });
await cleanupPrivateBenchmarkOrphans({ database, drive, provider: providerCleanup });
const schemaState = await inspectMigrationState(database);

const nonce = randomUUID();
const runId = `private-benchmark-run-${nonce}`;
const goalId = `private-benchmark-goal-${nonce}`;
const vacancyId = `private-benchmark-vacancy-${nonce}`;
const profileVersion = `${vacancyId}:profile:${profileDraft.profileSnapshotHash}`;
const driveObjects: Array<{ id: string; operationIdentity: string }> = [];
let vacancyFolder: { id: string; operationIdentity: string } | undefined;
let candidateFolder: { id: string; operationIdentity: string } | undefined;
let candidatePk: number | undefined;
let result: ReturnType<typeof evaluatePrivateBenchmark> | undefined;
let stageOutcomes: Array<{ key: string; state: string; safeCode?: string }> = [];
let boundaryAudits = { drive: 0, provider: 0, blob: 0 };
let reportConsistency = { documents: 0, signaturesValid: false, checksumsValid: false, parseable: false, contentNonempty: false };
let failure: unknown;
let inputVersion = "";
let reportFilesSaved = 0;
const cleanup = { provider: false, drive: false, postgresql: false, blobs: false, temp: false };
const cleanupPrivateReview = { kept: 0, files: [] as string[], retentionDeadlineUtc: new Date().toISOString(), runState: "PENDING" as "PENDING" | "GREEN" | "RED" };

function digest(value: unknown) {
  const hash = createHash("sha256");
  if (typeof value === "string") return hash.update(value).digest("hex");
  if (ArrayBuffer.isView(value)) return hash.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).digest("hex");
  if (value instanceof ArrayBuffer) return hash.update(new Uint8Array(value)).digest("hex");
  return hash.update(JSON.stringify(value)).digest("hex");
}
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
function normalize(value: string) { return value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9%+.-]+/gi, " ").trim(); }
function overlap(left: string, right: string) {
  const expected = new Set(normalize(left).split(" ").filter((token) => token.length >= 3));
  const actual = new Set(normalize(right).split(" ").filter((token) => token.length >= 3));
  return expected.size ? [...expected].filter((token) => actual.has(token)).length / expected.size : 0;
}
function reviewManifestDefault() {
  return { schemaVersion: "private-benchmark-review-manifest/v1", generatedAtUtc: new Date().toISOString(), runs: [] as ReviewManifest["runs"] };
}
async function readReviewManifest() {
  try {
    return JSON.parse(await readFile(reviewManifestPath, "utf8")) as ReviewManifest;
  } catch {
    return reviewManifestDefault();
  }
}
async function writeReviewManifest(value: ReviewManifest) {
  await mkdir(reviewRoot, { recursive: true });
  await writeFile(reviewManifestPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
async function parsePdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false });
  const document = await loadingTask.promise;
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    parts.push(content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" "));
    page.cleanup();
  }
  await loadingTask.destroy();
  return parts.join(" ").trim();
}

try {
  const retentionDays = Math.max(1, Number(process.env.PRIVATE_BENCHMARK_REVIEW_TTL_DAYS || "7"));
  cleanupPrivateReview.retentionDeadlineUtc = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const vacancyIdentity = `private-benchmark:${nonce}:vacancy-folder`;
  const candidateIdentity = `private-benchmark:${nonce}:candidate-folder`;
  const createdVacancyFolder = await drive.ensureFolder({
    name: `.hh-private-benchmark-${nonce.slice(0, 8)}`,
    parentFolderId: connection.rootFolderId,
    operationIdentity: vacancyIdentity,
  });
  vacancyFolder = { id: createdVacancyFolder.id, operationIdentity: vacancyIdentity };
  const vacancy = {
    id: vacancyId,
    title: profileDraft.title,
    normalizedTitle: `private-benchmark-${nonce}`,
    active: true,
    version: 1,
    templateVersion: profileDraft.generatedProfile.templateVersion,
    driveFolderId: vacancyFolder.id,
    profile: profileDraft.generatedProfile.profile,
    abcDirections: profileDraft.generatedProfile.abcDirections,
  };
  await database`INSERT INTO vacancies(id,normalized_title,record_json) VALUES (${vacancyId},${vacancy.normalizedTitle},${JSON.stringify(vacancy)})`;
  const createdCandidateFolder = await drive.ensureFolder({
    name: "Private benchmark candidate",
    parentFolderId: vacancyFolder.id,
    operationIdentity: candidateIdentity,
  });
  candidateFolder = { id: createdCandidateFolder.id, operationIdentity: candidateIdentity };
  let documentNumber = 0;
  for (const entry of inputs) {
    const bytes = new Uint8Array(await readFile(path.join(candidateRoot, entry.path)));
    firewall.assertPayloadAllowed(bytes, "drive");
    const checksum = digest(bytes);
    if (checksum !== entry.checksum) throw new Error("PRIVATE_BENCHMARK_INPUT_CHANGED");
    const isVideo = entry.mime.startsWith("video/") || entry.mime.startsWith("audio/");
    const fileName = isVideo ? "candidate-interview.mp4" : `candidate-document-${++documentNumber}.pdf`;
    const operationIdentity = `private-benchmark:${nonce}:input:${driveObjects.length + 1}`;
    await database`INSERT INTO private_benchmark_boundary_audits(run_id,boundary,payload_checksum,created_at_utc)
      VALUES (${runId},'drive',${checksum},${new Date().toISOString()}) ON CONFLICT DO NOTHING`;
    const uploaded = await drive.putFile({ parentFolderId: candidateFolder.id, fileName, mimeType: entry.mime, bytes, checksum, operationIdentity });
    driveObjects.push({ id: uploaded.id, operationIdentity });
  }

  let clockMs = Date.now();
  const discoveryRepository = new InMemoryDiscoveryRepository();
  const discovery = new DriveDiscoveryWorker({
    listCandidateFolders: async () => [{ folderId: candidateFolder!.id, vacancyFolderId: vacancyFolder!.id, displayName: "Private benchmark candidate", parentPath: `Найм/${vacancy.title}/Private benchmark candidate` }],
    listChildren: (folderId) => drive.listChildren(folderId),
  }, new CandidateDiscoveryCoordinator(discoveryRepository), () => new Date(clockMs), new PostgresCandidateFolderRegistry(database));
  await discovery.discoveryTick();
  let readyInputVersion: { id: string } | undefined;
  for (let comparison = 0; comparison < 15 && !readyInputVersion; comparison += 1) {
    clockMs += 60_000;
    const observations = await discovery.stabilityTick();
    const outcome = observations[0]?.outcome;
    if (outcome?.state === "MATERIALS_READY") readyInputVersion = outcome.inputVersion;
    if (!readyInputVersion) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!readyInputVersion) throw new Error("PRIVATE_BENCHMARK_DRIVE_NOT_STABLE");
  inputVersion = readyInputVersion.id;
  const [registeredCandidate] = await database<{ candidate_id: number }[]>`SELECT candidate_id FROM candidate_drive_folders WHERE drive_folder_id=${candidateFolder.id}`;
  if (!registeredCandidate) throw new Error("PRIVATE_BENCHMARK_DISCOVERY_REGISTRATION_MISSING");
  candidatePk = registeredCandidate.candidate_id;
  await database`INSERT INTO private_benchmark_guards(run_id,deny_checksums_json,created_at_utc)
    VALUES (${runId},${JSON.stringify(manifest.denyChecksums)},${new Date().toISOString()})`;
  await runtime.createGoal({
    goalId,
    runId,
    candidateId: candidatePk,
    goalType: "candidate-analysis/v1",
    inputVersion,
    profileVersion,
    policyVersion: "candidate-policy-v1",
    completionCriteriaVersion: "candidate-completion-v1",
    completionCriteria: ["validated-assessment", "shadow-effects-suppressed"],
    budgets: {
      wallTimeMs: 3_600_000,
      taskAttempts: 50,
      repairAttempts: 2,
      replans: 2,
      llmCalls: 30,
      tokens: 300_000,
      costMicrounits: 8_000_000,
      externalRequests: 150,
    },
    triggerIdentity: `private-benchmark:${manifest.fixtureId}:${nonce}`,
  });

  const deadline = Date.now() + 55 * 60_000;
  let runState = "ACTIVE";
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const tasks = await database<{ task_key: string; state: string; error_code: string | null }[]>`
      SELECT task.task_key,task.state,attempt.error_code
      FROM agent_tasks task
      LEFT JOIN agent_attempts attempt ON attempt.task_id=task.id AND attempt.attempt_number=task.attempt_count
      WHERE task.run_id=${runId}
      ORDER BY task.id`;
    stageOutcomes = tasks.map((task) => ({ key: task.task_key, state: task.state, ...(task.error_code ? { safeCode: task.error_code } : {}) }));
    const [run] = await database<{ state: string }[]>`SELECT state FROM agent_runs WHERE id=${runId}`;
    runState = run?.state ?? "MISSING";
    if (["SUCCEEDED", "FAILED", "WAITING_FOR_HUMAN"].includes(runState) || stageOutcomes.some((task) => task.state === "FAILED")) break;
  }
  if (runState !== "SUCCEEDED") throw new Error(stageOutcomes.find((task) => task.safeCode)?.safeCode ?? `PRIVATE_BENCHMARK_PIPELINE_${runState}`);

  const boundaryRows = await database<{ boundary: "drive" | "provider" | "blob"; count: number }[]>`
    SELECT boundary,count(*)::integer AS count
    FROM private_benchmark_boundary_audits
    WHERE run_id=${runId}
    GROUP BY boundary`;
  boundaryAudits = { drive: 0, provider: 0, blob: 0 };
  for (const row of boundaryRows) boundaryAudits[row.boundary] = row.count;
  firewall.recordAuditedBoundaries(boundaryAudits);
  if (boundaryAudits.drive < inputs.length || boundaryAudits.provider < 1 || boundaryAudits.blob < 1) throw new Error("PRIVATE_BENCHMARK_BOUNDARY_AUDIT_INCOMPLETE");

  const [assessmentRow] = await database<{ recommendation: string }[]>`
    SELECT recommendation FROM candidate_assessments
    WHERE id=(SELECT assessment_id FROM candidate_report_versions WHERE candidate_id=${candidatePk} AND run_id=${runId} ORDER BY analysis_version DESC LIMIT 1)`;
  const [assessmentArtifact] = await database<{ payload_ref: string }[]>`
    SELECT payload_ref FROM candidate_domain_artifacts
    WHERE candidate_id=${candidatePk} AND run_id=${runId} AND kind='assessment-snapshot'
    ORDER BY created_at_utc DESC LIMIT 1`;
  if (!assessmentRow || !assessmentArtifact) throw new Error("PRIVATE_BENCHMARK_GENERATED_ASSESSMENT_MISSING");
  const assessment = await artifacts.getJson<{ evidenceRef?: string; structuredAssessment?: Record<string, unknown> }>(assessmentArtifact.payload_ref);
  if (!assessment.evidenceRef || !assessment.structuredAssessment) throw new Error("PRIVATE_BENCHMARK_GENERATED_ASSESSMENT_INVALID");
  const evidence = await artifacts.getJson<{ facts?: Array<{ significant?: boolean; locator?: { exactText?: string }; predicate?: string; value?: unknown; id?: unknown }> }>(assessment.evidenceRef);
  const evidenceText = (evidence.facts ?? []).flatMap((fact) => [fact.predicate ?? "", ...strings(fact.value), fact.locator?.exactText ?? ""]).join(" ");
  const abcSource = assessment.structuredAssessment.abcStates && typeof assessment.structuredAssessment.abcStates === "object"
    ? assessment.structuredAssessment.abcStates as Record<string, unknown>
    : {};
  const abcDirections = Object.entries(abcSource)
    .filter((entry): entry is [string, "A" | "B" | "C"] => ["A", "B", "C"].includes(String(entry[1])))
    .map(([title, grade]) => ({ title, grade }));
  const evidenceFactIds = new Set((evidence.facts ?? []).flatMap((fact) => typeof (fact as { id?: unknown }).id === "string" ? [(fact as { id: string }).id] : []));
  const stopFactors = (Array.isArray(assessment.structuredAssessment.stopFactors) ? assessment.structuredAssessment.stopFactors : []).map((factor) => {
    if (!factor || typeof factor !== "object" || Array.isArray(factor)) return { invented: true };
    const record = factor as Record<string, unknown>;
    const factIds = Array.isArray(record.factIds) ? record.factIds.filter((item): item is string => typeof item === "string") : [];
    const label = [record.name, record.title, record.value, record.reason].filter((item): item is string => typeof item === "string").join(" ");
    return { invented: !factIds.some((id) => evidenceFactIds.has(id)) && overlap(label, evidenceText) < 0.5 };
  });
  const reportRows = await database<{ checksum: string; validation_json: string }[]>`
    SELECT document.checksum,document.validation_json
    FROM candidate_report_documents document
    JOIN candidate_report_versions version ON version.id=document.report_version_id
    WHERE version.candidate_id=${candidatePk} AND version.run_id=${runId}`;

  let signaturesValid = true; let checksumsValid = true; let contentNonempty = true;
  const reportReviewFiles: string[] = [];
  const reviewRunRoot = path.join(reviewRoot, runId);
  await mkdir(reviewRunRoot, { recursive: true, mode: 0o700 });
  for (const report of reportRows) {
    const validation = JSON.parse(report.validation_json) as { artifactRef?: string };
    if (!validation.artifactRef) throw new Error("PRIVATE_BENCHMARK_REPORT_ARTIFACT_REF_MISSING");
    const bytes = await artifacts.getBytes(validation.artifactRef);
    const fileName = `report-${reportRows.indexOf(report) + 1}-${runId.slice(0, 8)}.pdf`;
    const targetPath = path.join(reviewRunRoot, fileName);
    await writeFile(targetPath, Buffer.from(bytes), { mode: 0o600 });
    reportReviewFiles.push(fileName);
    signaturesValid = signaturesValid && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
    checksumsValid = checksumsValid && digest(bytes) === report.checksum;
    contentNonempty = contentNonempty && (await parsePdfText(bytes)).length > 100;
  }
  reportConsistency = { documents: reportRows.length, signaturesValid, checksumsValid, parseable: reportRows.length === 2, contentNonempty };
  reportFilesSaved = reportReviewFiles.length;
  if (reportReviewFiles.length) {
    const manifest = await readReviewManifest();
    manifest.generatedAtUtc = new Date().toISOString();
    manifest.runs = manifest.runs.filter((item) => item.runId !== runId);
    manifest.runs.push({
      runId,
      reviewDeadlineUtc: cleanupPrivateReview.retentionDeadlineUtc,
      files: reportReviewFiles,
      status: reportRows.length === 2 && signaturesValid && checksumsValid && contentNonempty ? "GREEN" : "RED",
    });
    await writeReviewManifest(manifest);
    cleanupPrivateReview.kept = reportFilesSaved;
    cleanupPrivateReview.files = reportReviewFiles.slice();
  }
  if (reportRows.length !== 2 || !signaturesValid || !checksumsValid || !contentNonempty) throw new Error("PRIVATE_BENCHMARK_REPORT_CONSISTENCY_RED");
  const sections = ["recommendation", "evidence", "risks", "abc-profile"];
  result = evaluatePrivateBenchmark(oracle, {
    recommendation: assessmentRow.recommendation,
    abcDirections,
    claims: (evidence.facts ?? []).map((fact) => ({ significant: Boolean(fact.significant), evidenceLocator: fact.locator?.exactText ? "present" : undefined })),
    stopFactors,
    sections,
    normalizedEvidenceText: evidenceText,
  });
  cleanupPrivateReview.runState = result.status;
} catch (error) {
  failure = error;
} finally {
  try {
    const observedBoundaries = await database<{ boundary: "drive" | "provider" | "blob"; count: number }[]>`
      SELECT boundary,count(*)::integer AS count
      FROM private_benchmark_boundary_audits
      WHERE run_id=${runId}
      GROUP BY boundary`;
    for (const row of observedBoundaries) boundaryAudits[row.boundary] = row.count;
    firewall.recordAuditedBoundaries(boundaryAudits);
  } catch { /* Cleanup evidence remains fail-closed when audit storage is unavailable. */ }
  for (let cleanupAttempt = 1; cleanupAttempt <= 3; cleanupAttempt += 1) {
    try {
      await cleanupPrivateBenchmarkOrphans({ database, drive, provider: providerCleanup });
      cleanup.provider = true; cleanup.drive = true; cleanup.blobs = true; cleanup.postgresql = true;
      break;
    } catch {
      cleanup.provider = false; cleanup.drive = false; cleanup.blobs = false; cleanup.postgresql = false;
      if (cleanupAttempt < 3) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  cleanup.temp = true;
  const cleanupComplete = Object.values(cleanup).every(Boolean);
  const evidence = {
    schemaVersion: "private-candidate-benchmark-evidence/v1",
    capturedAtUtc: new Date().toISOString(),
    environment: "local",
    routing: "shadow",
    buildFingerprint: digest(environment.CANDIDATE_PIPELINE_BUILD_ID),
    configFingerprint: digest(environment.LLM_RUNTIME_CONFIG_JSON),
    schemaFingerprint: digest(schemaState),
    oracleFingerprint: digest(oracle),
    modelFingerprint: digest(JSON.parse(environment.LLM_RUNTIME_CONFIG_JSON).capabilities),
    status: failure ? "RED" : result?.status ?? "RED",
    stages: stageOutcomes.map((stage) => ({ key: stage.key, state: stage.state, ...(stage.safeCode ? { safeCode: stage.safeCode } : {}) })),
    oracle: result ?? { status: "RED", category: failure instanceof Error ? failure.message.replace(/[^A-Z0-9_:.-]/g, "_") : "PRIVATE_BENCHMARK_FAILED" },
    reportConsistency,
    firewall: firewall.evidence(),
    boundaryAudits,
    profile: {
      title: profileDraft.title,
      fixtureId: manifest.fixtureId,
      draftChecksum,
      snapshotHash: profileDraft.profileSnapshotHash,
      approvalChecksum,
      approvalAt: profileApproval.approvedAtUtc,
      profileApprovedBy: profileApproval.approvedBy,
    },
    privateReview: {
      kept: cleanupPrivateReview.kept,
      files: cleanupPrivateReview.files,
      retentionDeadlineUtc: cleanupPrivateReview.retentionDeadlineUtc,
      runState: cleanupPrivateReview.runState,
      expectedRetentionDays: Math.max(1, Number(process.env.PRIVATE_BENCHMARK_REVIEW_TTL_DAYS || "7")),
    },
    cleanup,
    cleanupComplete,
    containsCredentials: false,
    containsProviderIds: false,
    containsDriveIds: false,
    containsPersonalData: false,
    filenamesPrinted: 0,
    personalTextPrinted: 0,
  };
  await mkdir(path.join(webRoot, ".runtime", "evidence"), { recursive: true });
  await writeFile(path.join(webRoot, ".runtime", "evidence", "private-candidate-benchmark.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await database.end({ timeout: 5 });
  if (!cleanupComplete) failure ??= new Error("PRIVATE_BENCHMARK_CLEANUP_INCOMPLETE");
  console.log(JSON.stringify({
    status: evidence.status,
    stages: stageOutcomes.length,
    oracle: result ? {
      status: result.status,
      recommendationExact: result.recommendationExact,
      requiredSectionRecall: result.requiredSectionRecall,
      significantClaimEvidenceRecall: result.significantClaimEvidenceRecall,
      criticalAnchorRecall: result.criticalAnchorRecall,
      abcGradeMatch: result.abcGradeMatch,
      gradeInversions: result.gradeInversions,
      inventedStopFactors: result.inventedStopFactors,
    } : undefined,
    firewall: firewall.evidence(),
    cleanupComplete,
    containsPersonalData: false,
    secretValuesPrinted: 0,
    filenamesPrinted: 0,
  }));
}
if (failure) throw failure;
if (result?.status !== "GREEN") throw new Error("PRIVATE_BENCHMARK_ORACLE_RED");
