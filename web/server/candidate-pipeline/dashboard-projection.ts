import type { CandidateAiOverview, CandidateRecord, CandidateTranscript, Recommendation, ResultDocument, ResultDocumentType } from "../../app/product-model.ts";
import { candidateFailureMessage } from "../agent-runtime/failure-policy.ts";

export type RuntimeProjectionRow = { runId: string; runState: string; workflowVersion?: string; startedAt?: string; lastProgressAt: string; taskKey?: string; taskState?: string; attemptCount?: number; errorCode?: string; matrixState?: "CLAIMED" | "PUBLISHED" | "FAILED"; matrixRepairCount?: number; matrixTerminalErrorCode?: string };
export type ReadyReportProjection = { runId: string; analysisVersion: number; completedAt: string; elapsedMinutes: number; recommendation: Recommendation; assessment?: CandidateAiOverview; transcript?: CandidateTranscript; documents: Array<{ id: string; type: ResultDocumentType; fileName: string; driveFileId: string }> };

const PROGRESS_BY_TASK: Readonly<Record<string, { percent: number; milestone: string }>> = Object.freeze({
  discovery: { percent: 5, milestone: "Папка кандидата обнаружена" },
  "drive-snapshot": { percent: 10, milestone: "Состав материалов зафиксирован" },
  documents: { percent: 25, milestone: "Документы обработаны" },
  transcription: { percent: 40, milestone: "Транскрипция готова" },
  matrix: { percent: 20, milestone: "Матрица вакансии компилируется" },
  claims: { percent: 52, milestone: "Утверждения по критериям извлечены" },
  "global-evidence": { percent: 62, milestone: "Глобальные противоречия проверены" },
  rows: { percent: 72, milestone: "Матрица кандидата заполнена" },
  "critical-verification": { percent: 78, milestone: "Критические строки проверяются" },
  recommendation: { percent: 80, milestone: "Рекомендация рассчитана" },
  evidence: { percent: 55, milestone: "Доказательства собраны" },
  assessment: { percent: 70, milestone: "Оценка сформирована" },
  validation: { percent: 80, milestone: "Результат проверен" },
  reports: { percent: 90, milestone: "Отчёт сформирован" },
  publication: { percent: 100, milestone: "Результат опубликован" },
  "documents-plan": { percent: 18, milestone: "Документы распределяются по обработчикам" },
  "documents-join": { percent: 30, milestone: "Результаты документов собраны" },
  "transcripts-plan": { percent: 18, milestone: "Интервью распределяются по обработчикам" },
  "transcripts-join": { percent: 42, milestone: "Все интервью обработаны" },
  "evidence-plan": { percent: 48, milestone: "Поиск доказательств распределяется по батчам" },
  "evidence-join": { percent: 58, milestone: "Доказательства по всем батчам собраны" },
  "rows-plan": { percent: 64, milestone: "Оценка критериев распределяется по группам" },
  "rows-join": { percent: 72, milestone: "Все критерии вакансии оценены" },
  "abc-plan": { percent: 64, milestone: "ABC-направления оцениваются" },
  "abc-join": { percent: 72, milestone: "ABC-профиль собран" },
  "assessment-join": { percent: 75, milestone: "Первичная оценка объединяется" },
  "critical-plan": { percent: 77, milestone: "Критические выводы отобраны для проверки" },
  "critical-join": { percent: 79, milestone: "Критические выводы проверены" },
});

function progressForTask(key: string | undefined) {
  if (!key) return undefined;
  const direct = PROGRESS_BY_TASK[key]; if (direct) return direct;
  if (key.startsWith("documents:shard:")) return { percent: 24, milestone: "Документы обрабатываются параллельно" };
  if (key.startsWith("transcripts:shard:")) return { percent: 35, milestone: "Интервью транскрибируются параллельно" };
  if (key.startsWith("evidence:shard:")) return { percent: 54, milestone: "Доказательства ищутся по батчам" };
  if (key.startsWith("rows:shard:") || key.startsWith("abc:shard:")) return { percent: 68, milestone: "Критерии кандидата оцениваются параллельно" };
  if (key.startsWith("critical:shard:")) return { percent: 78, milestone: "Критические выводы проверяются параллельно" };
  return undefined;
}

function provenProgress(runtime: readonly RuntimeProjectionRow[]) {
  let result = { percent: 0, milestone: "Ожидание запуска" };
  for (const row of runtime) {
    const stage = progressForTask(row.taskKey);
    if (!stage) continue;
    if (row.taskState === "SUCCEEDED" || row.taskState === "RUNNING") {
      if (stage.percent >= result.percent) result = stage;
    }
  }
  return result;
}

function runtimeElapsedMinutes(candidate: CandidateRecord, run: RuntimeProjectionRow, now: Date) {
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  if (!Number.isFinite(startedAt)) return candidate.elapsedMinutes;
  const stoppedAt = run.runState === "ACTIVE" ? now.getTime() : Date.parse(run.lastProgressAt);
  if (!Number.isFinite(stoppedAt)) return candidate.elapsedMinutes;
  return Math.max(0, Math.floor((stoppedAt - startedAt) / 60_000));
}

