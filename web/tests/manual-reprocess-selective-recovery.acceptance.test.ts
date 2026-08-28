import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAgentRuntimeRepository } from "../server/agent-runtime/postgres-runtime-repository.ts";
import { latestDomainArtifactReference } from "../server/candidate-pipeline/production-runtime.ts";
import type { PostgresClient } from "../server/storage/postgres.ts";

const budgets = {
  wallTimeMs: 14_400_000,
  taskAttempts: 50,
  repairAttempts: 2,
  replans: 2,
  llmCalls: 30,
  tokens: 300_000,
  costMicrounits: 8_000_000,
  externalRequests: 150,
};

const upstreamThroughValidation = [
  "drive-snapshot",
  "matrix",
  "documents",
  "transcription",
  "context-search",
  "context-read",
  "claims",
  "global-evidence",
  "rows",
  "critical-verification",
  "recommendation",
  "validation",
] as const;

type SourceState = "FAILED" | "SUCCEEDED";
type CapturedStatement = { sql: string; values: unknown[] };
type CapturedTask = { key: string; tool: string; state: string };

function normalized(strings: TemplateStringsArray) {
  return strings.join(" ? ").replace(/\s+/g, " ").trim();
}

function syntheticProductionTransport(options: {
  sourceState: SourceState;
  sourceInputVersion: string;
  sourceProfileVersion: string;
}) {
  const statements: CapturedStatement[] = [];
  const tasks: CapturedTask[] = [];
  const sourceRunId = `source-${options.sourceState.toLowerCase()}-run`;
  const sourceGoalId = `source-${options.sourceState.toLowerCase()}-goal`;
  const sourceTasks = [
    ...upstreamThroughValidation.map((key) => ({ key, state: "SUCCEEDED" })),
    { key: "reports", state: options.sourceState === "FAILED" ? "FAILED" : "SUCCEEDED" },
    { key: "publication", state: options.sourceState === "FAILED" ? "PENDING" : "SUCCEEDED" },
    { key: "notification", state: options.sourceState === "FAILED" ? "PENDING" : "SUCCEEDED" },
  ];

  const execute = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const sql = normalized(strings);
    statements.push({ sql, values });

    if (/SELECT id FROM agent_runs WHERE trigger_identity/i.test(sql)) return [];
    if (/SELECT id FROM agent_goals WHERE candidate_id/i.test(sql)) {
      const sameVersions = values.includes(options.sourceInputVersion) && values.includes(options.sourceProfileVersion);
      return sameVersions ? [{ id: sourceGoalId }] : [];
    }
    if (/SELECT record_json FROM candidates WHERE id/i.test(sql)) return [{ record_json: "{}" }];

    // This branch models the durable source-run lookup expected from the production
    // repository. It deliberately does not prescribe a concrete schema/table name.
    if (/SELECT/i.test(sql) && /agent_runs/i.test(sql) && /(source|predecessor|lineage|successor)/i.test(sql)) {
      return [{
        id: sourceRunId,
        run_id: sourceRunId,
        goal_id: sourceGoalId,
        state: options.sourceState,
        input_version: options.sourceInputVersion,
        profile_version: options.sourceProfileVersion,
        workflow_version: "matrix-v3",
        policy_version: "candidate-policy-v1",
      }];
    }
    if (/SELECT/i.test(sql) && /agent_tasks/i.test(sql) && values.includes(sourceRunId)) {
      return sourceTasks.map((item) => ({
        id: `${sourceRunId}:plan:1:${item.key}`,
        run_id: sourceRunId,
        task_key: item.key,
        state: item.state,
        tool_key: `candidate.${item.key}/v1`,
      }));
    }
    if (/FROM agent_memory_entries memory/i.test(sql) && /JOIN agent_artifact_refs artifact/i.test(sql) && values.includes(sourceRunId)) {
      return [{
        schema_version: String(values[3]),
        provenance: String(values[1]),
        storage_identity: `artifact://source/${String(values[1])}`,
      }];
    }

    if (/INSERT INTO agent_tasks/i.test(sql)) {
      tasks.push({ key: String(values[3]), tool: String(values[4]), state: String(values[5]) });
      return [];
    }
    return [];
  };

  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => execute(strings, ...values)) as unknown as PostgresClient;
  (sql as unknown as { begin: (operation: (transaction: PostgresClient) => Promise<unknown>) => Promise<unknown> }).begin = (operation) => operation(sql);
  (sql as unknown as { unsafe: (statement: string, values?: unknown[]) => Promise<unknown[]> }).unsafe = async (statement, values = []) => {
    statements.push({ sql: statement.replace(/\s+/g, " ").trim(), values });
    const runId = String(values[0] ?? "");
    const provenance = String(values[1] ?? "");
    if (runId === sourceRunId && provenance === "candidate.validation/v1") {
      return [{ storage_identity: "artifact://source/validated-assessment" }];
    }
    // A lineage-aware single query is also accepted; current-run-only lookup is not.
    if (runId === "successor-run" && provenance === "candidate.validation/v1"
      && /(source|predecessor|lineage|successor)/i.test(statement)) {
      return [{ storage_identity: "artifact://source/validated-assessment" }];
    }
    return [];
  };
  return { sql, statements, tasks, sourceRunId };
}

