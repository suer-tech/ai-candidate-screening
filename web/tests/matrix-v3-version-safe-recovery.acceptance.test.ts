import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAgentRuntimeRepository } from "../server/agent-runtime/postgres-runtime-repository.ts";
import { PostgresVacancyMatrixRepository } from "../server/candidate-pipeline/matrix-postgres-repository.ts";
import type { PostgresClient } from "../server/storage/postgres.ts";

const budgets = { wallTimeMs: 14_400_000, taskAttempts: 50, repairAttempts: 2, replans: 2, llmCalls: 30, tokens: 300_000, costMicrounits: 8_000_000, externalRequests: 150 };
const orderedKeys = ["drive-snapshot", "matrix", "documents", "transcription", "context-search", "context-read", "claims", "global-evidence", "rows", "critical-verification", "recommendation", "validation", "reports", "publication", "notification"];

function normalized(strings: TemplateStringsArray) { return strings.join(" ? ").replace(/\s+/g, " ").trim(); }

function recoveryTransport(input: {
  sourceWorkflow: "matrix-v2" | "matrix-v3";
  sourceTasks: Array<{ key: string; state: "SUCCEEDED" | "FAILED" | "PENDING" }>;
  artifacts: Record<string, { schema: string } | undefined>;
}) {
  const inserted = new Map<string, { state: string; reusedFrom: unknown }>();
  const queries: string[] = [];
  const sourceRunId = `source-${input.sourceWorkflow}`;
  const execute = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const sqlText = normalized(strings); queries.push(sqlText);
    if (/SELECT id FROM agent_runs WHERE trigger_identity/i.test(sqlText)) return [];
    if (/SELECT id FROM agent_goals WHERE candidate_id/i.test(sqlText)) return [{ id: "existing-goal" }];
    if (/SELECT record_json FROM candidates WHERE id/i.test(sqlText)) return [{ record_json: "{}" }];
    if (/FROM agent_runs source_run/i.test(sqlText)) return [{ id: sourceRunId, state: "FAILED", input_version: "input-v1", profile_version: "profile:v1", workflow_version: input.sourceWorkflow, policy_version: "candidate-policy-v1" }];
    if (/FROM agent_tasks WHERE run_id/i.test(sqlText)) return input.sourceTasks.map(({ key, state }) => ({ id: `${sourceRunId}:${key}`, run_id: sourceRunId, task_key: key, tool_key: `candidate.${key}/v1`, state }));
    // Future implementation may validate artifacts by provenance/schema through either
    // tagged SQL or an application helper. Return only the explicitly valid fixture.
    if (/artifact/i.test(sqlText) && values.includes(sourceRunId)) {
      const key = orderedKeys.find((candidate) => values.some((value) => String(value).includes(candidate)));
      const artifact = key ? input.artifacts[key] : undefined;
      return artifact ? [{ schema_version: artifact.schema, provenance: `candidate.${key}/v1`, storage_identity: `artifact://${key}` }] : [];
    }
    if (/INSERT INTO agent_tasks/i.test(sqlText)) {
      inserted.set(String(values[3]), { state: String(values[5]), reusedFrom: values.at(-1) });
    }
    return [];
  };
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => execute(strings, ...values)) as unknown as PostgresClient;
  Object.assign(sql, { begin: async <T>(operation: (tx: PostgresClient) => Promise<T>) => operation(sql) });
  return { sql, inserted, queries };
}

async function createSuccessor(fixture: ReturnType<typeof recoveryTransport>) {
  return new PostgresAgentRuntimeRepository(fixture.sql).createGoal({
    goalId: "goal-v3", runId: "successor-v3", candidateId: 501,
    goalType: "candidate-analysis-matrix/v1", workflowVersion: "matrix-v3",
    inputVersion: "input-v1", profileVersion: "profile:v1", policyVersion: "candidate-policy-v1",
    completionCriteriaVersion: "candidate-completion-v1",
    completionCriteria: ["validated-report-pair", "ready-after-pair-publication"], budgets,
    triggerIdentity: "manual-reprocess:matrix-v3-version-safe-fixture",
  });
}

test("WF-041: matrix-v2 predecessor is never a recovery source for matrix-v3", async () => {
  const fixture = recoveryTransport({
    sourceWorkflow: "matrix-v2",
    sourceTasks: orderedKeys.map((key, index) => ({ key, state: index < 12 ? "SUCCEEDED" as const : index === 12 ? "FAILED" as const : "PENDING" as const })),
    artifacts: {},
  });
  await createSuccessor(fixture);
  assert.equal(fixture.inserted.get("drive-snapshot")?.state, "RUNNABLE");
  assert.equal([...fixture.inserted.values()].some((task) => task.reusedFrom != null), false);
});

test("WF-041: recovery reuses only the continuous successful artifact-valid prefix", async () => {
  const fixture = recoveryTransport({
    sourceWorkflow: "matrix-v3",
    sourceTasks: orderedKeys.map((key, index) => ({ key, state: index === 2 ? "FAILED" as const : index < 12 ? "SUCCEEDED" as const : "PENDING" as const })),
    artifacts: { "drive-snapshot": { schema: "drive-snapshot/v1" }, matrix: { schema: "vacancy-matrix/v3" } },
  });
  await createSuccessor(fixture);
  assert.equal(fixture.inserted.get("drive-snapshot")?.state, "SUCCEEDED");
  assert.equal(fixture.inserted.get("matrix")?.state, "SUCCEEDED");
  assert.equal(fixture.inserted.get("documents")?.state, "RUNNABLE");
  assert.equal(fixture.inserted.get("transcription")?.state, "PENDING", "successful tasks after the first failed stage are not reusable");
});

