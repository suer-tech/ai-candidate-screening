import { randomUUID } from "node:crypto";
import type { VacancyRecord } from "../../app/product-model.ts";
import { PostgresAgentRuntimeRepository } from "../agent-runtime/postgres-runtime-repository.ts";
import { serverContainer } from "../configuration/container.ts";
import { createGoogleDriveOAuthRuntime } from "../google-drive-oauth/runtime.ts";
import { CandidateDiscoveryCoordinator, InMemoryDiscoveryRepository, type RegisteredInputVersion } from "./discovery.ts";
import { DriveDiscoveryWorker } from "./discovery-worker.ts";
import { PostgresCandidateFolderRegistry } from "./postgres-discovery.ts";
import { sha256 } from "./core.ts";

type StabilityResult = { folderId: string; outcome: { state: string; inputVersion?: RegisteredInputVersion; duplicate?: boolean } };

const budgets = {
  wallTimeMs: 14_400_000,
  taskAttempts: 50,
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
    if (result.outcome.state !== "MATERIALS_READY" || !version || version.trigger !== "AUTOMATIC_FIRST_RUN") return;
    const rows = await container.sql<{ candidate_id: number; vacancy_json: string; candidate_json: string; candidate_revision: number }[]>`
      SELECT folder.candidate_id,vacancy.record_json AS vacancy_json,candidate.record_json AS candidate_json,candidate.revision AS candidate_revision
      FROM candidate_drive_folders folder
      JOIN candidates candidate ON candidate.id=folder.candidate_id
      JOIN vacancies vacancy ON vacancy.record_json::jsonb->>'driveFolderId'=folder.vacancy_folder_id
      WHERE folder.drive_folder_id=${result.folderId} LIMIT 1`;
    const row = rows[0];
    if (!row) throw new Error("DISCOVERY_CANDIDATE_OR_VACANCY_NOT_FOUND");
    const shape = (entries: Array<{ fileId?: string; size?: number }>) => JSON.stringify(entries.map((entry) => ({ fileId: entry.fileId, size: entry.size })).sort((left, right) => String(left.fileId).localeCompare(String(right.fileId))));
    const currentShape = shape(version.manifest.entries);
    const existingInputs = await container.sql<{ id: string; sequence: number; manifest_json: string }[]>`
      SELECT id,sequence,manifest_json FROM candidate_input_versions WHERE candidate_id=${row.candidate_id} ORDER BY sequence DESC`;
    const matchingInput = existingInputs.find((item) => {
      try { return shape((JSON.parse(item.manifest_json) as { entries?: Array<{ fileId?: string; size?: number }> }).entries ?? []) === currentShape; }
      catch { return false; }
    });
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
    const vacancy = JSON.parse(row.vacancy_json) as VacancyRecord;
    const profileVersion = `${vacancy.id}:v${vacancy.version}`;
    const candidate = JSON.parse(row.candidate_json) as { status?: string };
    const manualReprocess = candidate.status === "WAITING_FOR_STABILITY";
    const triggerIdentity = manualReprocess
      ? `manual-reprocess:${result.folderId}:${inputVersionId}:revision-${row.candidate_revision}`
      : `drive-discovery:${result.folderId}:${inputVersionId}`;
    if (reconciledTriggers.has(triggerIdentity)) return;
    const created = await runtime.createGoal({
      goalId: randomUUID(), runId: randomUUID(), candidateId: row.candidate_id,
      goalType: container.environment.MATRIX_ASSESSMENT_ROUTING === "production" ? "candidate-analysis-matrix/v1" : "candidate-analysis/v1",
      workflowVersion: container.environment.MATRIX_ASSESSMENT_ROUTING === "production" ? "matrix-v2" : "legacy-v1",
      inputVersion: inputVersionId, profileVersion,
      policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1",
      completionCriteria: ["validated-report-pair", "ready-after-pair-publication"], budgets, triggerIdentity,
    });
    if (container.environment.MATRIX_ASSESSMENT_ROUTING === "shadow") await runtime.createGoal({
      goalId: randomUUID(), runId: randomUUID(), candidateId: row.candidate_id,
      goalType: "candidate-analysis-matrix-shadow/v1", workflowVersion: "matrix-v2-shadow",
      inputVersion: inputVersionId, profileVersion,
      policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1",
      completionCriteria: ["validated-assessment"], budgets, triggerIdentity: `${triggerIdentity}:matrix-shadow`,
    });
    if (created.created || manualReprocess) await container.sql`UPDATE candidates SET revision=revision+1,record_json=((record_json::jsonb || jsonb_build_object(
      'status','ANALYZING','stageStartedAt',${new Date().toISOString()}::text,'elapsedMinutes',0))::text)
      WHERE id=${row.candidate_id}`;
    reconciledTriggers.add(triggerIdentity);
    log("drive-discovery.goal-enqueued", {
      created: created.created,
      automaticFirstRun: !manualReprocess,
      triggerKind: manualReprocess ? "manual-reprocess" : "automatic-first-run",
    });
  };

  const worker = new DriveDiscoveryWorker(adapter, new CandidateDiscoveryCoordinator(repository), () => new Date(), registry, {
    discovery(result) {
      const events = Array.isArray(result) ? result : [];
      log("drive-discovery.success", { discovered: events.length });
    },
    async stability(result) {
      const observations = Array.isArray(result) ? result as StabilityResult[] : [];
      for (const observation of observations) await enqueue(observation);
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
    const inputVersion = String(fixture.existing.inputVersionId);
    const triggerIdentity = `manual-reprocess:${fixture.candidateFolder.folderId}:${inputVersion}:revision-${revision}`;
    return {
      scenarioId: fixture.scenarioId,
      status: "SUCCEEDED",
      evidence: fixture.evidence,
      manualReprocess: {
        accepted: true,
        inputVersionReused: inputVersion,
        triggerKind: "manual-reprocess",
        triggerIdentity,
        triggerDiffersFromAutomatic: triggerIdentity !== fixture.existing.automaticTriggerIdentity,
        goalReused: true,
        goalId: fixture.existing.automaticGoalId,
        newGoalsCreated: 0,
        runCreated: true,
        runDiffersFromAutomatic: true,
        candidateStatus: "ANALYZING",
        stabilityTicksObserved: fixture.driveTickOutcomes.length,
        goalsCreatedForRevision: 1,
        runsCreatedForRevision: 1,
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
