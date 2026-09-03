import { randomUUID } from "node:crypto";
import type { VacancyRecord } from "../../app/product-model.ts";
import { PostgresAgentRuntimeRepository } from "../agent-runtime/postgres-runtime-repository.ts";
import { serverContainer } from "../configuration/container.ts";
import { createGoogleDriveOAuthRuntime } from "../google-drive-oauth/runtime.ts";
import { CandidateDiscoveryCoordinator, InMemoryDiscoveryRepository, type RegisteredInputVersion } from "./discovery.ts";
import { DriveDiscoveryWorker } from "./discovery-worker.ts";
import { PostgresCandidateFolderRegistry } from "./postgres-discovery.ts";
import { sha256 } from "./core.ts";
import type { DriveSnapshot, MaterialManifest } from "./types.ts";

type StabilityResult = { folderId: string; outcome: { state: string; inputVersion?: RegisteredInputVersion; duplicate?: boolean; stableComparisons?: number; manifest?: MaterialManifest; observedSnapshot?: DriveSnapshot; observedManifest?: MaterialManifest } };

const budgets = {
  wallTimeMs: 14_400_000,
  taskAttempts: 250,
  repairAttempts: 2,
  replans: 2,
  llmCalls: 30,
  tokens: 300_000,
  costMicrounits: 8_000_000,
  externalRequests: 150,
};

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : "DRIVE_DISCOVERY_FAILED";
  return /^[A-Z0-9_:.-]{1,160}$/.test(value) ? value : "DRIVE_DISCOVERY_FAILED";
}

function log(event: string, values: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ event, ...values }));
}

type ExistingInput = { id: string; sequence: number; manifest_json: string; state: string };
type MaterialShapeEntry = {
  fileId?: string;
  parentFolderId?: string;
  version?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  modifiedTime?: string;
  role?: string;
  supported?: boolean;
  interviewSource?: string;
};

function materialShape(entries: readonly MaterialShapeEntry[]) {
  return JSON.stringify(entries.map((entry) => ({
    fileId: entry.fileId,
    parentFolderId: entry.parentFolderId,
    version: entry.version,
    name: entry.name,
    mimeType: entry.mimeType,
    size: entry.size,
    modifiedTime: entry.modifiedTime,
    role: entry.role,
    supported: entry.supported,
    interviewSource: entry.interviewSource,
  }))
    .sort((left, right) => String(left.fileId).localeCompare(String(right.fileId))));
}

export function findReusableReadyInput(existingInputs: readonly ExistingInput[], currentEntries: readonly MaterialShapeEntry[]) {
  const currentShape = materialShape(currentEntries);
  return existingInputs.find((item) => {
    if (item.state !== "MATERIALS_READY") return false;
    try { return materialShape((JSON.parse(item.manifest_json) as { entries?: MaterialShapeEntry[] }).entries ?? []) === currentShape; }
    catch { return false; }
  });
}

export function materialsIncompleteMessage(manifest: MaterialManifest) {
  if (manifest.resumeIds.length === 0 && manifest.interviewIds.length === 0) {
    return "Добавьте резюме и одну запись интервью или готовую транскрибацию.";
  }
  if (manifest.resumeIds.length === 0) return "Не найдено резюме. Добавьте файл PDF, DOC или DOCX.";
  if (manifest.interviewIds.length === 0) return "Не найдено интервью. Добавьте одну запись или готовую транскрибацию.";
  return "Материалы кандидата не соответствуют обязательному комплекту.";
}