export function projectCandidate(candidate: CandidateRecord, runtime: readonly RuntimeProjectionRow[], report?: ReadyReportProjection, now = new Date()): CandidateRecord {
  if (candidate.status === "WAITING_FOR_STABILITY") {
    return structuredClone({ ...candidate, result: null, transcript: undefined, elapsedMinutes: 0, progressPercent: 0,
      progressMilestone: candidate.progressMilestone?.trim() || "Ожидание стабильности материалов" });
  }
  if (candidate.status === "MATERIALS_INCOMPLETE") {
    return structuredClone({ ...candidate, result: null, transcript: undefined, elapsedMinutes: 0, progressPercent: 0 });
  }
  const latestRun = runtime[0];
  const currentReport = report
    && (latestRun ? report.runId === latestRun.runId : candidate.status !== "WAITING_FOR_STABILITY")
    && ((report.documents.length === 1 && report.documents[0]?.type === "candidate-report")
      || (report.documents.length === 2 && new Set(report.documents.map((item) => item.type)).size === 2));
  if (currentReport) {
    return { ...candidate, status: "READY", elapsedMinutes: report.elapsedMinutes, progressPercent: 100, progressMilestone: "Результат опубликован", transcript: report.transcript ? structuredClone(report.transcript) : undefined, failedStage: undefined, failureReason: undefined, automaticRetriesExhausted: undefined, result: {
      version: report.analysisVersion,
      completedAt: report.completedAt,
      recommendation: report.recommendation,
      aiOverview: report.assessment ? structuredClone(report.assessment) : undefined,
      summary: report.assessment?.summary ?? "Предметная выжимка отсутствует в актуальной версии оценки.",
      documents: report.documents.map((document) => ({ id: document.id, type: document.type, fileName: document.fileName, version: report.analysisVersion, candidateId: candidate.id, vacancyId: candidate.vacancyId, published: Boolean(document.driveFileId), valid: true })) as [ResultDocument] | [ResultDocument, ResultDocument],
    } };
  }
  const withoutStaleResult = candidate.status === "READY"
    ? candidate
    : { ...candidate, result: null, transcript: undefined };
  if (candidate.archived) return structuredClone(withoutStaleResult);
  const run = latestRun;
  if (!run) {
    return structuredClone(candidate.status === "WAITING_FOR_STABILITY"
      ? { ...withoutStaleResult, elapsedMinutes: 0, progressPercent: 0, progressMilestone: "Ожидание стабильности материалов" }
      : withoutStaleResult);
  }
  const projected = { ...withoutStaleResult, workflowVersion: run.workflowVersion, matrixCompilation: run.matrixState ? { state: run.matrixState, repairCount: run.matrixRepairCount ?? 0, terminalErrorCode: run.matrixTerminalErrorCode } : undefined, stageStartedAt: run.startedAt ?? candidate.stageStartedAt, elapsedMinutes: runtimeElapsedMinutes(candidate, run, now) };
  const progress = provenProgress(runtime);
  if (run.runState === "WAITING_FOR_HUMAN") return { ...projected, status: "WAITING_FOR_HUMAN", progressPercent: progress.percent, progressMilestone: progress.milestone };
  if (run.runState === "FAILED") {
    const failed = runtime.find((row) => row.taskState === "FAILED") ?? run;
    const errorCode = failed.errorCode ?? "TASK_FAILED";
    return { ...projected, status: "FAILED", progressPercent: progress.percent, progressMilestone: "Обработка остановлена", failedStage: failed.taskKey ?? "runtime", failureReason: candidateFailureMessage(errorCode), attempts: failed.attemptCount ?? 0, automaticRetriesExhausted: true };
  }
  if (run.runState !== "ACTIVE") return structuredClone(projected);
  const active = runtime.find((row) => ["RUNNING", "RUNNABLE", "WAITING", "UNKNOWN_OUTCOME"].includes(row.taskState ?? "")) ?? runtime.find((row) => row.taskState === "PENDING");
  const key = active?.taskKey ?? "drive-snapshot";
  const status = key === "drive-snapshot" ? "WAITING_FOR_STABILITY"
    : key === "documents" || key.startsWith("documents") ? "MATERIALS_READY"
      : key === "transcription" || key.startsWith("transcripts") ? "TRANSCRIBING"
        : ["matrix", "claims", "global-evidence", "rows", "critical-verification", "recommendation", "evidence", "assessment"].includes(key) || /^(evidence|rows|abc|assessment|critical)/.test(key) ? "ANALYZING"
          : "VALIDATING";
  const activeProgress = progressForTask(key) ?? progress;
  return { ...projected, status, progressPercent: Math.max(progress.percent, activeProgress.percent), progressMilestone: activeProgress.milestone };
}