async function createRun(options: {
  sourceState: SourceState;
  sourceInputVersion: string;
  sourceProfileVersion: string;
  requestedInputVersion?: string;
  requestedProfileVersion?: string;
  triggerSuffix: string;
}) {
  const transport = syntheticProductionTransport(options);
  const repository = new PostgresAgentRuntimeRepository(transport.sql);
  const result = await repository.createGoal({
    goalId: `goal-${options.triggerSuffix}`,
    runId: "successor-run",
    candidateId: 101,
    goalType: "candidate-analysis-matrix/v1",
    workflowVersion: "matrix-v3",
    inputVersion: options.requestedInputVersion ?? options.sourceInputVersion,
    profileVersion: options.requestedProfileVersion ?? options.sourceProfileVersion,
    policyVersion: "candidate-policy-v1",
    completionCriteriaVersion: "candidate-completion-v1",
    completionCriteria: ["validated-report-pair", "ready-after-pair-publication"],
    budgets,
    triggerIdentity: `manual-reprocess:candidate-101:${options.requestedInputVersion ?? options.sourceInputVersion}:${options.triggerSuffix}`,
  });
  return { ...transport, result };
}

function hasSourceLink(statements: readonly CapturedStatement[], sourceRunId: string) {
  return statements.some(({ sql, values }) =>
    values.includes(sourceRunId)
    && (/(source|predecessor|lineage|successor)/i.test(sql)
      || values.some((value) => typeof value === "string" && value.includes(sourceRunId))));
}

test("WF-023/OPS-003: failed matrix-v3 manual reprocess resumes at reports and reuses immutable upstream lineage", async () => {
  const fixture = await createRun({
    sourceState: "FAILED",
    sourceInputVersion: "input-v1",
    sourceProfileVersion: "vacancy-1:v3",
    triggerSuffix: "revision-9",
  });

  const failures: string[] = [];
  if (!fixture.result.created) failures.push("manual reprocess did not create a successor run");
  if (!hasSourceLink(fixture.statements, fixture.sourceRunId)) failures.push("successor run has no durable sourceRun lineage link");
  for (const key of upstreamThroughValidation) {
    const task = fixture.tasks.find((item) => item.key === key);
    if (task?.state !== "SUCCEEDED") failures.push(`${key}: expected reused SUCCEEDED, actual=${task?.state ?? "missing"}`);
  }
  const reports = fixture.tasks.find((item) => item.key === "reports");
  if (reports?.state !== "RUNNABLE") failures.push(`reports: expected first RUNNABLE, actual=${reports?.state ?? "missing"}`);
  for (const key of ["publication", "notification"]) {
    const task = fixture.tasks.find((item) => item.key === key);
    if (task?.state !== "PENDING") failures.push(`${key}: expected PENDING after recovery boundary, actual=${task?.state ?? "missing"}`);
  }
  const runnable = fixture.tasks.filter((item) => item.state === "RUNNABLE").map((item) => item.key);
  if (runnable.some((key) => upstreamThroughValidation.includes(key as typeof upstreamThroughValidation[number]))) {
    failures.push(`reused upstream tools would be invoked again; runnable=${JSON.stringify(runnable)}`);
  }
  if (runnable.length !== 1 || runnable[0] !== "reports") failures.push(`first runnable task must be reports only; actual=${JSON.stringify(runnable)}`);

  const artifact = await latestDomainArtifactReference(fixture.sql, "successor-run", "candidate.validation/v1");
  if (artifact !== "artifact://source/validated-assessment") failures.push(`lineage artifact lookup failed; actual=${String(artifact)}`);

  assert.deepEqual(failures, []);
});

test("WF-023 negative: changed input/profile starts a complete new matrix-v3 pipeline", async () => {
  for (const variation of [
    { requestedInputVersion: "input-v2", requestedProfileVersion: "vacancy-1:v3", triggerSuffix: "changed-input" },
    { requestedInputVersion: "input-v1", requestedProfileVersion: "vacancy-1:v4", triggerSuffix: "changed-profile" },
  ]) {
    const fixture = await createRun({
      sourceState: "FAILED",
      sourceInputVersion: "input-v1",
      sourceProfileVersion: "vacancy-1:v3",
      ...variation,
    });
    assert.equal(hasSourceLink(fixture.statements, fixture.sourceRunId), false, `${variation.triggerSuffix}: must not attach recovery lineage`);
    assert.equal(fixture.tasks.find((item) => item.key === "drive-snapshot")?.state, "RUNNABLE");
    assert.equal(fixture.tasks.find((item) => item.key === "matrix")?.state, "RUNNABLE");
    assert.equal(fixture.tasks.find((item) => item.key === "reports")?.state, "PENDING");
  }
});

test("WF-023 negative: a prior SUCCEEDED run is not a recovery source", async () => {
  const fixture = await createRun({
    sourceState: "SUCCEEDED",
    sourceInputVersion: "input-v1",
    sourceProfileVersion: "vacancy-1:v3",
    triggerSuffix: "prior-succeeded",
  });
  assert.equal(hasSourceLink(fixture.statements, fixture.sourceRunId), false, "successful prior run must not be linked as failed-stage recovery");
  assert.equal(fixture.tasks.find((item) => item.key === "drive-snapshot")?.state, "RUNNABLE");
  assert.equal(fixture.tasks.find((item) => item.key === "matrix")?.state, "RUNNABLE");
  assert.equal(fixture.tasks.find((item) => item.key === "reports")?.state, "PENDING");
});
