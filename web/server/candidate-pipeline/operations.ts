import { estimateRemainingDuration } from "./core.ts";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";

export function successTelegramTemplate(input: { candidate: string; vacancy: string; stopFactor?: string; recommendation: string; accessToKe: string; resultPdfUrl: string }) {
  return [`Анализ кандидата завершён`, `Кандидат: ${input.candidate}`, `Вакансия: ${input.vacancy}`, input.stopFactor ? `Стоп-фактор: ${input.stopFactor}` : undefined, `Результат: ${input.recommendation}`, `Допуск к КЕ: ${input.accessToKe}`, `Итоговый PDF: ${input.resultPdfUrl}`].filter(Boolean).join("\n");
}

export function errorTelegramTemplate(input: { candidate: string; vacancy: string; safeReason: "MISSING_MATERIAL" | "CORRUPT_FILE" | "PROVIDER_UNAVAILABLE" | "REPORT_VERSION_CONFLICT"; fileName?: string }) {
  const reasons = { MISSING_MATERIAL: "не хватает обязательных материалов", CORRUPT_FILE: `не удалось прочитать файл${input.fileName ? ` «${input.fileName}»` : ""}`, PROVIDER_UNAVAILABLE: "внешний сервис временно недоступен", REPORT_VERSION_CONFLICT: "версия отчёта занята другим содержимым" };
  return `Обработка кандидата завершилась ошибкой\nКандидат: ${input.candidate}\nВакансия: ${input.vacancy}\nПричина: ${reasons[input.safeReason]}`;
}

export type Milestone = { stage: string; startedAtUtc: string; endedAtUtc?: string; durationMs?: number; retries: number; providerWaitMs: number; queueWaitMs: number; outcome: "RUNNING" | "SUCCEEDED" | "FAILED" };

export class MilestoneRecorder {
  private readonly milestones = new Map<string, Milestone & { startedTick: number }>();
  constructor(private readonly utc: () => Date = () => new Date(), private readonly monotonic: () => number = () => performance.now()) {}
  start(stage: string, queueWaitMs = 0) { this.milestones.set(stage, { stage, startedAtUtc: this.utc().toISOString(), startedTick: this.monotonic(), retries: 0, providerWaitMs: 0, queueWaitMs, outcome: "RUNNING" }); }
  retry(stage: string) { const value = this.must(stage); value.retries += 1; }
  providerWait(stage: string, durationMs: number) { const value = this.must(stage); value.providerWaitMs += Math.max(0, durationMs); }
  finish(stage: string, outcome: "SUCCEEDED" | "FAILED") { const value = this.must(stage); value.durationMs = Math.max(0, this.monotonic() - value.startedTick); value.endedAtUtc = this.utc().toISOString(); value.outcome = outcome; return this.safe(value); }
  snapshot() { return [...this.milestones.values()].map((value) => this.safe(value)); }
  eta(samples: readonly number[]) { return estimateRemainingDuration(samples); }
  private must(stage: string) { const value = this.milestones.get(stage); if (!value) throw new Error("MILESTONE_NOT_STARTED"); return value; }
  private safe(value: Milestone & { startedTick: number }): Milestone { const safe = structuredClone(value) as Milestone & { startedTick?: number }; delete safe.startedTick; return safe; }
}

export type CleanupAdapter = { key: string; cleanup(candidateId: string): Promise<boolean> };
export class CandidateCleanupGoal {
  constructor(private readonly adapters: readonly CleanupAdapter[]) {}
  async execute(candidateId: string, driveFolderId: string) {
    const confirmations: Record<string, boolean> = {};
    for (const adapter of this.adapters) {
      try { confirmations[adapter.key] = await adapter.cleanup(candidateId); }
      catch { confirmations[adapter.key] = false; }
    }
    const complete = Object.values(confirmations).every(Boolean) && Object.keys(confirmations).length === this.adapters.length;
    return { state: complete ? "COMPLETE" as const : "INCOMPLETE" as const, triggersBlocked: true, confirmations, tombstone: complete ? { driveFolderId, cleanupState: "COMPLETE" as const } : undefined };
  }
}

export type DurableCleanupAdapter = { key: "runtime" | "domain" | "provider" | "temp" | "reports"; cleanup(candidateId: number): Promise<boolean> };

export class PostgresCandidateCleanupGoal {
  private readonly db: PostgresClient; private readonly adapters: readonly DurableCleanupAdapter[];
  constructor(db: PostgresClient, adapters: readonly DurableCleanupAdapter[]) { this.db = db; this.adapters = adapters; }

  async execute(candidateId: number, driveFolderId: string, nowUtc = new Date().toISOString()) {
    const rows = await this.db<{ drive_folder_id: string; confirmations_json: string }[]>`SELECT drive_folder_id,confirmations_json FROM candidate_cleanup_states WHERE candidate_id=${candidateId}`; const current = rows[0];
    if (current && current.drive_folder_id !== driveFolderId) throw new Error("CLEANUP_DRIVE_FOLDER_MISMATCH");
    const confirmations = current ? JSON.parse(current.confirmations_json) as Record<string, boolean> : {};
    await this.db`INSERT INTO candidate_cleanup_states (candidate_id,drive_folder_id,state,confirmations_json) VALUES (${candidateId},${driveFolderId},'INCOMPLETE',${JSON.stringify(confirmations)}) ON CONFLICT (candidate_id) DO NOTHING`;
    for (const adapter of this.adapters) {
      if (confirmations[adapter.key]) continue;
      try { confirmations[adapter.key] = await adapter.cleanup(candidateId); }
      catch { confirmations[adapter.key] = false; }
      await this.db`UPDATE candidate_cleanup_states SET state='INCOMPLETE',confirmations_json=${JSON.stringify(confirmations)} WHERE candidate_id=${candidateId}`;
    }
    const required = ["runtime", "domain", "provider", "temp", "reports"] as const;
    const complete = required.every((key) => confirmations[key] === true);
    if (!complete) return { state: "INCOMPLETE" as const, triggersBlocked: true, confirmations };
    await withTransaction(this.db, async (transaction) => {
      await transaction`UPDATE candidate_cleanup_states SET state='COMPLETE',confirmations_json=${JSON.stringify(confirmations)},deleted_at_utc=${nowUtc} WHERE candidate_id=${candidateId}`;
      await transaction`INSERT INTO candidate_drive_folder_tombstones (drive_folder_id,deleted_at_utc,cleanup_evidence_json) VALUES (${driveFolderId},${nowUtc},${JSON.stringify({ candidateId, confirmations })}) ON CONFLICT (drive_folder_id) DO NOTHING`;
    });
    return { state: "COMPLETE" as const, triggersBlocked: true, confirmations, tombstone: { driveFolderId, cleanupState: "COMPLETE" as const } };
  }
}
