import assert from "node:assert/strict";
import test from "node:test";
import { PostgresProductRepository } from "../server/product/postgres-repository.ts";
import type { PostgresClient } from "../server/storage/postgres.ts";

const successorRunId = "matrix-successor-published";
const sourceRunId = "matrix-source-failed-reports";

function blob(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function productionDashboardTransport() {
  const statements: string[] = [];
  const assessment = {
    recommendation: "Рекомендовать с оговорками",
    structuredAssessment: {
      observations: [{ name: "Результативность", reason: "Подтверждён измеримый результат", factIds: ["fact-1"] }],
      competencies: [{ name: "Самостоятельность", state: "Подтверждено", reason: "Самостоятельно доводит задачи", factIds: ["fact-1"] }],
      risks: [], stopFactors: [], accessToKe: [],
      abcStates: { productivity: "B" },
      abcEvidence: { productivity: { reason: "Соответствует уровню B", factIds: ["fact-1"] } },
    },
  };
  const evidence = { facts: [{ id: "fact-1", predicate: "result_event_case", value: "Рост показателя на 20%", locator: { kind: "transcript", speakerLabel: "Кандидат", startMs: 1_000, exactText: "Я увеличил показатель на 20 процентов" } }] };
  const transcript = [{ start: 1_000, end: 4_000, speaker: "Кандидат", text: "Я увеличил показатель на 20 процентов" }];

  const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const statement = strings.join(" ? ").replace(/\s+/g, " ").trim();
    statements.push(statement);
    if (/SELECT id,revision,record_json FROM candidates/i.test(statement)) return [{
      id: 501,
      revision: 12,
      record_json: JSON.stringify({
        id: 501, name: "Recovery Candidate", initials: "RC", vacancyId: "vacancy-recovery", vacancy: "Recovery Vacancy",
        status: "WAITING_FOR_STABILITY", archived: false, stageStartedAt: "2026-08-27T08:00:00Z", elapsedMinutes: 0,
        etaMinutes: null, progressPercent: 0, progressMilestone: "Ожидание стабильности материалов", result: null,
      }),
    }];
    if (/SELECT record_json FROM vacancies/i.test(statement)) return [{ record_json: JSON.stringify({ id: "vacancy-recovery", title: "Recovery Vacancy", active: true, archived: false, version: 3 }) }];
    if (/FROM agent_goals g JOIN agent_runs r/i.test(statement)) return [{
      candidate_id: 501, run_id: successorRunId, run_state: "SUCCEEDED", workflow_version: "matrix-v2",
      run_started_at: "2026-08-27T08:00:00Z", last_progress_at: "2026-08-27T08:14:00Z",
      task_key: "publication", task_state: "SUCCEEDED", attempt_count: 1,
    }];
    if (/FROM candidate_report_versions r JOIN candidate_report_documents d/i.test(statement)) {
      const lineageAware = /WITH RECURSIVE|recovery_source_run_id|run_lineage/i.test(statement);
      const common = {
        candidate_id: 501, analysis_version: 2, run_id: successorRunId, state: "PUBLISHED",
        recommendation: "Рекомендовать с оговорками", last_progress_at: "2026-08-27T08:14:00Z", elapsed_minutes: 14,
        assessment_blob: lineageAware ? blob(assessment) : null,
        evidence_blob: lineageAware ? blob(evidence) : null,
        transcript_run_id: lineageAware ? sourceRunId : null,
        transcript_utterances: lineageAware ? transcript : null,
        transcript_checksum: lineageAware ? "synthetic-transcript-checksum" : null,
      };
      return [
        { ...common, document_id: "report-result-v2", type: "candidate-results", file_name: "Итоги — v0002.pdf", drive_file_id: "drive-result-v2" },
        { ...common, document_id: "report-abc-v2", type: "abc-test", file_name: "ABC — v0002.pdf", drive_file_id: "drive-abc-v2" },
      ];
    }
    if (/SELECT DISTINCT ON \(candidate_id\)/i.test(statement)) return [];
    return [];
  }) as unknown as PostgresClient;
  return { sql, statements };
}

test("WF-023 dashboard: published selective-recovery successor projects READY with source-run AI artifacts", async () => {
  const fixture = productionDashboardTransport();
  const dashboard = await new PostgresProductRepository(fixture.sql).dashboardSource();
  const candidate = dashboard.candidates.find((item) => item.id === 501);
  assert.ok(candidate);

  const failures: string[] = [];
  if (candidate.status !== "READY") failures.push(`status expected READY, actual=${candidate.status}`);
  if (candidate.progressPercent !== 100) failures.push(`progress expected 100, actual=${candidate.progressPercent}`);
  if (candidate.progressMilestone !== "Результат опубликован") failures.push(`milestone expected published, actual=${candidate.progressMilestone}`);
  if (candidate.result?.version !== 2 || candidate.result.documents.length !== 2) failures.push(`current report pair missing; result=${JSON.stringify(candidate.result)}`);
  if (!candidate.result?.aiOverview?.summary.includes("Подтверждён измеримый результат")) failures.push(`AI overview was not resolved through source lineage; overview=${JSON.stringify(candidate.result?.aiOverview)}`);
  if (candidate.result?.aiOverview?.evidence[0]?.id !== "fact-1") failures.push("source evidence artifact is absent from AI overview");
  if (candidate.transcript?.runId !== sourceRunId || candidate.transcript.utterances[0]?.text !== "Я увеличил показатель на 20 процентов") failures.push(`source transcript missing; transcript=${JSON.stringify(candidate.transcript)}`);

  const reportQuery = fixture.statements.find((statement) => /FROM candidate_report_versions r JOIN candidate_report_documents d/i.test(statement)) ?? "";
  if (!/WITH RECURSIVE|recovery_source_run_id|run_lineage/i.test(reportQuery)) failures.push("production dashboard report query has no recovery lineage traversal");
  assert.deepEqual(failures, []);
});
