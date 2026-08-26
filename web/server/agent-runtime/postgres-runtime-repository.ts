import { randomUUID } from "node:crypto";
import { registerCanonicalCandidatePipeline } from "../candidate-pipeline/goal.ts";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";
import { createSyntheticRegistries, validatePlan } from "./registry.ts";
import { RuntimeConflictError } from "./runtime.ts";
import type { BudgetKind, BudgetLimits, SideEffectClass } from "./types.ts";
import { CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT, standardEditablePrompt, type EditablePromptSnapshot } from "../product/prompt-contracts.ts";
import { candidateFailureMessage, taskFailurePolicy } from "./failure-policy.ts";

type Row = Record<string, unknown>;
type TaskRow = { id: string; run_id: string; task_key: string; tool_key: string; state: string; revision: number; attempt_count: number; lease_owner: string | null; lease_token: number; lease_expires_at: number | null; idempotency_identity: string };

export class PostgresAgentRuntimeRepository {
  private readonly sql: PostgresClient;
  constructor(sql: PostgresClient) { this.sql = sql; }

  async createGoal(input: { goalId: string; runId: string; candidateId: number; goalType: string; workflowVersion?: string; inputVersion: string; profileVersion: string; policyVersion: string; completionCriteriaVersion: string; completionCriteria: string[]; budgets: BudgetLimits; triggerIdentity: string }) {
    const existing = await this.sql<{ id: string }[]>`SELECT id FROM agent_runs WHERE trigger_identity=${input.triggerIdentity}`; if (existing[0]) return { created: false, runId: existing[0].id };
    const reusableGoals = await this.sql<{ id: string }[]>`SELECT id FROM agent_goals WHERE candidate_id=${input.candidateId} AND input_version=${input.inputVersion} AND profile_version=${input.profileVersion} AND goal_type=${input.goalType} LIMIT 1`;
    const goalId = reusableGoals[0]?.id ?? input.goalId;
    const goalCreated = !reusableGoals[0];
    const registries = createSyntheticRegistries(); registerCanonicalCandidatePipeline(registries.tools, registries.goals);
    const registryGoal = { ...input, candidateId: String(input.candidateId) }; const plan = registries.goals.createPlan(registryGoal); validatePlan(registryGoal, plan, registries.tools, registryGoal);
    const createdAt = new Date().toISOString(); const planId = `${input.runId}:plan:1`; const taskId = (key: string) => `${input.runId}:plan:1:${key}`; const grantExpiresAt = Date.parse(createdAt) + input.budgets.wallTimeMs;
    try {
      await withTransaction(this.sql, async (transaction) => {
        const candidateRows = await transaction<{ record_json: string }[]>`SELECT record_json FROM candidates WHERE id=${input.candidateId}`;
        const candidate = candidateRows[0] ? JSON.parse(candidateRows[0].record_json) as { vacancyId?: string } : {};
        const versionNumber = Number(input.profileVersion.match(/:v(\d+)$/)?.[1] ?? 0);
        const versionRows = candidate.vacancyId && versionNumber > 0
          ? await transaction<{ record_json: string }[]>`SELECT record_json FROM vacancy_profile_versions WHERE vacancy_id=${candidate.vacancyId} AND version=${versionNumber}`
          : [];
        const currentRows = !versionRows[0] && candidate.vacancyId
          ? await transaction<{ record_json: string }[]>`SELECT record_json FROM vacancies WHERE id=${candidate.vacancyId}`
          : [];
        const vacancy = (versionRows[0] ?? currentRows[0]) ? JSON.parse((versionRows[0] ?? currentRows[0]).record_json) as { analysisPrompt?: EditablePromptSnapshot } : {};
        const analysisPrompt = vacancy.analysisPrompt ?? standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
        if (goalCreated) await transaction`INSERT INTO agent_goals (id,candidate_id,goal_type,input_version,profile_version,policy_version,completion_criteria_version,completion_criteria_json,state,revision,created_at) VALUES (${goalId},${input.candidateId},${input.goalType},${input.inputVersion},${input.profileVersion},${input.policyVersion},${input.completionCriteriaVersion},${JSON.stringify(input.completionCriteria)},'ACTIVE',1,${createdAt})`;
        const workflowVersion = input.workflowVersion ?? (input.goalType === "candidate-analysis-matrix/v1" ? "matrix-v2" : "legacy-v1");
        await transaction`INSERT INTO agent_runs (id,goal_id,trigger_identity,state,revision,current_plan_version,last_progress_at,analysis_prompt_text,analysis_prompt_artifact_id,analysis_prompt_hash,workflow_version) VALUES (${input.runId},${goalId},${input.triggerIdentity},'ACTIVE',1,1,${createdAt},${analysisPrompt.text},${analysisPrompt.artifactId},${analysisPrompt.hash},${workflowVersion})`;
        await transaction`INSERT INTO agent_plan_versions (id,run_id,version,reason,plan_json,created_at) VALUES (${planId},${input.runId},1,'INITIAL_PLAN',${JSON.stringify(plan)},${createdAt})`;
        for (const task of plan) {
          const id = taskId(task.key); const definition = registries.tools.get(task.tool);
          const operations = task.tool === "candidate.drive-snapshot/v1" ? ["execute","list","download"] : ["candidate.document-extraction/v1","candidate.transcription/v1"].includes(task.tool) ? ["execute","download"] : task.tool === "candidate.drive-publication/v1" ? ["execute","ensure-folder","publish","cleanup"] : task.tool === "candidate.cleanup-reports/v1" ? ["execute","cleanup"] : ["execute"];
          await transaction`INSERT INTO agent_tasks (id,run_id,plan_version_id,task_key,tool_key,state,revision,attempt_count,lease_token,idempotency_identity,preconditions_json,expected_outputs_json) VALUES (${id},${input.runId},${planId},${task.key},${task.tool},${task.dependencies.length ? "PENDING" : "RUNNABLE"},1,0,0,${`${input.runId}:plan:1:${task.key}`},${JSON.stringify(task.dependencies)},${JSON.stringify(task.expectedOutputs)})`;
          for (const dependency of task.dependencies) await transaction`INSERT INTO agent_task_dependencies (task_id,depends_on_task_id,required_outcome) VALUES (${id},${taskId(dependency)},'SUCCEEDED')`;
          await transaction`INSERT INTO agent_tool_grants (id,task_id,candidate_id,run_id,input_version,policy_version,tool_key,operations_json,side_effect_class,budget_link,expires_at) VALUES (${`${id}:grant:execute`},${id},${input.candidateId},${input.runId},${input.inputVersion},${input.policyVersion},${task.tool},${JSON.stringify(operations)},${definition.sideEffectClass},${`${input.runId}:budget:externalRequests`},${grantExpiresAt})`;
        }
        for (const [kind, limit] of Object.entries(input.budgets) as [BudgetKind, number][]) await transaction`INSERT INTO agent_budget_ledger (id,run_id,kind,limit_value,used_value,revision) VALUES (${`${input.runId}:budget:${kind}`},${input.runId},${kind},${limit},0,1)`;
        await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${input.runId},1,${goalCreated ? `goal-created:${goalId}` : `run-created:${input.triggerIdentity}`},${goalCreated ? 'GOAL_CREATED' : 'RUN_CREATED'},'runtime',1,${JSON.stringify({ goalType: input.goalType, workflowVersion, inputVersion: input.inputVersion, profileVersion: input.profileVersion, policyVersion: input.policyVersion, goalReused: !goalCreated })},${createdAt})`;
      });
    } catch (error) {
      const raced = await this.sql<{ id: string }[]>`SELECT id FROM agent_runs WHERE trigger_identity=${input.triggerIdentity}`; if (raced[0]) return { created: false, runId: raced[0].id }; throw error;
    }
    return { created: true, runId: input.runId, planVersion: 1, goalId, goalCreated };
  }
  async issueGrant(input: { id: string; taskId: string; candidateId: number; runId: string; inputVersion: string; policyVersion: string; toolKey: string; operations: string[]; sideEffectClass: SideEffectClass; budgetLink: string; expiresAt: number }) {
    const rows = await this.sql`INSERT INTO agent_tool_grants (id,task_id,candidate_id,run_id,input_version,policy_version,tool_key,operations_json,side_effect_class,budget_link,expires_at)
      SELECT ${input.id},${input.taskId},${input.candidateId},${input.runId},${input.inputVersion},${input.policyVersion},${input.toolKey},${JSON.stringify(input.operations)},${input.sideEffectClass},${input.budgetLink},${input.expiresAt}
      WHERE EXISTS (SELECT 1 FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id JOIN agent_goals goal ON goal.id=run.goal_id JOIN agent_budget_ledger budget ON budget.id=${input.budgetLink} AND budget.run_id=run.id
        WHERE task.id=${input.taskId} AND task.run_id=${input.runId} AND task.tool_key=${input.toolKey} AND goal.candidate_id=${input.candidateId} AND goal.input_version=${input.inputVersion} AND goal.policy_version=${input.policyVersion}) RETURNING id`;
    if (rows.length !== 1) throw new RuntimeConflictError("INVALID_GRANT_SCOPE"); return { id: input.id };
  }
  async revokeGrant(id: string, revokedAt: number) { const rows = await this.sql`UPDATE agent_tool_grants SET revoked_at=${revokedAt} WHERE id=${id} AND revoked_at IS NULL RETURNING id`; if (!rows.length) throw new RuntimeConflictError("GRANT_NOT_FOUND_OR_REVOKED"); }
  async publishTrigger(input: { identity: string; runId: string; type: string; actor: string; planVersion: number; expectedRevision: number; payload: Record<string, unknown> }) {
    return withTransaction(this.sql, async (transaction) => {
      const duplicate = await transaction<{ run_id: string }[]>`SELECT run_id FROM agent_events WHERE event_identity=${input.identity}`; if (duplicate[0]) return { accepted: false, duplicate: true, runId: duplicate[0].run_id };
      const run = await transaction<{ revision: number }[]>`SELECT revision FROM agent_runs WHERE id=${input.runId} FOR UPDATE`; if (!run[0] || run[0].revision !== input.expectedRevision) throw new RuntimeConflictError("STALE_RUNTIME_REVISION");
      const sequence = await this.nextSequence(input.runId, transaction); const now = new Date().toISOString();
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${input.runId},${sequence},${input.identity},${input.type},${input.actor},${input.planVersion},${JSON.stringify(input.payload)},${now})`;
      await transaction`UPDATE agent_runs SET revision=revision+1,last_progress_at=${now} WHERE id=${input.runId}`; return { accepted: true, duplicate: false, runId: input.runId };
    });
  }
  async promote(runId: string) {
    const rows = await this.sql<{ id: string }[]>`UPDATE agent_tasks task SET state='RUNNABLE',revision=revision+1 WHERE task.run_id=${runId} AND task.state='PENDING'
      AND NOT EXISTS (SELECT 1 FROM agent_task_dependencies dep JOIN agent_tasks required ON required.id=dep.depends_on_task_id WHERE dep.task_id=task.id AND required.state<>dep.required_outcome) RETURNING task.id`;
    return rows.map((row) => row.id);
  }
  async claim(input: { worker: string; now: number; leaseMs: number }) {
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<(TaskRow & Row)[]>`SELECT t.*,g.candidate_id,g.input_version,g.profile_version,g.policy_version FROM agent_tasks t JOIN agent_runs r ON r.id=t.run_id JOIN agent_goals g ON g.id=r.goal_id
        WHERE t.state='RUNNABLE' AND r.state='ACTIVE' AND COALESCE(t.lease_expires_at,0)<=${input.now}
          AND EXISTS (SELECT 1 FROM agent_budget_ledger b WHERE b.run_id=t.run_id AND b.kind='taskAttempts' AND b.used_value<b.limit_value) ORDER BY t.id FOR UPDATE SKIP LOCKED LIMIT 1`;
      const candidate = rows[0]; if (!candidate) return null;
      const nextToken = candidate.lease_token + 1; const nextAttempt = candidate.attempt_count + 1; const attemptId = randomUUID();
      await transaction`UPDATE agent_tasks SET state='RUNNING',revision=revision+1,attempt_count=${nextAttempt},lease_owner=${input.worker},lease_token=${nextToken},lease_expires_at=${input.now + input.leaseMs} WHERE id=${candidate.id}`;
      const budget = await transaction`UPDATE agent_budget_ledger SET used_value=used_value+1,revision=revision+1 WHERE run_id=${candidate.run_id} AND kind='taskAttempts' AND used_value<limit_value RETURNING id`; if (!budget.length) throw new RuntimeConflictError("BUDGET_EXHAUSTED:taskAttempts");
      await transaction`INSERT INTO agent_attempts (id,task_id,attempt_number,lease_owner,lease_token,state,started_at) VALUES (${attemptId},${candidate.id},${nextAttempt},${input.worker},${nextToken},'RUNNING',${new Date(input.now).toISOString()})`;
      return { ...candidate, state: "RUNNING", revision: candidate.revision + 1, attempt_count: nextAttempt, lease_owner: input.worker, lease_token: nextToken, lease_expires_at: input.now + input.leaseMs, attemptId };
    });
  }
  async heartbeat(input: { taskId: string; worker: string; leaseToken: number; now: number; leaseMs: number }) { const rows = await this.sql`UPDATE agent_tasks SET lease_expires_at=${input.now + input.leaseMs},revision=revision+1 WHERE id=${input.taskId} AND state='RUNNING' AND lease_owner=${input.worker} AND lease_token=${input.leaseToken} RETURNING id`; if (!rows.length) throw new RuntimeConflictError("STALE_LEASE_TOKEN"); }
  async checkpoint(input: { attemptId: string; taskId: string; worker: string; leaseToken: number; kind: string; identity: string; remoteJobId?: string; artifactIdentity?: string; checksum?: string }) {
    const task = await this.sql`SELECT id FROM agent_tasks WHERE id=${input.taskId} AND state='RUNNING' AND lease_owner=${input.worker} AND lease_token=${input.leaseToken}`; if (!task.length) throw new RuntimeConflictError("STALE_LEASE_TOKEN");
    await this.sql`INSERT INTO agent_checkpoints (id,attempt_id,lease_token,kind,identity,remote_job_id,artifact_identity,checksum,created_at) VALUES (${randomUUID()},${input.attemptId},${input.leaseToken},${input.kind},${input.identity},${input.remoteJobId ?? null},${input.artifactIdentity ?? null},${input.checksum ?? null},${new Date().toISOString()}) ON CONFLICT (attempt_id,kind,identity) DO NOTHING`;
  }
  async prepareExternalEffect(input: { taskId: string; attemptId: string; worker: string; leaseToken: number; grantId: string; operation: string; operationIdentity: string; sideEffectClass: SideEffectClass; now: number }) {
    return withTransaction(this.sql, async (transaction) => {
      const prepared = await transaction`SELECT id FROM agent_checkpoints WHERE attempt_id=${input.attemptId} AND kind='external-effect-prepared' AND identity=${input.operationIdentity}`; if (prepared.length) return { prepared: true, reused: true, grantId: input.grantId };
      const rows = await transaction<Row[]>`SELECT task.run_id,task.tool_key,goal.candidate_id,goal.input_version,goal.policy_version,tool_grant.operations_json,tool_grant.side_effect_class,tool_grant.budget_link,tool_grant.expires_at,run.current_plan_version
        FROM agent_tasks task JOIN agent_attempts attempt ON attempt.task_id=task.id JOIN agent_runs run ON run.id=task.run_id JOIN agent_goals goal ON goal.id=run.goal_id
        JOIN agent_tool_grants tool_grant ON tool_grant.id=${input.grantId} AND tool_grant.task_id=task.id AND tool_grant.run_id=task.run_id AND tool_grant.candidate_id=goal.candidate_id AND tool_grant.input_version=goal.input_version AND tool_grant.policy_version=goal.policy_version AND tool_grant.tool_key=task.tool_key AND tool_grant.revoked_at IS NULL
        WHERE task.id=${input.taskId} AND task.state='RUNNING' AND task.lease_owner=${input.worker} AND task.lease_token=${input.leaseToken} AND attempt.id=${input.attemptId} AND attempt.state='RUNNING' AND attempt.lease_owner=${input.worker} AND attempt.lease_token=${input.leaseToken} FOR UPDATE`;
      const scope = rows[0]; if (!scope || Number(scope.expires_at) <= input.now) throw new RuntimeConflictError("GRANT_ABSENT_OR_EXPIRED");
      const operations = JSON.parse(String(scope.operations_json)) as string[]; const ranks = ["read-only","idempotent-write","reversible-write","irreversible-write"];
      if (!operations.includes(input.operation) || ranks.indexOf(String(scope.side_effect_class)) < ranks.indexOf(input.sideEffectClass)) throw new RuntimeConflictError("GRANT_SCOPE_OR_SIDE_EFFECT_DENIED");
      const budget = await transaction`UPDATE agent_budget_ledger SET used_value=used_value+1,revision=revision+1 WHERE id=${String(scope.budget_link)} AND run_id=${String(scope.run_id)} AND kind='externalRequests' AND used_value<limit_value RETURNING id`; if (!budget.length) throw new RuntimeConflictError("BUDGET_EXHAUSTED:externalRequests");
      const createdAt = new Date(input.now).toISOString(); const sequence = await this.nextSequence(String(scope.run_id), transaction);
      await transaction`INSERT INTO agent_checkpoints (id,attempt_id,lease_token,kind,identity,artifact_identity,created_at) VALUES (${randomUUID()},${input.attemptId},${input.leaseToken},'external-effect-prepared',${input.operationIdentity},${input.operationIdentity},${createdAt})`;
      if (input.sideEffectClass !== "read-only") await transaction`INSERT INTO agent_outbox (id,run_id,operation_identity,side_effect_class,state,payload_ref,attempts,unknown_outcome,created_at) VALUES (${randomUUID()},${String(scope.run_id)},${input.operationIdentity},${input.sideEffectClass},'PENDING',${`task:${input.taskId}`},0,false,${createdAt}) ON CONFLICT (operation_identity) DO NOTHING`;
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at) VALUES (${randomUUID()},${String(scope.run_id)},${sequence},${`external-effect-prepared:${input.attemptId}:${input.operationIdentity}`},'EXTERNAL_EFFECT_PREPARED','runtime',${Number(scope.current_plan_version)},${input.taskId},${JSON.stringify({ grantId: input.grantId, operation: input.operation, sideEffectClass: input.sideEffectClass })},${createdAt})`;
      return { prepared: true, reused: false, grantId: input.grantId };
    });
  }
  async waitForHuman(input: { taskId: string; attemptId: string; worker: string; leaseToken: number; obstacle: string; action: string; now: number }) {
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<Row[]>`SELECT task.run_id,run.goal_id,run.revision AS run_revision,run.current_plan_version,goal.candidate_id,COALESCE((SELECT max(version) FROM agent_escalations WHERE run_id=task.run_id),0)+1 AS escalation_version
        FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id JOIN agent_goals goal ON goal.id=run.goal_id WHERE task.id=${input.taskId} AND task.state='RUNNING' AND task.lease_owner=${input.worker} AND task.lease_token=${input.leaseToken} FOR UPDATE`;
      const current = rows[0]; if (!current) throw new RuntimeConflictError("STALE_LEASE_TOKEN");
      const existing = await transaction<{ id: string; version: number }[]>`SELECT id,version FROM agent_escalations WHERE run_id=${String(current.run_id)} AND state='OPEN' AND obstacle_fingerprint=${input.obstacle}`; if (existing[0]) return { escalationId: existing[0].id, version: existing[0].version, duplicate: true };
      const escalationId = randomUUID(); const createdAt = new Date(input.now).toISOString(); const sequence = await this.nextSequence(String(current.run_id), transaction); const budgets = await transaction`SELECT kind,limit_value,used_value FROM agent_budget_ledger WHERE run_id=${String(current.run_id)} ORDER BY kind`;
      await transaction`UPDATE agent_tasks SET state='WAITING',revision=revision+1,lease_owner=NULL,lease_expires_at=NULL WHERE id=${input.taskId}`;
      await transaction`UPDATE agent_attempts SET state='WAITING_FOR_HUMAN',finished_at=${createdAt},error_code=${input.obstacle} WHERE id=${input.attemptId}`;
      await transaction`UPDATE agent_runs SET state='WAITING_FOR_HUMAN',revision=revision+1,last_progress_at=${createdAt} WHERE id=${String(current.run_id)} AND state='ACTIVE' AND revision=${Number(current.run_revision)}`;
      await transaction`UPDATE agent_goals SET state='WAITING_FOR_HUMAN',revision=revision+1 WHERE id=${String(current.goal_id)} AND state='ACTIVE'`;
      await transaction`INSERT INTO agent_escalations (id,run_id,version,state,obstacle_fingerprint,safe_summary,impact,attempts_json,budgets_json,evidence_refs_json,reusable_artifacts_json)
        VALUES (${escalationId},${String(current.run_id)},${Number(current.escalation_version)},'OPEN',${input.obstacle},'Google Drive требует повторного подключения','Операции Google Drive приостановлены; сохранённый checkpoint будет продолжен без полного перезапуска.',${JSON.stringify({ taskId: input.taskId })},${JSON.stringify(budgets)},${JSON.stringify([`checkpoint:${input.taskId}`])},'[]')`;
      await transaction`INSERT INTO agent_escalation_actions (escalation_id,action_key,schema_version,schema_json,changes_immutable_inputs) VALUES (${escalationId},'reconnect-google-drive','1.0','{"type":"object","properties":{},"additionalProperties":false}',false)`;
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at) VALUES (${randomUUID()},${String(current.run_id)},${sequence},${`google-drive-reauth:${String(current.run_id)}:${Number(current.escalation_version)}`},'GOOGLE_DRIVE_REAUTH_REQUIRED','runtime',${Number(current.current_plan_version)},${input.taskId},${JSON.stringify({ obstacle: input.obstacle, action: input.action, escalationId })},${createdAt})`;
      await transaction`UPDATE candidates SET revision=revision+1,record_json=((record_json::jsonb || jsonb_build_object('status','WAITING_FOR_HUMAN','escalation',jsonb_build_object('code',${input.obstacle},'action',${input.action},'stage','google-drive')))::text) WHERE id=${Number(current.candidate_id)}`;
      return { escalationId, version: Number(current.escalation_version), duplicate: false };
    });
  }
  async resumeGoogleDriveRuns(input: { connectionId: string; ownerSubject: string; now: number }) {
    const rows = await this.sql<Row[]>`SELECT escalation.id AS escalation_id,escalation.run_id,escalation.version,run.goal_id,run.revision AS run_revision,run.current_plan_version,goal.candidate_id
      FROM agent_escalations escalation JOIN agent_escalation_actions action ON action.escalation_id=escalation.id AND action.action_key='reconnect-google-drive' JOIN agent_runs run ON run.id=escalation.run_id JOIN agent_goals goal ON goal.id=run.goal_id
      WHERE escalation.state='OPEN' AND run.state='WAITING_FOR_HUMAN'`;
    const resumedRunIds: string[] = [];
    for (const row of rows) await withTransaction(this.sql, async (transaction) => {
      const now = new Date(input.now).toISOString(); const sequence = await this.nextSequence(String(row.run_id), transaction);
      const updated = await transaction`UPDATE agent_escalations SET state='RESOLVED',version=version+1 WHERE id=${String(row.escalation_id)} AND state='OPEN' AND version=${Number(row.version)} RETURNING id`; if (!updated.length) return;
      await transaction`UPDATE agent_runs SET state='ACTIVE',revision=revision+1,last_progress_at=${now} WHERE id=${String(row.run_id)} AND state='WAITING_FOR_HUMAN' AND revision=${Number(row.run_revision)}`;
      await transaction`UPDATE agent_goals SET state='ACTIVE',revision=revision+1 WHERE id=${String(row.goal_id)} AND state='WAITING_FOR_HUMAN'`;
      await transaction`UPDATE agent_tasks SET state=CASE WHEN EXISTS (SELECT 1 FROM agent_outbox outbox WHERE outbox.run_id=agent_tasks.run_id AND outbox.operation_identity=agent_tasks.idempotency_identity AND outbox.state='UNKNOWN_OUTCOME') THEN 'UNKNOWN_OUTCOME' ELSE 'RUNNABLE' END,revision=revision+1 WHERE run_id=${String(row.run_id)} AND state='WAITING'`;
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${String(row.run_id)},${sequence},${`google-drive-reconnected:${String(row.escalation_id)}:${Number(row.version)}`},'GOOGLE_DRIVE_OAUTH_RECONNECTED','oauth',${Number(row.current_plan_version)},${JSON.stringify({ connectionId: input.connectionId, ownerSubjectVerified: Boolean(input.ownerSubject) })},${now})`;
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${String(row.run_id)},${sequence + 1},${`drive-resume:${String(row.escalation_id)}:${Number(row.version)}`},'DRIVE_RESUME_PUBLISHED','runtime',${Number(row.current_plan_version)},${JSON.stringify({ escalationId: row.escalation_id })},${now})`;
      await transaction`UPDATE candidates SET revision=revision+1,record_json=((record_json::jsonb || jsonb_build_object('status','ANALYZING','escalation',NULL))::text) WHERE id=${Number(row.candidate_id)}`; resumedRunIds.push(String(row.run_id));
    });
    return { resumedRunIds };
  }
  async outcome(input: { taskId: string; attemptId: string; worker: string; leaseToken: number; outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN_OUTCOME"; errorCode?: string }) {
    await withTransaction(this.sql, async (transaction) => {
      const task = await transaction<{ idempotency_identity: string; run_id: string; task_key: string; tool_key: string; attempt_count: number; current_plan_version: number; goal_id: string; candidate_id: number }[]>`SELECT task.idempotency_identity,task.run_id,task.task_key,task.tool_key,task.attempt_count,run.current_plan_version,run.goal_id,goal.candidate_id
        FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id JOIN agent_goals goal ON goal.id=run.goal_id
        WHERE task.id=${input.taskId} FOR UPDATE`; if (!task[0]) throw new RuntimeConflictError("TASK_NOT_FOUND");
      const current = task[0];
      const finishedAt = new Date().toISOString();
      const policy = input.outcome === "FAILED" ? taskFailurePolicy(current.tool_key, input.errorCode ?? "TASK_FAILED", current.attempt_count) : undefined;
      const nextTaskState = policy?.retry ? "RUNNABLE" : input.outcome;
      const retryAt = policy?.retry ? Date.now() + policy.delayMs : null;
      const tasks = await transaction`UPDATE agent_tasks SET state=${nextTaskState},revision=revision+1,lease_owner=NULL,lease_expires_at=${retryAt} WHERE id=${input.taskId} AND state='RUNNING' AND lease_owner=${input.worker} AND lease_token=${input.leaseToken} RETURNING id`;
      const attempts = await transaction`UPDATE agent_attempts SET state=${input.outcome},unknown_outcome=${input.outcome === "UNKNOWN_OUTCOME"},finished_at=${finishedAt},error_code=${input.errorCode ?? null} WHERE id=${input.attemptId} AND lease_owner=${input.worker} AND lease_token=${input.leaseToken} AND state='RUNNING' RETURNING id`;
      if (!tasks.length || !attempts.length) throw new RuntimeConflictError("STALE_LEASE_TOKEN");
      const outboxState = input.outcome === "SUCCEEDED" ? "SENT" : input.outcome === "UNKNOWN_OUTCOME" ? "UNKNOWN_OUTCOME" : "FAILED";
      await transaction`UPDATE agent_outbox SET state=${outboxState},unknown_outcome=${input.outcome === "UNKNOWN_OUTCOME"},attempts=attempts+1 WHERE operation_identity=${current.idempotency_identity}`;
      if (input.outcome === "FAILED") {
        const sequence = await this.nextSequence(current.run_id, transaction);
        if (policy?.retry) {
          await transaction`UPDATE agent_runs SET revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE'`;
          await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at)
            VALUES (${randomUUID()},${current.run_id},${sequence},${`task-retry:${input.attemptId}`},'TASK_RETRY_SCHEDULED','runtime',${current.current_plan_version},${input.taskId},${JSON.stringify({ taskKey: current.task_key, errorCode: input.errorCode, attempt: current.attempt_count, maxAttempts: policy.maxAttempts, delayMs: policy.delayMs })},${finishedAt})`;
          return;
        }
        const safeCode = input.errorCode ?? "TASK_FAILED";
        const safeMessage = candidateFailureMessage(safeCode);
        await transaction`UPDATE agent_runs SET state='FAILED',revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE'`;
        await transaction`UPDATE agent_goals SET state='FAILED',revision=revision+1 WHERE id=${current.goal_id} AND state='ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM agent_runs other WHERE other.goal_id=${current.goal_id} AND other.id<>${current.run_id} AND other.state='ACTIVE')`;
        await transaction`UPDATE candidates SET revision=revision+1,record_json=(record_json::jsonb || ${JSON.stringify({
          status: "FAILED", failedStage: current.task_key, failureReason: safeMessage,
          attempts: current.attempt_count, automaticRetriesExhausted: true,
        })}::jsonb)::text WHERE id=${current.candidate_id}`;
        await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at)
          VALUES (${randomUUID()},${current.run_id},${sequence},${`run-failed:${current.run_id}`},'RUN_FAILED','runtime',${current.current_plan_version},${input.taskId},${JSON.stringify({ taskKey: current.task_key, errorCode: safeCode, attempts: current.attempt_count })},${finishedAt}) ON CONFLICT (event_identity) DO NOTHING`;
        return;
      }
      if (input.outcome === "SUCCEEDED") {
        await transaction`UPDATE agent_runs SET revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE'`;
        const completed = await transaction`UPDATE agent_runs SET state='SUCCEEDED',revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE' AND NOT EXISTS (SELECT 1 FROM agent_tasks WHERE run_id=${current.run_id} AND state<>'SUCCEEDED') RETURNING current_plan_version`;
        if (completed[0]) {
          await transaction`UPDATE agent_goals SET state='SUCCEEDED',revision=revision+1 WHERE id=(SELECT goal_id FROM agent_runs WHERE id=${current.run_id}) AND state='ACTIVE'`;
          const sequence = await this.nextSequence(current.run_id, transaction); await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${current.run_id},${sequence},${`run-succeeded:${current.run_id}`},'RUN_SUCCEEDED','runtime',${Number(completed[0].current_plan_version)},'{}',${finishedAt}) ON CONFLICT (event_identity) DO NOTHING`;
        }
      }
    });
  }
  async recoverStale(now: number) {
    return withTransaction(this.sql, async (transaction) => {
      const stale = await transaction<{ id: string; run_id: string; unknown_outcome: boolean }[]>`SELECT task.id,task.run_id,EXISTS (
        SELECT 1 FROM agent_outbox outbox WHERE outbox.run_id=task.run_id AND outbox.operation_identity=task.idempotency_identity AND outbox.state='UNKNOWN_OUTCOME'
      ) AS unknown_outcome FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id AND run.state='ACTIVE' WHERE (task.state='RUNNING' AND task.lease_expires_at<=${now}) OR (
        task.state='UNKNOWN_OUTCOME' AND NOT EXISTS (SELECT 1 FROM agent_outbox outbox WHERE outbox.run_id=task.run_id AND outbox.operation_identity=task.idempotency_identity)
      ) FOR UPDATE`;
      const recoveredAt = new Date(now).toISOString();
      for (const task of stale) {
        const nextState = task.unknown_outcome ? "UNKNOWN_OUTCOME" : "RUNNABLE";
        await transaction`UPDATE agent_attempts SET state=${nextState === "RUNNABLE" ? "FAILED" : "UNKNOWN_OUTCOME"},unknown_outcome=${task.unknown_outcome},finished_at=${recoveredAt},error_code='LEASE_EXPIRED_RECOVERED' WHERE task_id=${task.id} AND state='RUNNING'`;
        await transaction`UPDATE agent_tasks SET state=${nextState},revision=revision+1,lease_owner=NULL,lease_expires_at=NULL WHERE id=${task.id}`;
        await transaction`UPDATE agent_runs SET last_progress_at=${recoveredAt},revision=revision+1 WHERE id=${task.run_id} AND state='ACTIVE'`;
      }
      return stale.map((task) => task.id);
    });
  }
  async authorizeTool(input: { taskId: string; operation: string; sideEffectClass: "read-only" | "idempotent-write" | "reversible-write" | "irreversible-write"; now: number }) {
    const tasks = await this.sql<Row[]>`SELECT t.run_id,t.tool_key,r.current_plan_version,g.candidate_id,g.input_version,g.policy_version FROM agent_tasks t JOIN agent_runs r ON r.id=t.run_id JOIN agent_goals g ON g.id=r.goal_id WHERE t.id=${input.taskId} AND t.state='RUNNING'`;
    const task = tasks[0]; if (!task) throw new RuntimeConflictError("TASK_NOT_RUNNING");
    const grants = await this.sql<{ id: string; operations_json: string; side_effect_class: string }[]>`SELECT id,operations_json,side_effect_class FROM agent_tool_grants WHERE task_id=${input.taskId} AND candidate_id=${Number(task.candidate_id)} AND run_id=${String(task.run_id)} AND input_version=${String(task.input_version)} AND policy_version=${String(task.policy_version)} AND tool_key=${String(task.tool_key)} AND expires_at>${input.now} AND revoked_at IS NULL ORDER BY expires_at DESC`;
    const ranks = ["read-only","idempotent-write","reversible-write","irreversible-write"]; const grant = grants.find((item) => (JSON.parse(item.operations_json) as string[]).includes(input.operation) && ranks.indexOf(item.side_effect_class) >= ranks.indexOf(input.sideEffectClass));
    if (grant) return { allowed: true, grantId: grant.id, secretResolved: false };
    const sequence = await this.nextSequence(String(task.run_id)); await this.sql`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at) VALUES (${randomUUID()},${String(task.run_id)},${sequence},${`policy-denial:${randomUUID()}`},'TOOL_POLICY_DENIED','policy',${Number(task.current_plan_version)},${input.taskId},${JSON.stringify({ toolKey: task.tool_key, operation: input.operation, sideEffectClass: input.sideEffectClass })},${new Date(input.now).toISOString()})`;
    return { allowed: false, code: grants.length ? "GRANT_SCOPE_OR_SIDE_EFFECT_DENIED" : "GRANT_ABSENT_OR_EXPIRED", secretResolved: false };
  }
  async authorizeDriveResource(input: { taskId: string; grantId: string; operation: string; fileId: string; now: number }) {
    const rows = await this.sql<Row[]>`WITH RECURSIVE ancestry(file_id,parent_id,depth) AS (
      SELECT object.file_id,object.parent_id,0 FROM google_drive_registered_objects object JOIN google_drive_oauth_connections connection ON connection.id=object.connection_id AND connection.singleton_key='primary' AND connection.state='CONNECTED' WHERE object.file_id=${input.fileId}
      UNION ALL SELECT parent.file_id,parent.parent_id,ancestry.depth+1 FROM google_drive_registered_objects parent JOIN ancestry ON parent.file_id=ancestry.parent_id JOIN google_drive_oauth_connections connection ON connection.id=parent.connection_id AND connection.singleton_key='primary' WHERE ancestry.depth<64)
      SELECT tool_grant.operations_json,connection.id AS connection_id,connection.root_folder_id,goal.candidate_id,goal.input_version FROM agent_tool_grants tool_grant JOIN agent_tasks task ON task.id=tool_grant.task_id AND task.run_id=tool_grant.run_id AND task.tool_key=tool_grant.tool_key JOIN agent_runs run ON run.id=task.run_id JOIN agent_goals goal ON goal.id=run.goal_id AND goal.candidate_id=tool_grant.candidate_id AND goal.input_version=tool_grant.input_version AND goal.policy_version=tool_grant.policy_version JOIN google_drive_oauth_connections connection ON connection.singleton_key='primary' AND connection.state='CONNECTED'
      WHERE tool_grant.id=${input.grantId} AND tool_grant.task_id=${input.taskId} AND tool_grant.revoked_at IS NULL AND tool_grant.expires_at>${input.now} AND EXISTS (SELECT 1 FROM ancestry WHERE file_id=connection.root_folder_id) LIMIT 1`;
    const scope = rows[0]; if (!scope) return { allowed: false as const, code: "GOOGLE_DRIVE_ROOT_OR_GRANT_DENIED", secretResolved: false };
    if (!(JSON.parse(String(scope.operations_json)) as string[]).includes(input.operation)) return { allowed: false as const, code: "GRANT_SCOPE_OR_SIDE_EFFECT_DENIED", secretResolved: false };
    return { allowed: true as const, grantId: input.grantId, connectionId: String(scope.connection_id), rootFolderId: String(scope.root_folder_id), candidateId: Number(scope.candidate_id), inputVersion: String(scope.input_version), secretResolved: false };
  }
  async timeline(runId: string) { return this.sql`SELECT id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at FROM agent_events WHERE run_id=${runId} ORDER BY sequence`; }
  async projection(runId: string) {
    const [runs,tasks,budgets,escalations] = await Promise.all([
      this.sql`SELECT id,goal_id,state,revision,current_plan_version,last_progress_at FROM agent_runs WHERE id=${runId}`,
      this.sql`SELECT id,task_key,state,revision,attempt_count,lease_owner,lease_token,lease_expires_at FROM agent_tasks WHERE run_id=${runId} ORDER BY id`,
      this.sql`SELECT kind,limit_value,used_value,revision FROM agent_budget_ledger WHERE run_id=${runId} ORDER BY kind`,
      this.sql`SELECT id,version,state,safe_summary,impact FROM agent_escalations WHERE run_id=${runId} AND state='OPEN' ORDER BY version DESC LIMIT 1`,
    ]); return { run: runs[0] ?? null, tasks, budgets, escalation: escalations[0] ?? null };
  }
  async resolveEscalation(input: { escalationId: string; expectedVersion: number; action: string; actor: string; newInputVersion?: string; newProfileVersion?: string }) {
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<Row[]>`SELECT e.id,e.run_id,e.version,e.state,a.changes_immutable_inputs,r.goal_id,r.revision AS run_revision,r.workflow_version,g.candidate_id,g.goal_type,g.input_version,g.profile_version,g.policy_version,g.completion_criteria_version,g.completion_criteria_json
        FROM agent_escalations e JOIN agent_escalation_actions a ON a.escalation_id=e.id AND a.action_key=${input.action} JOIN agent_runs r ON r.id=e.run_id JOIN agent_goals g ON g.id=r.goal_id WHERE e.id=${input.escalationId} FOR UPDATE`;
      const row = rows[0]; if (!row || row.state !== "OPEN" || Number(row.version) !== input.expectedVersion) throw new RuntimeConflictError("STALE_ESCALATION_VERSION");
      const eventTime = new Date().toISOString(); const eventSequence = await this.nextSequence(String(row.run_id), transaction);
      await transaction`UPDATE agent_escalations SET state='RESOLVED',version=version+1 WHERE id=${input.escalationId}`;
      if (!row.changes_immutable_inputs) {
        await transaction`UPDATE agent_runs SET state='ACTIVE',revision=revision+1,last_progress_at=${eventTime} WHERE id=${String(row.run_id)} AND state='WAITING_FOR_HUMAN' AND revision=${Number(row.run_revision)}`;
        await transaction`UPDATE candidates SET revision=revision+1,record_json=((record_json::jsonb || jsonb_build_object('status','ANALYZING','escalation',NULL))::text) WHERE id=${Number(row.candidate_id)}`;
        await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${String(row.run_id)},${eventSequence},${`human-resolution:${input.escalationId}:${input.expectedVersion}`},'RUN_RESUMED',${input.actor},(SELECT current_plan_version FROM agent_runs WHERE id=${String(row.run_id)}),${JSON.stringify({ escalationId: input.escalationId, action: input.action, sameRun: true })},${eventTime})`;
        return { sameRun: true, runId: row.run_id };
      }
      if (!input.newInputVersion && !input.newProfileVersion) throw new RuntimeConflictError("NEW_IMMUTABLE_VERSION_REQUIRED");
      const newGoalId = randomUUID(); const newRunId = randomUUID(); const nextInput = input.newInputVersion ?? String(row.input_version); const nextProfile = input.newProfileVersion ?? String(row.profile_version);
      await transaction`UPDATE agent_runs SET state='SUPERSEDED',revision=revision+1,last_progress_at=${eventTime} WHERE id=${String(row.run_id)} AND state='WAITING_FOR_HUMAN' AND revision=${Number(row.run_revision)}`;
      await transaction`INSERT INTO agent_goals (id,candidate_id,goal_type,input_version,profile_version,policy_version,completion_criteria_version,completion_criteria_json,state,revision,created_at) VALUES (${newGoalId},${Number(row.candidate_id)},${String(row.goal_type)},${nextInput},${nextProfile},${String(row.policy_version)},${String(row.completion_criteria_version)},${String(row.completion_criteria_json)},'ACTIVE',1,${eventTime})`;
      await transaction`INSERT INTO agent_runs (id,goal_id,trigger_identity,origin_escalation_id,state,revision,current_plan_version,last_progress_at,workflow_version) VALUES (${newRunId},${newGoalId},${`human-resolution:${input.escalationId}:${input.expectedVersion}`},${input.escalationId},'ACTIVE',1,1,${eventTime},${String(row.workflow_version ?? "legacy-v1")})`;
      await transaction`UPDATE candidates SET revision=revision+1,record_json=((record_json::jsonb || jsonb_build_object('status','MATERIALS_READY','escalation',NULL))::text) WHERE id=${Number(row.candidate_id)}`;
      return { sameRun: false, previousRunState: "SUPERSEDED", runId: newRunId, linkedEscalationId: input.escalationId, inputVersion: nextInput, profileVersion: nextProfile };
    });
  }
  private async nextSequence(runId: string, client = this.sql) { const [row] = await client<{ value: number }[]>`SELECT COALESCE(max(sequence),0)::integer+1 AS value FROM agent_events WHERE run_id=${runId}`; return row?.value ?? 1; }
}
