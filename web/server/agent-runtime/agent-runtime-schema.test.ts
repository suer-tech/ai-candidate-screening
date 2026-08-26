import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function database() {
  const db = new DatabaseSync(":memory:");
  for (const migration of ["../../drizzle/0000_daily_skrulls.sql", "../../drizzle/0001_durable_agent_runtime.sql"]) {
    const source = await readFile(new URL(migration, import.meta.url), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  }
  return db;
}

function seedGraph(db: DatabaseSync) {
  db.prepare("INSERT INTO candidates (id, revision, record_json) VALUES (1, 1, '{}')").run();
  db.prepare("INSERT INTO agent_goals (id, candidate_id, goal_type, input_version, profile_version, policy_version, completion_criteria_version, completion_criteria_json, state, created_at) VALUES ('goal-1',1,'synthetic','input-v1','profile-v1','policy-v1','criteria-v1','[]','ACTIVE','2026-08-20T00:00:00Z')").run();
  db.prepare("INSERT INTO agent_runs (id, goal_id, trigger_identity, state, last_progress_at) VALUES ('run-1','goal-1','trigger-1','ACTIVE','2026-08-20T00:00:00Z')").run();
  db.prepare("INSERT INTO agent_plan_versions (id, run_id, version, reason, plan_json, created_at) VALUES ('plan-1','run-1',1,'INITIAL','{}','2026-08-20T00:00:00Z')").run();
  db.prepare("INSERT INTO agent_tasks (id, run_id, plan_version_id, task_key, tool_key, state, idempotency_identity, preconditions_json, expected_outputs_json) VALUES ('task-1','run-1','plan-1','task','tool','RUNNABLE','operation-1','[]','[]')").run();
  db.prepare("INSERT INTO agent_events (id, run_id, sequence, event_identity, type, actor, plan_version, safe_payload_json, created_at) VALUES ('event-1','run-1',1,'event-identity-1','CREATED','runtime',1,'{}','2026-08-20T00:00:00Z')").run();
}

test("runtime migration creates the complete durable control-plane", async () => {
  const db = await database();
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_%' ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(names, ["agent_artifact_refs", "agent_attempts", "agent_budget_ledger", "agent_budget_reservations", "agent_checkpoints", "agent_compensations", "agent_escalation_actions", "agent_escalations", "agent_eval_results", "agent_events", "agent_goals", "agent_memory_entries", "agent_obstacle_fingerprints", "agent_outbox", "agent_plan_versions", "agent_runs", "agent_task_dependencies", "agent_tasks", "agent_tool_grants"]);
  } finally { db.close(); }
});

test("runtime records reject orphans and immutable plan/event mutation", async () => {
  const db = await database();
  try {
    seedGraph(db);
    assert.throws(() => db.prepare("INSERT INTO agent_tasks (id, run_id, plan_version_id, task_key, tool_key, state, idempotency_identity, preconditions_json, expected_outputs_json) VALUES ('orphan','missing','plan-1','x','x','PENDING','x','[]','[]')").run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare("UPDATE agent_events SET type='CHANGED' WHERE id='event-1'").run(), /append-only/);
    assert.throws(() => db.prepare("UPDATE agent_plan_versions SET reason='CHANGED' WHERE id='plan-1'").run(), /immutable/);
  } finally { db.close(); }
});

test("candidate deletion cascades runtime only after a minimal tombstone exists", async () => {
  const db = await database();
  try {
    seedGraph(db);
    assert.throws(() => db.prepare("DELETE FROM agent_events WHERE id='event-1'").run(), /append-only/);
    db.prepare("INSERT INTO candidate_tombstones (candidate_id, deleted_at) VALUES (1, '2026-08-20T00:01:00Z')").run();
    db.prepare("DELETE FROM candidates WHERE id=1").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_goals").get()?.count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_events").get()?.count, 0);
  } finally { db.close(); }
});
