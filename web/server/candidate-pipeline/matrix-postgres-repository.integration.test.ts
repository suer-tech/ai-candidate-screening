import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { environmentProjection, loadRuntimeConfiguration } from "../configuration/runtime.ts";
import { migratePostgres } from "../storage/migrations.ts";
import { createPostgresClient } from "../storage/postgres.ts";
import { canonicalizeVacancyMatrix, type MatrixCriterionDraft } from "./matrix-driven.ts";
import { PostgresVacancyMatrixRepository } from "./matrix-postgres-repository.ts";

process.env.ROUTERAI_STRUCTURED_OUTPUTS = "true";

test("PostgreSQL matrix repository fences concurrent owners and isolates candidate artifacts", async () => {
  const configuration = await loadRuntimeConfiguration(path.resolve(import.meta.dirname, "../.."));
  const baseUrl = environmentProjection(configuration).DATABASE_URL;
  const admin = createPostgresClient({ url: baseUrl, max: 1 });
  const databaseName = `matrix_integration_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const isolated = new URL(baseUrl); isolated.pathname = `/${databaseName}`;
  await admin.unsafe(`CREATE DATABASE ${databaseName}`);
  const database = createPostgresClient({ url: isolated.toString(), max: 4 });
  try {
    await migratePostgres(database, path.resolve(import.meta.dirname, "../../drizzle-postgres"));
    const now = new Date("2026-08-26T00:00:00Z");
    const repository = new PostgresVacancyMatrixRepository(database);
    const claims = await Promise.all([
      repository.claimCompilation({ profileVersion: "profile-v1", ownerId: "run-1", now, leaseMs: 1_000 }),
      repository.claimCompilation({ profileVersion: "profile-v1", ownerId: "run-2", now, leaseMs: 1_000 }),
    ]);
    assert.equal(claims.filter((claim) => claim.owner).length, 1);
    const owner = claims.find((claim) => claim.owner)!;
    const ownerId = claims[0].owner ? "run-1" : "run-2";
    const recovered = await repository.claimCompilation({ profileVersion: "profile-v1", ownerId: "recovered", now: new Date(now.getTime() + 1_001), leaseMs: 1_000 });
    assert.equal(recovered.owner, true);
    const criterion: MatrixCriterionDraft = { temporaryId: "one", sourceRefs: ["profile.one"], sourceText: "Опыт", interpretation: "Проверить опыт", category: "required-experience", required: true, requiredExplanation: "Обязательный опыт", hardRequired: false, operator: "ALL_OF", evaluationRule: "Пример", expectedEvidence: ["resume"], allowedStates: ["Подтверждено", "Недостаточно данных"], decisionEffect: "required-gap", missingDataQuestion: "Какой опыт?", interpretationNotes: [] };
    const matrix = canonicalizeVacancyMatrix({ profileVersion: "profile-v1", compilerPolicyVersion: "policy-v1", skillVersions: { compiler: "v1" }, sourceFragments: { "profile.one": "Опыт" }, criteria: [criterion] });
    await assert.rejects(repository.publishMatrix({ ownerId, fencingToken: owner.fencingToken, matrix, modelVersions: {}, protectedTraceRefs: [] }), /MATRIX_STALE_FENCING_TOKEN/);
    const published = await repository.publishMatrix({ ownerId: "recovered", fencingToken: recovered.fencingToken, matrix, modelVersions: { compiler: "model" }, protectedTraceRefs: ["trace"] });
    assert.equal((await repository.readMatrix("profile-v1"))?.checksum, published.checksum);
    await assert.rejects(database`UPDATE vacancy_matrices SET checksum=${"0".repeat(64)} WHERE id=${published.matrixId}`, /immutable/i);

    await database`INSERT INTO candidates(id,revision,record_json) VALUES (1,1,'{}'),(2,1,'{}')`;
    await database`INSERT INTO candidate_material_snapshots(id,candidate_id,fingerprint,complete,stable_comparisons,captured_at_utc) VALUES ('snapshot-1',1,'f1',true,3,${now.toISOString()}),('snapshot-2',2,'f2',true,3,${now.toISOString()})`;
    await database`INSERT INTO candidate_input_versions(id,candidate_id,snapshot_id,sequence,manifest_json,state,created_at_utc) VALUES ('input-1',1,'snapshot-1',1,'{}','MATERIALS_READY',${now.toISOString()}),('input-2',2,'snapshot-2',1,'{}','MATERIALS_READY',${now.toISOString()})`;
    await database`INSERT INTO agent_goals(id,candidate_id,goal_type,input_version,profile_version,policy_version,completion_criteria_version,completion_criteria_json,state,revision,created_at) VALUES ('goal-1',1,'candidate-analysis-matrix/v1','input-1','profile-v1','policy-v1','completion-v1','[]','ACTIVE',1,${now.toISOString()})`;
    await database`INSERT INTO agent_runs(id,goal_id,trigger_identity,state,revision,current_plan_version,last_progress_at,workflow_version) VALUES ('candidate-run-1','goal-1','trigger-1','ACTIVE',1,1,${now.toISOString()},'matrix-v1')`;
    await repository.appendClaim({ candidateId: 1, claim: { claimId: "claim-1", candidateId: "1", runId: "candidate-run-1", inputVersion: "input-1", profileVersion: "profile-v1", author: "candidate", role: "candidate", text: "Опыт", locator: "locator-1", provenanceRef: "trace-1", criterionIds: ["criterion-001"], sourceClass: "resume", directness: "direct" } });
    await assert.rejects(repository.appendClaim({ candidateId: 2, claim: { claimId: "claim-cross", candidateId: "2", runId: "candidate-run-1", inputVersion: "input-1", profileVersion: "profile-v1", author: "candidate", role: "candidate", text: "Чужой", locator: "locator-2", provenanceRef: "trace-2", criterionIds: ["criterion-001"], sourceClass: "resume", directness: "direct" } }), /MATRIX_CANDIDATE_SCOPE_MISMATCH/);
  } finally {
    await database.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
});
