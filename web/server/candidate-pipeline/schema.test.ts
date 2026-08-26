import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0000_daily_skrulls.sql", "0001_durable_agent_runtime.sql", "0002_unique_paibok.sql", "0003_nostalgic_gorilla_man.sql", "0007_one_time_drive_link.sql"]) {
    const migration = await readFile(new URL(`../../drizzle/${name}`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  }
  return db;
}

function seed(db: DatabaseSync) {
  db.prepare("INSERT INTO candidates (id, revision, record_json) VALUES (1, 1, '{}')").run();
  db.prepare("INSERT INTO agent_goals (id,candidate_id,goal_type,input_version,profile_version,policy_version,completion_criteria_version,completion_criteria_json,state,revision,created_at) VALUES ('goal-1',1,'candidate-analysis/v1','input-1','profile-1','candidate-policy-v1','candidate-completion-v1','[]','ACTIVE',1,'2026-08-20T00:00:00Z')").run();
  db.prepare("INSERT INTO agent_runs (id,goal_id,trigger_identity,state,revision,current_plan_version,last_progress_at) VALUES ('run-1','goal-1','trigger-1','ACTIVE',1,1,'2026-08-20T00:00:00Z')").run();
  db.prepare("INSERT INTO candidate_material_snapshots (id,candidate_id,fingerprint,complete,stable_comparisons,captured_at_utc) VALUES ('snapshot-1',1,'hash',1,3,'2026-08-20T00:00:00Z')").run();
  db.prepare("INSERT INTO candidate_input_versions (id,candidate_id,snapshot_id,sequence,manifest_json,state,created_at_utc) VALUES ('input-1',1,'snapshot-1',1,'{}','MATERIALS_READY','2026-08-20T00:00:00Z')").run();
  db.prepare("INSERT INTO candidate_domain_artifacts (id,candidate_id,run_id,input_version_id,profile_version,kind,schema_version,tool_version,config_fingerprint,checksum,payload_ref,created_at_utc) VALUES ('artifact-1',1,'run-1','input-1','profile-1','assessment/snapshot','assessment/v1','1','config','checksum','r2://artifact-1','2026-08-20T00:00:00Z')").run();
  db.prepare("INSERT INTO candidate_assessments (id,artifact_id,attempt,recommendation,formula_version,gate_state,decision_evidence_json) VALUES ('assessment-1','artifact-1',1,'Рекомендовать','ASM-050','PASS','{}')").run();
  db.prepare("INSERT INTO candidate_report_versions (id,candidate_id,run_id,assessment_id,analysis_version,state,directory_identity) VALUES ('report-1',1,'run-1','assessment-1',1,'VALIDATING','drive:v0001')").run();
}

test("canonical migration creates all durable domain boundaries", async () => {
  const db = await database();
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    for (const name of ["candidate_drive_objects", "candidate_material_snapshots", "candidate_input_versions", "candidate_domain_artifacts", "candidate_evidence_locators", "candidate_facts", "candidate_assessments", "candidate_report_versions", "candidate_report_documents", "candidate_notification_events", "candidate_notification_deliveries", "candidate_stage_metrics", "candidate_cleanup_states"]) assert.ok(tables.has(name), name);
  } finally { db.close(); }
});

test("input, artifacts, assessments and published documents are immutable", async () => {
  const db = await database();
  try {
    seed(db);
    assert.throws(() => db.prepare("UPDATE candidate_input_versions SET state='CHANGED' WHERE id='input-1'").run(), /IMMUTABLE_INPUT_VERSION/);
    assert.throws(() => db.prepare("UPDATE candidate_domain_artifacts SET checksum='changed' WHERE id='artifact-1'").run(), /IMMUTABLE_DOMAIN_ARTIFACT/);
    assert.throws(() => db.prepare("UPDATE candidate_assessments SET recommendation='Не рекомендовать' WHERE id='assessment-1'").run(), /IMMUTABLE_ASSESSMENT/);
  } finally { db.close(); }
});

test("READY gate requires a valid two-document report pair", async () => {
  const db = await database();
  try {
    seed(db);
    assert.throws(() => db.prepare("UPDATE candidate_report_versions SET state='READY' WHERE id='report-1'").run(), /REPORT_PAIR_INCOMPLETE/);
    const insert = db.prepare("INSERT INTO candidate_report_documents (id,report_version_id,type,file_name,checksum,byte_size,validation_json) VALUES (?,?,?,?,?,100,'{}')");
    insert.run("doc-1", "report-1", "abc-test", "abc.pdf", "abc-checksum");
    insert.run("doc-2", "report-1", "candidate-results", "result.pdf", "result-checksum");
    db.prepare("UPDATE candidate_report_versions SET state='READY' WHERE id='report-1'").run();
    assert.equal(db.prepare("SELECT state FROM candidate_report_versions WHERE id='report-1'").get()!.state, "READY");
    db.prepare("UPDATE candidate_report_documents SET drive_file_id='drive-file-1' WHERE id='doc-1'").run();
    assert.equal(db.prepare("SELECT drive_file_id FROM candidate_report_documents WHERE id='doc-1'").get()!.drive_file_id, "drive-file-1");
    assert.throws(() => db.prepare("UPDATE candidate_report_documents SET drive_file_id='drive-file-2' WHERE id='doc-1'").run(), /IMMUTABLE_REPORT_DOCUMENT/);
    assert.throws(() => db.prepare("UPDATE candidate_report_documents SET checksum='changed' WHERE id='doc-1'").run(), /IMMUTABLE_REPORT_DOCUMENT/);
  } finally { db.close(); }
});

test("candidate lifecycle cascades the full runtime and domain graph", async () => {
  const db = await database();
  try {
    seed(db);
    db.prepare("DELETE FROM candidates WHERE id=1").run();
    for (const table of ["agent_goals", "agent_runs", "candidate_material_snapshots", "candidate_input_versions", "candidate_domain_artifacts", "candidate_assessments", "candidate_report_versions"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count, 0, table);
    }
  } finally { db.close(); }
});
