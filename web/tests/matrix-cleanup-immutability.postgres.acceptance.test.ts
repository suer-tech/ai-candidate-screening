import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";
import { migratePostgres } from "../server/storage/migrations.ts";
import { createPostgresClient } from "../server/storage/postgres.ts";
import { PostgresProductRepository } from "../server/product/postgres-repository.ts";

test("SEC-022: immutable matrix history allows only exact lifecycle cleanup scope and preserves shared matrix", async () => {
  const configuration = await loadRuntimeConfiguration(path.resolve(import.meta.dirname, ".."));
  const baseUrl = environmentProjection(configuration).DATABASE_URL;
  const admin = createPostgresClient({ url: baseUrl, max: 1 });
  const databaseName = `matrix_cleanup_acceptance_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const isolated = new URL(baseUrl); isolated.pathname = `/${databaseName}`;
  await admin.unsafe(`CREATE DATABASE ${databaseName}`);
  const database = createPostgresClient({ url: isolated.toString(), max: 2 });
  try {
    await migratePostgres(database, path.resolve(import.meta.dirname, "../drizzle-postgres"));
    const now = "2026-08-28T00:00:00.000Z";
    const candidateRecord = { id: 701, vacancyId: "vacancy-synthetic", name: "Synthetic Candidate", archived: true, status: "ARCHIVED", revision: 1 };
    await database`INSERT INTO candidates(id,revision,record_json) VALUES (701,1,${JSON.stringify(candidateRecord)})`;
    await database`INSERT INTO candidate_material_snapshots(id,candidate_id,fingerprint,complete,stable_comparisons,captured_at_utc) VALUES ('snapshot-cleanup',701,'synthetic-fingerprint',true,3,${now})`;
    await database`INSERT INTO candidate_input_versions(id,candidate_id,snapshot_id,sequence,manifest_json,state,created_at_utc) VALUES ('input-cleanup',701,'snapshot-cleanup',1,'{}','MATERIALS_READY',${now})`;
    await database`INSERT INTO agent_goals(id,candidate_id,goal_type,input_version,profile_version,policy_version,completion_criteria_version,completion_criteria_json,state,revision,created_at) VALUES ('goal-cleanup',701,'candidate-analysis-matrix/v1','input-cleanup','profile-cleanup','candidate-policy-v1','candidate-completion-v1','[]','ACTIVE',1,${now})`;
    await database`INSERT INTO agent_runs(id,goal_id,trigger_identity,state,revision,current_plan_version,last_progress_at,workflow_version) VALUES ('run-cleanup','goal-cleanup','trigger-cleanup','FAILED',1,1,${now},'matrix-v3')`;
    await database`INSERT INTO vacancy_matrices(id,profile_version,workflow_identity,schema_version,compiler_policy_version,skill_versions_json,model_versions_json,protected_trace_refs_json,payload_json,checksum) VALUES ('matrix-shared','profile-cleanup','matrix-v3','vacancy-matrix/v2','compiler-v1','{}','{}','[]','{}',${"a".repeat(64)})`;
    await database`INSERT INTO candidate_source_claims(id,candidate_id,run_id,input_version_id,profile_version,author,role,source_class,directness,claim_text,locator_json,criterion_ids_json,provenance_ref) VALUES ('claim-cleanup',701,'run-cleanup','input-cleanup','profile-cleanup','candidate','candidate','resume','direct','synthetic claim','{}','[]','trace')`;
    await database`INSERT INTO candidate_evidence_conflicts(id,candidate_id,run_id,input_version_id,profile_version,predicate,claim_ids_json,follow_up_question,provenance_ref) VALUES ('conflict-cleanup',701,'run-cleanup','input-cleanup','profile-cleanup','synthetic','[]','question','trace')`;
    await database`INSERT INTO candidate_matrix_rows(id,matrix_id,candidate_id,run_id,input_version_id,profile_version,criterion_id,state,supporting_claim_ids_json,contradicting_claim_ids_json,checked_source_ids_json,reason,missing_data,follow_up_question,verification_state) VALUES ('row-cleanup','matrix-shared',701,'run-cleanup','input-cleanup','profile-cleanup','criterion-cleanup','Соответствует','[]','[]','[]','synthetic reason','','','NOT_REQUIRED')`;

    const tables = ["candidate_source_claims", "candidate_evidence_conflicts", "candidate_matrix_rows"] as const;
    for (const table of tables) {
      await assert.rejects(database.unsafe(`UPDATE ${table} SET profile_version='mutated' WHERE candidate_id=701`), /immutable|mutation|forbidden|cleanup/i, `${table} direct UPDATE must fail`);
      await assert.rejects(database.unsafe(`DELETE FROM ${table} WHERE candidate_id=701`), /immutable|mutation|forbidden|cleanup/i, `${table} direct DELETE must fail`);
      assert.equal(Number((await database.unsafe(`SELECT count(*)::integer AS count FROM ${table} WHERE candidate_id=701`))[0].count), 1);
    }
    await assert.rejects(database.begin(async (transaction) => {
      await transaction`SELECT set_config('hh.cleanup_run_ids','other-run',true)`;
      await transaction`DELETE FROM candidate_source_claims WHERE candidate_id=701`;
    }), /immutable|mutation|forbidden|cleanup/i, "wrong cleanup run ID must fail");

    const repository = new PostgresProductRepository(database);
    await repository.deleteCandidate(candidateRecord as never, 1, { action: "delete", actor: "synthetic-acceptance", candidateId: 701, timestamp: now, outcome: "success" });
    assert.equal(Number((await database`SELECT count(*)::integer AS count FROM candidates WHERE id=701`)[0].count), 0);
    for (const table of tables) assert.equal(Number((await database.unsafe(`SELECT count(*)::integer AS count FROM ${table} WHERE candidate_id=701`))[0].count), 0, `${table} survived scoped lifecycle cleanup`);
    assert.equal(Number((await database`SELECT count(*)::integer AS count FROM vacancy_matrices WHERE id='matrix-shared'`)[0].count), 1, "shared vacancy matrix was deleted");
  } finally {
    await database.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
});