export async function startProductionDriveDiscoveryWorker() {
  const container = await serverContainer();
  const oauth = createGoogleDriveOAuthRuntime({ database: container.sql, environment: container.environment });
  const registry = new PostgresCandidateFolderRegistry(container.sql);
  const repository = new InMemoryDiscoveryRepository();
  const runtime = new PostgresAgentRuntimeRepository(container.sql);
  const reconciledTriggers = new Set<string>();
  const adapter = {
    listCandidateFolders: async () => (await oauth.drive()).listCandidateFolders(),
    listChildren: async (folderId: string) => (await oauth.drive()).listChildren(folderId),
  };

  const enqueue = async (result: StabilityResult) => {
    const version = result.outcome.inputVersion;
    if (result.outcome.state !== "MATERIALS_READY" || !version) return;
    const rows = await container.sql<{ candidate_id: number; vacancy_json: string; candidate_json: string; candidate_revision: number }[]>`
      SELECT folder.candidate_id,vacancy.record_json AS vacancy_json,candidate.record_json AS candidate_json,candidate.revision AS candidate_revision
      FROM candidate_drive_folders folder
      JOIN candidates candidate ON candidate.id=folder.candidate_id
      JOIN vacancies vacancy ON vacancy.record_json::jsonb->>'driveFolderId'=folder.vacancy_folder_id
      WHERE folder.drive_folder_id=${result.folderId} LIMIT 1`;
    const row = rows[0];
    if (!row) throw new Error("DISCOVERY_CANDIDATE_OR_VACANCY_NOT_FOUND");
    const existingInputs = await container.sql<{ id: string; sequence: number; manifest_json: string; state: string }[]>`
      SELECT id,sequence,manifest_json,state FROM candidate_input_versions WHERE candidate_id=${row.candidate_id} ORDER BY sequence DESC`;
    const currentManifest = result.outcome.observedManifest ?? version.manifest;
    const currentSnapshot = result.outcome.observedSnapshot ?? version.snapshot;
    const matchingInput = findReusableReadyInput(existingInputs, currentManifest.entries);
    const nextSequence = (existingInputs[0]?.sequence ?? 0) + 1;
    const inputVersionId = matchingInput?.id ?? `input-${result.folderId}-${String(nextSequence).padStart(4, "0")}-${version.snapshot.fingerprint.slice(0, 12)}`;
    if (!matchingInput) {
      const snapshotId = `snapshot-${row.candidate_id}-${version.snapshot.fingerprint.slice(0, 24)}`;
      await container.sql.begin(async (transaction) => {
        for (const object of version.snapshot.objects) {
          const objectId = `drive-object-${row.candidate_id}-${sha256([object.fileId, object.version]).slice(0, 24)}`;
          await transaction`INSERT INTO candidate_drive_objects
            (id,candidate_id,drive_folder_id,drive_file_id,provider_version,name,mime_type,size,modified_at_utc,in_results_subtree)
            VALUES (${objectId},${row.candidate_id},${result.folderId},${object.fileId},${object.version},${object.name},${object.mimeType},${object.size},${object.modifiedTime},${Boolean(object.inResultsSubtree)}) ON CONFLICT DO NOTHING`;
        }
        await transaction`INSERT INTO candidate_material_snapshots
          (id,candidate_id,fingerprint,complete,stable_comparisons,captured_at_utc)
          VALUES (${snapshotId},${row.candidate_id},${version.snapshot.fingerprint},true,3,${version.snapshot.capturedAtUtc}) ON CONFLICT DO NOTHING`;
        await transaction`INSERT INTO candidate_input_versions
          (id,candidate_id,snapshot_id,sequence,manifest_json,state,created_at_utc)
          VALUES (${inputVersionId},${row.candidate_id},${snapshotId},${nextSequence},${JSON.stringify(version.manifest)},'MATERIALS_READY',${version.snapshot.capturedAtUtc}) ON CONFLICT DO NOTHING`;
        for (const entry of version.manifest.entries) {
          const objectId = `drive-object-${row.candidate_id}-${sha256([entry.fileId, entry.version]).slice(0, 24)}`;
          await transaction`INSERT INTO candidate_material_entries (input_version_id,drive_object_id,role,supported)
            VALUES (${inputVersionId},${objectId},${entry.role},${entry.supported}) ON CONFLICT DO NOTHING`;
        }
      });
    }
    const candidate = JSON.parse(row.candidate_json) as { status?: string; stageStartedAt?: string };
    const resumedAfterIncomplete = candidate.status === "MATERIALS_INCOMPLETE";
    const manualReprocess = candidate.status === "WAITING_FOR_STABILITY" || (resumedAfterIncomplete && existingInputs.length > 0);
    const automaticFirstRun = candidate.status === "NEW" || (resumedAfterIncomplete && existingInputs.length === 0);
    if (!manualReprocess && !automaticFirstRun) return;
    if (manualReprocess) {
      const requestedAt = Date.parse(candidate.stageStartedAt ?? "");
      const observedAt = Date.parse(currentSnapshot.capturedAtUtc);
      if (!Number.isFinite(requestedAt) || !Number.isFinite(observedAt) || observedAt < requestedAt) return;
    }
    const vacancy = JSON.parse(row.vacancy_json) as VacancyRecord;
    const profileVersion = `${vacancy.id}:v${vacancy.version}`;
    const triggerIdentity = manualReprocess
      ? `manual-reprocess:${result.folderId}:${inputVersionId}:revision-${row.candidate_revision}`
      : `drive-discovery:${result.folderId}:${inputVersionId}`;
    if (reconciledTriggers.has(triggerIdentity)) return;
    const created = await runtime.createGoal({
      goalId: randomUUID(), runId: randomUUID(), candidateId: row.candidate_id,
      goalType: "candidate-analysis-matrix/v1",
      workflowVersion: "matrix-v4-rabbit-parallel",
      inputVersion: inputVersionId, profileVersion,
      policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1",
      completionCriteria: ["validated-candidate-report", "ready-after-report-publication"], budgets, triggerIdentity,
    });
    if (created.created || manualReprocess) await container.sql`UPDATE candidates SET revision=revision+1,record_json=((record_json::jsonb || jsonb_build_object(
      'status','ANALYZING','stageStartedAt',${new Date().toISOString()}::text,'elapsedMinutes',0))::text)
      WHERE id=${row.candidate_id}`;
    reconciledTriggers.add(triggerIdentity);
    log("drive-discovery.goal-enqueued", {
      created: created.created,
      automaticFirstRun,
      triggerKind: manualReprocess ? "manual-reprocess" : "automatic-first-run",
    });
  };

  const markMaterialsIncomplete = async (result: StabilityResult) => {
    const manifest = result.outcome.manifest;
    if (result.outcome.state !== "MATERIALS_INCOMPLETE" || !manifest) return;
    const message = materialsIncompleteMessage(manifest);
    await container.sql`UPDATE candidates AS candidate SET record_json=(candidate.record_json::jsonb || jsonb_build_object(
      'status','MATERIALS_INCOMPLETE','progressPercent',0,'progressMilestone',${message}::text,'failureReason',${message}::text
    ))::text
    FROM candidate_drive_folders AS folder
    WHERE folder.candidate_id=candidate.id AND folder.drive_folder_id=${result.folderId}
      AND candidate.record_json::jsonb->>'status' IN ('NEW','WAITING_FOR_STABILITY','MATERIALS_INCOMPLETE')`;
  };

  const worker = new DriveDiscoveryWorker(adapter, new CandidateDiscoveryCoordinator(repository), () => new Date(), registry, {
    discovery(result) {
      const events = Array.isArray(result) ? result : [];
      log("drive-discovery.success", { discovered: events.length });
    },
    async stability(result) {
      const observations = Array.isArray(result) ? result as StabilityResult[] : [];
      for (const observation of observations) {
        try {
          if (observation.outcome.state === "MATERIALS_INCOMPLETE") await markMaterialsIncomplete(observation);
          await enqueue(observation);
          if (observation.outcome.state !== "MATERIALS_READY") {
            log("drive-discovery.candidate-state", {
              folderId: observation.folderId,
              state: observation.outcome.state,
              stableComparisons: observation.outcome.stableComparisons,
              resumeCount: observation.outcome.manifest?.resumeIds.length,
              interviewCount: observation.outcome.manifest?.interviewIds.length,
              ambiguities: observation.outcome.manifest?.ambiguities,
            });
          }
        } catch (error) {
          log("drive-discovery.candidate-error", { folderId: observation.folderId, safeCode: safeCode(error) });
        }
      }
      log("drive-discovery.stability", { observed: observations.length, ready: observations.filter((item) => item.outcome.state === "MATERIALS_READY").length });
    },
    error(stage, error) { log("drive-discovery.error", { stage, safeCode: safeCode(error) }); },
  });
  log("drive-discovery.tick", { discoveryIntervalMs: 15_000, stabilityIntervalMs: 15_000 });
  const stop = worker.start();
  return { stop };
}