test("WF-041: missing or wrong-schema artifact breaks the reusable prefix", async () => {
  for (const artifact of [undefined, { schema: "vacancy-matrix/v2" }]) {
    const fixture = recoveryTransport({
      sourceWorkflow: "matrix-v3",
      sourceTasks: orderedKeys.map((key, index) => ({ key, state: index < 12 ? "SUCCEEDED" as const : "FAILED" as const })),
      artifacts: { "drive-snapshot": { schema: "drive-snapshot/v1" }, matrix: artifact },
    });
    await createSuccessor(fixture);
    assert.equal(fixture.inserted.get("drive-snapshot")?.state, "SUCCEEDED");
    assert.equal(fixture.inserted.get("matrix")?.state, "RUNNABLE");
    assert.equal(fixture.inserted.get("documents")?.state, "PENDING");
  }
});

function identityStrictMatrixTransport() {
  const oldMatrix = { profileVersion: "profile:v1", schemaVersion: "vacancy-matrix/v2", compilerPolicyVersion: "compiler/v2", skillVersions: { compiler: "matrix-v2" }, checksum: "checksum-v2", criteria: [] };
  const published = new Map<string, { id: string; checksum: string; payload: unknown }>([["profile:v1:matrix-v2", { id: "matrix-v2-existing", checksum: oldMatrix.checksum, payload: oldMatrix }]]);
  const claimed = new Map<string, { owner: string; fencing: number }>();
  let selectedKey = "";
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const query = normalized(strings);
    const profile = String(values[0] ?? "");
    const identity = values.find((value) => value === "matrix-v2" || value === "matrix-v3");
    assert.ok(identity, `shared-matrix SQL must bind workflow identity: ${query}`);
    selectedKey = `${profile}:${identity}`;
    if (/SELECT state,owner_id,fencing_token/i.test(query)) {
      const item = published.get(selectedKey);
      return item ? [{ state: "PUBLISHED", owner_id: "owner", fencing_token: 1, lease_expires_at_utc: new Date(0), matrix_id: item.id, attempt: 1, terminal_error_code: null }] : claimed.has(selectedKey) ? [{ state: "CLAIMED", owner_id: claimed.get(selectedKey)!.owner, fencing_token: 1, lease_expires_at_utc: new Date(0), matrix_id: null, attempt: 1, terminal_error_code: null }] : [];
    }
    if (/INSERT INTO vacancy_matrix_compilations/i.test(query)) { claimed.set(selectedKey, { owner: String(values.find((v) => typeof v === "string" && v.startsWith("owner-"))), fencing: 1 }); return []; }
    if (/SELECT state,owner_id,fencing_token,matrix_id/i.test(query)) return [{ state: "CLAIMED", owner_id: claimed.get(selectedKey)?.owner, fencing_token: 1, matrix_id: null }];
    if (/INSERT INTO vacancy_matrices/i.test(query)) { published.set(selectedKey, { id: String(values[0]), checksum: String(values.at(-1)), payload: JSON.parse(String(values.at(-2))) }); return []; }
    if (/UPDATE vacancy_matrix_compilations SET state='PUBLISHED'/i.test(query)) return [];
    if (/SELECT checksum FROM vacancy_matrices/i.test(query)) return [{ checksum: published.get(selectedKey)?.checksum }];
    if (/SELECT id,payload_json,checksum FROM vacancy_matrices/i.test(query)) { const item = published.get(selectedKey); return item ? [{ id: item.id, payload_json: JSON.stringify(item.payload), checksum: item.checksum }] : []; }
    return [];
  }) as unknown as PostgresClient;
  Object.assign(sql, { begin: async <T>(operation: (tx: PostgresClient) => Promise<T>) => operation(sql) });
  return sql;
}

test("MDA-009: matrix-v2 does not block matrix-v3 and the second matrix-v3 reuses its checksum", async () => {
  const repository = new PostgresVacancyMatrixRepository(identityStrictMatrixTransport());
  const claim = (workflowIdentity: "matrix-v2" | "matrix-v3", ownerId: string) => repository.claimCompilation({ profileVersion: "profile:v1", workflowIdentity, ownerId, now: new Date("2026-08-27T00:00:00Z"), leaseMs: 60_000 } as never);
  const v2 = await claim("matrix-v2", "owner-v2");
  assert.equal(v2.owner, false);
  assert.equal((v2 as { matrixId?: string }).matrixId, "matrix-v2-existing");
  // The storage boundary must distinguish compatibility identity before it can
  // return the previously published matrix. Current profile-only SQL fails here.
  const v3 = await claim("matrix-v3", "owner-v3");
  assert.equal(v3.owner, true);
  assert.notEqual((v3 as { matrixId?: string }).matrixId, "matrix-v2-existing");
  const matrixV3 = { profileVersion: "profile:v1", schemaVersion: "vacancy-matrix/v3", compilerPolicyVersion: "compiler/v3", skillVersions: { compiler: "matrix-v3" }, checksum: "checksum-v3", criteria: [] };
  await repository.publishMatrix({ ownerId: "owner-v3", fencingToken: 1, workflowIdentity: "matrix-v3", matrix: matrixV3, modelVersions: {}, protectedTraceRefs: [] } as never);
  const secondV3 = await claim("matrix-v3", "owner-v3-second");
  assert.equal(secondV3.owner, false);
  const readV3 = await (repository.readMatrix as unknown as (profile: string, identity: string) => Promise<{ checksum: string } | null>)("profile:v1", "matrix-v3");
  assert.equal(readV3?.checksum, matrixV3.checksum);
});
