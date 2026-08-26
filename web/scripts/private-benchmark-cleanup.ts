import type { GoogleDrivePort } from "../server/google-drive-oauth/my-drive-adapter.ts";
import { PostgresBlobStore } from "../server/storage/blob-store.ts";
import type { PostgresClient } from "../server/storage/postgres.ts";

type ProviderCleanup = { remove(remoteJobId: string): Promise<void> };
type DriveCleanupRow = { file_id: string; parent_id: string | null; operation_identity: string; kind: string };

export async function cleanupPrivateBenchmarkOrphans(input: {
  database: PostgresClient;
  drive: GoogleDrivePort;
  provider: ProviderCleanup;
}) {
  const runRows = await input.database<{ run_id: string; candidate_id: number }[]>`SELECT run.id AS run_id,goal.candidate_id
    FROM agent_runs run JOIN agent_goals goal ON goal.id=run.goal_id WHERE run.id LIKE 'private-benchmark-run-%'`;
  const remoteJobs = await input.database<{ remote_job_id: string }[]>`SELECT DISTINCT checkpoint.remote_job_id FROM agent_checkpoints checkpoint
    JOIN agent_attempts attempt ON attempt.id=checkpoint.attempt_id JOIN agent_tasks task ON task.id=attempt.task_id
    WHERE task.run_id LIKE 'private-benchmark-run-%' AND checkpoint.remote_job_id IS NOT NULL`;
  let providerRemoved = 0;
  for (const job of remoteJobs) {
    await input.provider.remove(job.remote_job_id);
    providerRemoved += 1;
  }

  await input.database`UPDATE google_drive_registered_objects SET kind='derived'
    WHERE operation_identity LIKE 'private-benchmark:%' AND kind='file'`;
  const driveRows = await input.database<DriveCleanupRow[]>`SELECT file_id,parent_id,operation_identity,kind
    FROM google_drive_registered_objects WHERE operation_identity LIKE 'private-benchmark:%'`;
  const byId = new Map(driveRows.map((row) => [row.file_id, row]));
  const depth = (row: DriveCleanupRow) => {
    let current = row; let value = 0; const visited = new Set<string>();
    while (current.parent_id && byId.has(current.parent_id) && !visited.has(current.parent_id)) {
      visited.add(current.parent_id); current = byId.get(current.parent_id)!; value += 1;
    }
    return value;
  };
  driveRows.sort((left, right) => depth(right) - depth(left) || (left.kind === "folder" ? 1 : -1));
  let driveRemoved = 0;
  for (const row of driveRows) {
    await input.drive.removeCreatedObject({ fileId: row.file_id, operationIdentity: row.operation_identity });
    driveRemoved += 1;
  }

  const blobs = new PostgresBlobStore(input.database);
  let blobScopesRemoved = 0;
  for (const row of runRows) {
    await blobs.deleteScope(`candidate:${row.candidate_id}:run:${row.run_id}`, true);
    blobScopesRemoved += 1;
  }
  const deleted = await input.database.begin(async (transaction) => {
    await transaction`INSERT INTO candidate_tombstones (candidate_id,deleted_at)
      SELECT id,${new Date().toISOString()} FROM candidates WHERE record_json::jsonb->>'vacancyId' LIKE 'private-benchmark-vacancy-%'
      ON CONFLICT (candidate_id) DO NOTHING`;
    await transaction`SELECT set_config('hh.cleanup_run_ids',${runRows.map((row) => row.run_id).join(",")},true)`;
    const candidates = await transaction`DELETE FROM candidates WHERE record_json::jsonb->>'vacancyId' LIKE 'private-benchmark-vacancy-%' RETURNING id`;
    const vacancies = await transaction`DELETE FROM vacancies WHERE id LIKE 'private-benchmark-vacancy-%' RETURNING id`;
    const generations = await transaction`DELETE FROM vacancy_generation_operations WHERE operation_id LIKE 'private-benchmark-vacancy-generation-%' RETURNING operation_id`;
    await transaction`DELETE FROM private_benchmark_boundary_audits WHERE run_id LIKE 'private-benchmark-run-%'`;
    await transaction`DELETE FROM private_benchmark_guards WHERE run_id LIKE 'private-benchmark-run-%'`;
    return { candidates: candidates.length, vacancies: vacancies.length, generations: generations.length };
  });
  return { runs: runRows.length, providerRemoved, driveRemoved, blobScopesRemoved, ...deleted };
}