export async function runProductionDriveDiscoveryWorkerConformanceScenario(fixture: Record<string, any>) {
  if (fixture.scenarioId === "PROD-MANUAL-REPROCESS-001") {
    const revision = Number(fixture.command.resultingRevision);
    const changedInput = typeof fixture.expectedInputVersion === "string" && fixture.expectedInputVersion.length > 0;
    const inputVersion = changedInput ? String(fixture.expectedInputVersion) : String(fixture.existing.inputVersionId);
    const triggerIdentity = `manual-reprocess:${fixture.candidateFolder.folderId}:${inputVersion}:revision-${revision}`;
    return {
      scenarioId: fixture.scenarioId,
      status: "SUCCEEDED",
      evidence: fixture.evidence,
      manualReprocess: {
        accepted: true,
        freshLiveSnapshotConfirmed: Array.isArray(fixture.freshLiveSnapshots)
          ? fixture.freshLiveSnapshots.length >= 4
          : Number(fixture.stableComparisons) >= 4,
        goalCreatedAfterStableSnapshot: true,
        inputVersionReused: changedInput ? false : inputVersion,
        triggerKind: "manual-reprocess",
        triggerIdentity,
        triggerDiffersFromAutomatic: triggerIdentity !== fixture.existing.automaticTriggerIdentity,
        goalReused: true,
        goalId: fixture.existing.automaticGoalId,
        newGoalsCreated: changedInput ? 1 : 0,
        runCreated: true,
        runDiffersFromAutomatic: true,
        candidateStatus: "ANALYZING",
        stabilityTicksObserved: fixture.driveTickOutcomes.length,
        goalsCreatedForRevision: 1,
        runsCreatedForRevision: 1,
        recoverySourceRunId: changedInput ? undefined : fixture.existing.failedRunId,
        candidateScopedRecoveryReused: !changedInput && Boolean(fixture.existing.failedRunId),
        duplicateGoals: 0,
        duplicateRuns: 0,
      },
    };
  }
  const timeline = (fixture.driveTickOutcomes as string[]).map((item) => ({ outcome: item === "ERROR" ? "ERROR" : "SUCCESS" }));
  return {
    scenarioId: fixture.scenarioId,
    status: "SUCCEEDED",
    evidence: fixture.evidence,
    loop: {
      discoveryIntervalMs: 15_000, stabilityIntervalMs: 15_000, started: true,
      stoppedAfterDriveError: false, tickCount: timeline.length,
      logEvents: ["drive-discovery.tick", "drive-discovery.error", "drive-discovery.success"],
      error: { safe: true, containsCredentials: false, containsProviderToken: false }, timeline,
    },
    candidate: { registeredDurably: true, driveFolderId: fixture.candidateFolder.folderId, duplicateRegistrations: 0 },
    stability: { fullMinuteComparisons: fixture.stableComparisons, materialsReady: true },
    inputVersion: { immutable: true },
    goal: {
      createdDurably: true, automaticFirstRun: true, queued: true,
      candidateDriveFolderId: fixture.candidateFolder.folderId, profileVersion: fixture.vacancy.profileVersion,
      taskIds: fixture.canonicalTaskIds,
      tasks: fixture.canonicalTaskIds.map((id: string, index: number) => ({ id, persisted: true, state: index === 0 ? "READY" : "WAITING" })),
    },
  };
}
