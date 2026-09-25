import assert from "node:assert/strict";
import test from "node:test";
import { getOperationalDashboard } from "../server/product/application.ts";
import { PostgresProductRepository } from "../server/product/postgres-repository.ts";
import type { PostgresClient } from "../server/storage/postgres.ts";

test("dashboard summary keeps current report counts without reading private artifacts", async () => {
  const statements: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => {
    const statement = strings.join(" ? ").replace(/\s+/g, " ");
    statements.push(statement);
    if (statement.includes("SELECT id,revision,record_json FROM candidates")) return [{
      id: 1, revision: 2, record_json: JSON.stringify({ id: 1, name: "Тестовый кандидат", initials: "ТК", vacancyId: "vac-1",
        vacancy: "Тестовая вакансия", status: "VALIDATING", archived: false, stageStartedAt: "2026-09-25T08:00:00Z",
        elapsedMinutes: 5, etaMinutes: null, result: null }),
    }];
    if (statement.includes("SELECT record_json FROM vacancies")) return [{ record_json: JSON.stringify({
      id: "vac-1", title: "Тестовая вакансия", active: true, archived: false, version: 1,
    }) }];
    if (statement.includes("FROM agent_goals g JOIN agent_runs r")) return [{
      candidate_id: 1, run_id: "run-1", run_state: "SUCCEEDED", workflow_version: "matrix-v4",
      run_started_at: "2026-09-25T08:00:00Z", last_progress_at: "2026-09-25T08:12:00Z",
      task_key: "publication", task_state: "SUCCEEDED", attempt_count: 1,
    }];
    if (statement.includes("FROM candidate_report_versions r JOIN candidate_report_documents d")) {
      const common = { candidate_id: 1, analysis_version: 2, run_id: "run-1", state: "PUBLISHED",
        recommendation: "Рекомендовать", last_progress_at: "2026-09-25T08:12:00Z", elapsed_minutes: 12 };
      return [
        { ...common, document_id: "doc-1", type: "candidate-results", file_name: "Итоги.pdf", drive_file_id: "drive-1" },
        { ...common, document_id: "doc-2", type: "abc-test", file_name: "ABC.pdf", drive_file_id: "drive-2" },
      ];
    }
    return [];
  }) as unknown as PostgresClient;

  const snapshot = await getOperationalDashboard(new PostgresProductRepository(sql), 7, new Date("2026-09-25T12:00:00Z"));
  assert.equal(snapshot.counts.READY, 1);
  assert.equal(snapshot.recommendations["Рекомендовать"], 1);
  assert.deepEqual(snapshot.ready.map((candidate) => candidate.id), [1]);
  assert.equal(snapshot.ready[0]?.elapsedMinutes, 12);
  assert.equal(snapshot.flow[0]?.count, 1);
  assert.ok(statements.some((statement) => statement.includes("FROM candidate_report_versions r JOIN candidate_report_documents d")));
  assert.ok(statements.every((statement) => !statement.includes("artifact_blobs") && !statement.includes("candidate_input_versions")));
});
