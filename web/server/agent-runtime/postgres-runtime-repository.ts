import { randomUUID } from "node:crypto";
import { registerCanonicalCandidatePipeline } from "../candidate-pipeline/goal.ts";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";
import { createSyntheticRegistries, validatePlan } from "./registry.ts";
import { RuntimeConflictError } from "./runtime.ts";
import type { BudgetKind, BudgetLimits, SideEffectClass } from "./types.ts";
import { CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT, standardEditablePrompt, type EditablePromptSnapshot } from "../product/prompt-contracts.ts";
import { candidateFailureMessage, taskFailurePolicy } from "./failure-policy.ts";
import { COVERAGE_FIRST_WORKFLOW_VERSION, recoveryArtifactPurpose, recoveryArtifactSchema } from "../candidate-pipeline/recovery-contracts.ts";
import { createRabbitTaskEnvelope, routingClassForTool, type RabbitRoutingClass } from "./rabbitmq-contracts.ts";
import { fanoutFingerprint, fanoutGroupId, fanoutRecoveryFingerprint, fanoutShardTaskId, type FanoutDescriptor } from "./fanout.ts";

type Row = Record<string, unknown>;
type TaskRow = { id: string; run_id: string; task_key: string; tool_key: string; state: string; revision: number; attempt_count: number; lease_owner: string | null; lease_token: number; lease_expires_at: number | null; idempotency_identity: string };
type DispatchableTask = { id: string; run_id: string; revision: number; attempt_count: number; tool_key: string; routing_class?: string };

function operationsForTool(toolKey: string) {
  if (toolKey === "candidate.drive-snapshot/v1") return ["execute", "list", "download"];
  if (["candidate.document-extraction/v1", "candidate.document-shard/v1", "candidate.transcription/v1", "candidate.transcript-shard/v1",
    "candidate.transcript-normalize-shard/v1", "candidate.transcript-media-shard/v1"].includes(toolKey)) return ["execute", "download"];
  if (toolKey === "candidate.drive-publication/v1") return ["execute", "ensure-folder", "publish", "cleanup"];
  if (toolKey === "candidate.cleanup-reports/v1") return ["execute", "cleanup"];
  return ["execute"];
}

async function enqueueDispatch(transaction: PostgresClient, task: DispatchableTask, availableAt = 0) {
  const routingClass = routingClassForTool(task.tool_key);
  await transaction`UPDATE agent_tasks SET routing_class=${routingClass},available_at=${availableAt} WHERE id=${task.id}`;
  await transaction`INSERT INTO agent_task_dispatch_outbox
    (id,task_id,run_id,task_version,dispatch_generation,routing_class,state,available_at,created_at)
    VALUES (${`${task.id}:dispatch:${task.revision}`},${task.id},${task.run_id},${task.revision},${task.revision},${routingClass},'PENDING',${availableAt},${new Date().toISOString()})
    ON CONFLICT (task_id,task_version,dispatch_generation) DO NOTHING`;
}

async function promoteEligible(transaction: PostgresClient, runId: string) {
  const rows = await transaction<DispatchableTask[]>`UPDATE agent_tasks task SET state='RUNNABLE',revision=revision+1,available_at=0 WHERE task.run_id=${runId} AND task.state='PENDING'
    AND NOT EXISTS (SELECT 1 FROM agent_task_dependencies dep JOIN agent_tasks required ON required.id=dep.depends_on_task_id WHERE dep.task_id=task.id AND
      CASE WHEN EXISTS (SELECT 1 FROM agent_fanout_groups fanout WHERE fanout.join_task_id=task.id)
        THEN required.state NOT IN ('SUCCEEDED','FAILED','CANCELLED','UNKNOWN_OUTCOME')
        ELSE required.state<>dep.required_outcome END)
    RETURNING task.id,task.run_id,task.revision,task.attempt_count,task.tool_key,task.routing_class`;
  for (const row of rows) await enqueueDispatch(transaction, row);
  return rows;
}

export class PostgresAgentRuntimeRepository {
  private readonly sql: PostgresClient;
  constructor(sql: PostgresClient) { this.sql = sql; }

  async createGoal(input: { goalId: string; runId: string; candidateId: number; goalType: string; workflowVersion?: string; inputVersion: string; profileVersion: string; policyVersion: string; completionCriteriaVersion: string; completionCriteria: string[]; budgets: BudgetLimits; triggerIdentity: string }) {
    const existing = await this.sql<{ id: string }[]>`SELECT id FROM agent_runs WHERE trigger_identity=${input.triggerIdentity}`; if (existing[0]) return { created: false, runId: existing[0].id };
    const reusableGoals = await this.sql<{ id: string }[]>`SELECT id FROM agent_goals
      WHERE candidate_id=${input.candidateId} AND input_version=${input.inputVersion}
        AND profile_version=${input.profileVersion} AND goal_type=${input.goalType}
        AND policy_version=${input.policyVersion}
      LIMIT 1`;
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
        const workflowVersion = input.workflowVersion ?? (input.goalType === "candidate-analysis-matrix/v1" ? COVERAGE_FIRST_WORKFLOW_VERSION : "cleanup-v1");
        const sourceRuns = !goalCreated
          ? await transaction<{ id: string; state: string; input_version: string; profile_version: string; workflow_version: string; policy_version: string }[]>`SELECT source_run.id,source_run.state,source_goal.input_version,source_goal.profile_version,source_run.workflow_version,source_goal.policy_version
              FROM agent_runs source_run JOIN agent_goals source_goal ON source_goal.id=source_run.goal_id
              WHERE source_run.goal_id=${goalId} AND source_run.state IN ('FAILED','SUCCEEDED')
                AND source_goal.input_version=${input.inputVersion} AND source_goal.profile_version=${input.profileVersion}
                AND source_goal.goal_type=${input.goalType} AND source_goal.policy_version=${input.policyVersion}
                AND source_run.workflow_version=${workflowVersion}
              ORDER BY source_run.last_progress_at DESC LIMIT 1 FOR UPDATE`
          : [];
        const sourceRun = sourceRuns[0]?.state === "FAILED"
          && sourceRuns[0].input_version === input.inputVersion
          && sourceRuns[0].profile_version === input.profileVersion
          && sourceRuns[0].policy_version === input.policyVersion
          && sourceRuns[0].workflow_version === workflowVersion ? sourceRuns[0] : undefined;
        const sourceTasks = sourceRun
          ? await transaction<{ id: string; task_key: string; tool_key: string; state: string }[]>`SELECT id,run_id,task_key,tool_key,state FROM agent_tasks WHERE run_id=${sourceRun.id}`
          : [];
        const sourceTaskByKey = new Map(sourceTasks.map((task) => [task.task_key, task]));
        const reusableTasks = new Map<string, typeof sourceTasks[number]>();
        if (sourceRun) for (const plannedTask of plan) {
          const sourceTask = sourceTaskByKey.get(plannedTask.key);
          const expectedSchema = recoveryArtifactSchema(workflowVersion, plannedTask.tool);
          if (!sourceTask || sourceTask.state !== "SUCCEEDED" || !expectedSchema) break;
          const artifacts = await transaction<{ schema_version: string; provenance: string; storage_identity: string }[]>`SELECT artifact.schema_version,memory.provenance,artifact.storage_identity
            FROM agent_memory_entries memory JOIN agent_artifact_refs artifact ON artifact.memory_entry_id=memory.id
            WHERE memory.run_id=${sourceRun.id} AND memory.provenance=${plannedTask.tool}
              AND memory.purpose=${recoveryArtifactPurpose(workflowVersion)} AND artifact.schema_version=${expectedSchema}
            ORDER BY artifact.id DESC LIMIT 1`;
          if (!artifacts[0] || artifacts[0].schema_version !== expectedSchema) break;
          reusableTasks.set(plannedTask.key, sourceTask);
        }
        const recoveryBoundaryKey = sourceRun ? plan[reusableTasks.size]?.key : undefined;
        if (goalCreated) await transaction`INSERT INTO agent_goals (id,candidate_id,goal_type,input_version,profile_version,policy_version,completion_criteria_version,completion_criteria_json,state,revision,created_at) VALUES (${goalId},${input.candidateId},${input.goalType},${input.inputVersion},${input.profileVersion},${input.policyVersion},${input.completionCriteriaVersion},${JSON.stringify(input.completionCriteria)},'ACTIVE',1,${createdAt})`;
        else await transaction`UPDATE agent_goals SET state='ACTIVE',revision=revision+1 WHERE id=${goalId}`;
        await transaction`INSERT INTO agent_runs (id,goal_id,trigger_identity,state,revision,current_plan_version,last_progress_at,analysis_prompt_text,analysis_prompt_artifact_id,analysis_prompt_hash,workflow_version,recovery_source_run_id) VALUES (${input.runId},${goalId},${input.triggerIdentity},'ACTIVE',1,1,${createdAt},${analysisPrompt.text},${analysisPrompt.artifactId},${analysisPrompt.hash},${workflowVersion},${sourceRun?.id ?? null})`;
        await transaction`INSERT INTO agent_plan_versions (id,run_id,version,reason,plan_json,created_at) VALUES (${planId},${input.runId},1,'INITIAL_PLAN',${JSON.stringify(plan)},${createdAt})`;
        for (const task of plan) {
          const id = taskId(task.key); const definition = registries.tools.get(task.tool);
          const reusedFrom = reusableTasks.get(task.key);
          const dependenciesReused = task.dependencies.every((dependency) => reusableTasks.has(dependency));
          const initialState = reusedFrom ? "SUCCEEDED" : sourceRun
            ? task.key === recoveryBoundaryKey ? "RUNNABLE" : "PENDING"
            : task.dependencies.length === 0 || dependenciesReused ? "RUNNABLE" : "PENDING";
          const operations = operationsForTool(task.tool);
          const routingClass = routingClassForTool(task.tool);
          await transaction`INSERT INTO agent_tasks (id,run_id,plan_version_id,task_key,tool_key,state,revision,attempt_count,lease_token,idempotency_identity,preconditions_json,expected_outputs_json,routing_class,available_at,reused_from_task_id) VALUES (${id},${input.runId},${planId},${task.key},${task.tool},${initialState},1,0,0,${`${input.runId}:plan:1:${task.key}`},${JSON.stringify(task.dependencies)},${JSON.stringify(task.expectedOutputs)},${routingClass},0,${reusedFrom?.id ?? null})`;
          for (const dependency of task.dependencies) await transaction`INSERT INTO agent_task_dependencies (task_id,depends_on_task_id,required_outcome) VALUES (${id},${taskId(dependency)},'SUCCEEDED')`;
          await transaction`INSERT INTO agent_tool_grants (id,task_id,candidate_id,run_id,input_version,policy_version,tool_key,operations_json,side_effect_class,budget_link,expires_at) VALUES (${`${id}:grant:execute`},${id},${input.candidateId},${input.runId},${input.inputVersion},${input.policyVersion},${task.tool},${JSON.stringify(operations)},${definition.sideEffectClass},${`${input.runId}:budget:externalRequests`},${grantExpiresAt})`;
          if (initialState === "RUNNABLE") await enqueueDispatch(transaction, { id, run_id: input.runId, revision: 1, attempt_count: 0, tool_key: task.tool, routing_class: routingClass });
        }
        for (const [kind, limit] of Object.entries(input.budgets) as [BudgetKind, number][]) await transaction`INSERT INTO agent_budget_ledger (id,run_id,kind,limit_value,used_value,revision) VALUES (${`${input.runId}:budget:${kind}`},${input.runId},${kind},${limit},0,1)`;
        await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${input.runId},1,${sourceRun ? `run-recovery-created:${input.runId}` : goalCreated ? `goal-created:${goalId}` : `run-created:${input.triggerIdentity}`},${sourceRun ? 'RUN_RECOVERY_CREATED' : goalCreated ? 'GOAL_CREATED' : 'RUN_CREATED'},'runtime',1,${JSON.stringify({ goalType: input.goalType, workflowVersion, inputVersion: input.inputVersion, profileVersion: input.profileVersion, policyVersion: input.policyVersion, goalReused: !goalCreated, recoverySourceRunId: sourceRun?.id, reusedTaskKeys: [...reusableTasks.keys()] })},${createdAt})`;
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
    const rows = await withTransaction(this.sql, (transaction) => promoteEligible(transaction, runId));
    return rows.map((row) => row.id);
  }
  async materializeFanout(input: { coordinatorTaskId: string; joinTaskId: string; descriptor: FanoutDescriptor; shardToolKey: string; expectedOutputs: string[] }) {
    const descriptorFingerprint = fanoutFingerprint(input.descriptor);
    const groupId = fanoutGroupId(input.descriptor);
    return withTransaction(this.sql, async (transaction) => {
      const coordinators = await transaction<(Row & { run_id: string; plan_version_id: string; candidate_id: number; input_version: string; policy_version: string; wall_time_ms: number; goal_id: string; recovery_source_run_id: string | null })[]>`SELECT task.run_id,task.plan_version_id,task.state,task.lease_owner,task.lease_token,
          run.current_plan_version,run.goal_id,run.recovery_source_run_id,goal.candidate_id,goal.input_version,goal.policy_version,
          budget.limit_value AS wall_time_ms
        FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id AND run.state='ACTIVE'
        JOIN agent_goals goal ON goal.id=run.goal_id
        JOIN agent_budget_ledger budget ON budget.run_id=run.id AND budget.kind='wallTimeMs'
        WHERE task.id=${input.coordinatorTaskId} FOR UPDATE`;
      const coordinator = coordinators[0];
      if (!coordinator || coordinator.state !== "RUNNING" || coordinator.run_id !== input.descriptor.runId) throw new RuntimeConflictError("FANOUT_COORDINATOR_NOT_RUNNING");
      if (Number(coordinator.current_plan_version) !== input.descriptor.planVersion) throw new RuntimeConflictError("FANOUT_PLAN_VERSION_STALE");
      const joins = await transaction<{ id: string; run_id: string; plan_version_id: string; state: string }[]>`SELECT id,run_id,plan_version_id,state FROM agent_tasks WHERE id=${input.joinTaskId} FOR UPDATE`;
      const join = joins[0];
      if (!join || join.run_id !== coordinator.run_id || join.plan_version_id !== coordinator.plan_version_id || !["PENDING", "RUNNABLE"].includes(join.state)) throw new RuntimeConflictError("FANOUT_JOIN_SCOPE_INVALID");
      const existing = await transaction<{ id: string; descriptor_fingerprint: string; expected_count: number }[]>`SELECT id,descriptor_fingerprint,expected_count FROM agent_fanout_groups WHERE run_id=${coordinator.run_id} AND plan_version_id=${coordinator.plan_version_id} AND group_key=${input.descriptor.groupKey} FOR UPDATE`;
      if (existing[0]) {
        if (existing[0].id !== groupId || existing[0].descriptor_fingerprint !== descriptorFingerprint || existing[0].expected_count !== input.descriptor.shards.length) throw new RuntimeConflictError("FANOUT_DESCRIPTOR_STALE");
        return { groupId, created: false, shardTaskIds: input.descriptor.shards.map((shard) => fanoutShardTaskId(groupId, shard.identity)) };
      }
      const registries = createSyntheticRegistries(); registerCanonicalCandidatePipeline(registries.tools, registries.goals);
      const createdAt = new Date().toISOString();
      await transaction`INSERT INTO agent_fanout_groups (id,run_id,plan_version_id,group_key,kind,descriptor_json,descriptor_fingerprint,expected_count,join_task_id,state,created_at)
        VALUES (${groupId},${coordinator.run_id},${coordinator.plan_version_id},${input.descriptor.groupKey},${input.descriptor.kind},${JSON.stringify(input.descriptor)},${descriptorFingerprint},${input.descriptor.shards.length},${input.joinTaskId},'PLANNED',${createdAt})`;
      const shardTaskIds: string[] = [];
      const taskIdsByIdentity = new Map(input.descriptor.shards.map((shard) => [shard.identity, fanoutShardTaskId(groupId, shard.identity)]));
      for (const shard of input.descriptor.shards) {
        const shardTaskId = fanoutShardTaskId(groupId, shard.identity); shardTaskIds.push(shardTaskId);
        const shardToolKey = shard.toolKey ?? input.shardToolKey;
        const definition = registries.tools.get(shardToolKey);
        const taskKey = `${input.descriptor.groupKey}:shard:${String(shard.ordinal).padStart(4, "0")}`;
        const route = routingClassForTool(shardToolKey);
        if (route === "control") throw new RuntimeConflictError("FANOUT_SHARD_ROUTE_INVALID");
        const [reuseCandidate] = coordinator.recovery_source_run_id ? await transaction<{ id: string; output_artifact_id: string; descriptor_json: string; schema_version: string; checksum: string }[]>`SELECT task.id,task.output_artifact_id,fanout.descriptor_json,ref.schema_version,ref.checksum
          FROM agent_tasks task
          JOIN agent_fanout_groups fanout ON fanout.id=task.fanout_group_id
          JOIN agent_memory_entries memory ON memory.run_id=task.run_id AND memory.provenance=task.tool_key
            AND memory.input_version=${input.descriptor.inputFingerprint} AND memory.profile_version=${input.descriptor.profileFingerprint}
          JOIN agent_artifact_refs ref ON ref.memory_entry_id=memory.id AND ref.storage_identity=task.output_artifact_id
          WHERE task.run_id=${coordinator.recovery_source_run_id} AND task.tool_key=${shardToolKey} AND task.shard_identity=${shard.identity}
            AND task.state='SUCCEEDED' AND task.output_artifact_id IS NOT NULL AND ref.checksum<>''
          ORDER BY memory.id LIMIT 1` : [];
        const expectedRecoverySchema = recoveryArtifactSchema(input.descriptor.workflowVersion, shardToolKey);
        const reusable = reuseCandidate
          && expectedRecoverySchema === reuseCandidate.schema_version
          && fanoutRecoveryFingerprint(JSON.parse(reuseCandidate.descriptor_json) as FanoutDescriptor) === fanoutRecoveryFingerprint(input.descriptor)
          ? reuseCandidate : undefined;
        const shardState = reusable ? "SUCCEEDED" : "PENDING";
        await transaction`INSERT INTO agent_tasks (id,run_id,plan_version_id,task_key,tool_key,state,revision,attempt_count,lease_token,idempotency_identity,preconditions_json,expected_outputs_json,routing_class,available_at,fanout_group_id,shard_identity,shard_payload_json)
          VALUES (${shardTaskId},${coordinator.run_id},${coordinator.plan_version_id},${taskKey},${shardToolKey},${shardState},1,0,0,${`${coordinator.run_id}:${groupId}:${shard.identity}`},${JSON.stringify([input.coordinatorTaskId, ...(shard.dependsOn ?? []).map((identity) => taskIdsByIdentity.get(identity))])},${JSON.stringify(input.expectedOutputs)},${route},0,${groupId},${shard.identity},${JSON.stringify(shard.payload ?? {})})
          ON CONFLICT (id) DO NOTHING`;
        if (reusable) {
          await transaction`UPDATE agent_tasks SET reused_from_task_id=${reusable.id},output_artifact_id=${reusable.output_artifact_id} WHERE id=${shardTaskId}`;
          const memoryId = `${shardTaskId}:reused-artifact`; const refId = `${memoryId}:ref`;
          await transaction`INSERT INTO agent_memory_entries (id,goal_id,run_id,candidate_id,input_version,profile_version,kind,provenance,sensitivity,purpose,payload_json,immutable)
            SELECT ${memoryId},${String(coordinator.goal_id)},${coordinator.run_id},candidate_id,input_version,profile_version,kind,provenance,sensitivity,${recoveryArtifactPurpose(input.descriptor.workflowVersion)},payload_json,true
            FROM agent_memory_entries memory JOIN agent_artifact_refs ref ON ref.memory_entry_id=memory.id
            WHERE memory.run_id=${coordinator.recovery_source_run_id} AND memory.provenance=${shardToolKey} AND ref.storage_identity=${reusable.output_artifact_id} LIMIT 1 ON CONFLICT DO NOTHING`;
          await transaction`INSERT INTO agent_artifact_refs (id,memory_entry_id,storage_class,storage_identity,checksum,schema_version)
            SELECT ${refId},${memoryId},ref.storage_class,ref.storage_identity,ref.checksum,ref.schema_version FROM agent_artifact_refs ref
            WHERE ref.storage_identity=${reusable.output_artifact_id}
              AND EXISTS (SELECT 1 FROM agent_memory_entries memory WHERE memory.id=${memoryId})
            LIMIT 1 ON CONFLICT DO NOTHING`;
        }
        await transaction`INSERT INTO agent_task_dependencies (task_id,depends_on_task_id,required_outcome) VALUES (${shardTaskId},${input.coordinatorTaskId},'SUCCEEDED') ON CONFLICT DO NOTHING`;
        await transaction`INSERT INTO agent_task_dependencies (task_id,depends_on_task_id,required_outcome) VALUES (${input.joinTaskId},${shardTaskId},'SUCCEEDED') ON CONFLICT DO NOTHING`;
        await transaction`INSERT INTO agent_fanout_members (group_id,shard_task_id,shard_identity,ordinal,required) VALUES (${groupId},${shardTaskId},${shard.identity},${shard.ordinal},${shard.required !== false}) ON CONFLICT DO NOTHING`;
        await transaction`INSERT INTO agent_tool_grants (id,task_id,candidate_id,run_id,input_version,policy_version,tool_key,operations_json,side_effect_class,budget_link,expires_at)
          VALUES (${`${shardTaskId}:grant:execute`},${shardTaskId},${Number(coordinator.candidate_id)},${coordinator.run_id},${String(coordinator.input_version)},${String(coordinator.policy_version)},${shardToolKey},${JSON.stringify(operationsForTool(shardToolKey))},${definition.sideEffectClass},${`${coordinator.run_id}:budget:externalRequests`},${Date.now() + Number(coordinator.wall_time_ms)}) ON CONFLICT DO NOTHING`;
      }
      for (const shard of input.descriptor.shards) for (const dependencyIdentity of shard.dependsOn ?? []) {
        const shardTaskId = taskIdsByIdentity.get(shard.identity);
        const dependencyTaskId = taskIdsByIdentity.get(dependencyIdentity);
        if (!shardTaskId || !dependencyTaskId) throw new RuntimeConflictError("FANOUT_SHARD_DEPENDENCY_UNKNOWN");
        await transaction`INSERT INTO agent_task_dependencies (task_id,depends_on_task_id,required_outcome) VALUES (${shardTaskId},${dependencyTaskId},'SUCCEEDED') ON CONFLICT DO NOTHING`;
      }
      return { groupId, created: true, shardTaskIds };
    });
  }
  async readFanout(input: { joinTaskId: string; groupKey: string }) {
    const groups = await this.sql<{ id: string; descriptor_json: string; expected_count: number }[]>`SELECT group_record.id,group_record.descriptor_json,group_record.expected_count
      FROM agent_fanout_groups group_record JOIN agent_tasks join_task ON join_task.id=group_record.join_task_id
      WHERE group_record.join_task_id=${input.joinTaskId} AND group_record.group_key=${input.groupKey} AND join_task.run_id=group_record.run_id`;
    const group = groups[0]; if (!group) throw new RuntimeConflictError("FANOUT_GROUP_NOT_FOUND");
    const members = await this.sql<{ shard_identity: string; ordinal: number; required: boolean; task_id: string; state: string; tool_key: string; output_artifact_id: string | null; shard_payload_json: string; schema_version: string | null; checksum: string | null }[]>`SELECT member.shard_identity,member.ordinal,member.required,task.id AS task_id,task.state,task.tool_key,task.output_artifact_id,task.shard_payload_json,
        (SELECT ref.schema_version FROM agent_memory_entries memory JOIN agent_artifact_refs ref ON ref.memory_entry_id=memory.id
          WHERE memory.run_id=task.run_id AND memory.provenance=task.tool_key AND ref.storage_identity=task.output_artifact_id LIMIT 1) AS schema_version,
        (SELECT ref.checksum FROM agent_memory_entries memory JOIN agent_artifact_refs ref ON ref.memory_entry_id=memory.id
          WHERE memory.run_id=task.run_id AND memory.provenance=task.tool_key AND ref.storage_identity=task.output_artifact_id LIMIT 1) AS checksum
      FROM agent_fanout_members member JOIN agent_tasks task ON task.id=member.shard_task_id WHERE member.group_id=${group.id} ORDER BY member.ordinal`;
    if (members.length !== group.expected_count) throw new RuntimeConflictError("FANOUT_MEMBERSHIP_INCOMPLETE");
    const failed = members.find((member) => member.required && ["FAILED", "CANCELLED", "UNKNOWN_OUTCOME"].includes(member.state));
    if (failed) throw new RuntimeConflictError(`FANOUT_REQUIRED_SHARD_FAILED:${failed.shard_identity}`);
    const pending = members.find((member) => member.required && member.state !== "SUCCEEDED");
    if (pending) throw new RuntimeConflictError(`FANOUT_REQUIRED_SHARD_NOT_TERMINAL:${pending.shard_identity}`);
    const descriptor = JSON.parse(group.descriptor_json) as FanoutDescriptor;
    for (const member of members.filter((item) => item.state === "SUCCEEDED")) {
      const expectedSchema = recoveryArtifactSchema(descriptor.workflowVersion, member.tool_key);
      if (!member.output_artifact_id || !member.checksum || !expectedSchema || member.schema_version !== expectedSchema) {
        throw new RuntimeConflictError(`FANOUT_SHARD_ARTIFACT_INVALID:${member.shard_identity}`);
      }
    }
    return { groupId: group.id, descriptor, members: members.map((member) => ({ ...member, payload: JSON.parse(member.shard_payload_json) as Record<string, unknown> })) };
  }
  async completeFanout(groupId: string) {
    const rows = await this.sql`UPDATE agent_fanout_groups SET state='SUCCEEDED',completed_at=${new Date().toISOString()} WHERE id=${groupId}
      AND NOT EXISTS (SELECT 1 FROM agent_fanout_members member JOIN agent_tasks task ON task.id=member.shard_task_id WHERE member.group_id=${groupId} AND member.required AND task.state<>'SUCCEEDED') RETURNING id`;
    if (!rows.length) throw new RuntimeConflictError("FANOUT_NOT_COMPLETE");
  }
  async claim(input: { worker: string; now: number; leaseMs: number }) {
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<(TaskRow & Row)[]>`SELECT t.*,g.candidate_id,g.input_version,g.profile_version,g.policy_version FROM agent_tasks t JOIN agent_runs r ON r.id=t.run_id JOIN agent_goals g ON g.id=r.goal_id
        WHERE t.state='RUNNABLE' AND r.state='ACTIVE' AND t.available_at<=${input.now} AND COALESCE(t.lease_expires_at,0)<=${input.now}
          AND NOT EXISTS (SELECT 1 FROM agent_task_dependencies dep JOIN agent_tasks required ON required.id=dep.depends_on_task_id WHERE dep.task_id=t.id AND
            CASE WHEN EXISTS (SELECT 1 FROM agent_fanout_groups fanout WHERE fanout.join_task_id=t.id)
              THEN required.state NOT IN ('SUCCEEDED','FAILED','CANCELLED','UNKNOWN_OUTCOME')
              ELSE required.state<>dep.required_outcome END)
          AND EXISTS (SELECT 1 FROM agent_budget_ledger b WHERE b.run_id=t.run_id AND b.kind='taskAttempts' AND b.used_value<b.limit_value) ORDER BY t.id FOR UPDATE SKIP LOCKED LIMIT 1`;
      const candidate = rows[0]; if (!candidate) return null;
      const nextToken = candidate.lease_token + 1; const nextAttempt = candidate.attempt_count + 1; const attemptId = randomUUID();
      await transaction`UPDATE agent_tasks SET state='RUNNING',revision=revision+1,attempt_count=${nextAttempt},lease_owner=${input.worker},lease_token=${nextToken},lease_expires_at=${input.now + input.leaseMs} WHERE id=${candidate.id}`;
      const budget = await transaction`UPDATE agent_budget_ledger SET used_value=used_value+1,revision=revision+1 WHERE run_id=${candidate.run_id} AND kind='taskAttempts' AND used_value<limit_value RETURNING id`; if (!budget.length) throw new RuntimeConflictError("BUDGET_EXHAUSTED:taskAttempts");
      await transaction`INSERT INTO agent_attempts (id,task_id,attempt_number,lease_owner,lease_token,state,started_at) VALUES (${attemptId},${candidate.id},${nextAttempt},${input.worker},${nextToken},'RUNNING',${new Date(input.now).toISOString()})`;
      return { ...candidate, state: "RUNNING", revision: candidate.revision + 1, attempt_count: nextAttempt, lease_owner: input.worker, lease_token: nextToken, lease_expires_at: input.now + input.leaseMs, attemptId };
    });
  }
  async claimById(input: { taskId: string; taskVersion: number; routingClass: RabbitRoutingClass; worker: string; now: number; leaseMs: number; maxPerRun?: number; maxActivePool?: number }) {
    return withTransaction(this.sql, async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`rabbit-claim-pool:${input.routingClass}`}))`;
      const rows = await transaction<(TaskRow & Row & { routing_class: string })[]>`SELECT t.*,g.candidate_id,g.input_version,g.profile_version,g.policy_version FROM agent_tasks t JOIN agent_runs r ON r.id=t.run_id JOIN agent_goals g ON g.id=r.goal_id
        WHERE t.id=${input.taskId} AND t.revision=${input.taskVersion} AND t.routing_class=${input.routingClass}
          AND t.state='RUNNABLE' AND r.state='ACTIVE' AND t.available_at<=${input.now} AND COALESCE(t.lease_expires_at,0)<=${input.now}
          AND NOT EXISTS (SELECT 1 FROM agent_task_dependencies dep JOIN agent_tasks required ON required.id=dep.depends_on_task_id WHERE dep.task_id=t.id AND
            CASE WHEN EXISTS (SELECT 1 FROM agent_fanout_groups fanout WHERE fanout.join_task_id=t.id)
              THEN required.state NOT IN ('SUCCEEDED','FAILED','CANCELLED','UNKNOWN_OUTCOME')
              ELSE required.state<>dep.required_outcome END)
          AND (SELECT count(*) FROM agent_tasks active WHERE active.run_id=t.run_id AND active.routing_class=t.routing_class AND active.state='RUNNING')<${input.maxPerRun ?? 2}
          AND (SELECT count(*) FROM agent_tasks active WHERE active.routing_class=t.routing_class AND active.state='RUNNING')<${input.maxActivePool ?? 1000}
          AND EXISTS (SELECT 1 FROM agent_budget_ledger b WHERE b.run_id=t.run_id AND b.kind='taskAttempts' AND b.used_value<b.limit_value)
        FOR UPDATE SKIP LOCKED`;
      const candidate = rows[0];
      if (!candidate) {
        const [deferred] = await transaction<{ state: string; revision: number; routing_class: string; available_at: number; active_count: number; pool_active_count: number; dependency_blocked: boolean }[]>`SELECT task.state,task.revision,task.routing_class,task.available_at,
          (SELECT count(*)::integer FROM agent_tasks active WHERE active.run_id=task.run_id AND active.routing_class=task.routing_class AND active.state='RUNNING') AS active_count
          ,(SELECT count(*)::integer FROM agent_tasks active WHERE active.routing_class=task.routing_class AND active.state='RUNNING') AS pool_active_count
          ,EXISTS (SELECT 1 FROM agent_task_dependencies dep JOIN agent_tasks required ON required.id=dep.depends_on_task_id WHERE dep.task_id=task.id AND
            CASE WHEN EXISTS (SELECT 1 FROM agent_fanout_groups fanout WHERE fanout.join_task_id=task.id)
              THEN required.state NOT IN ('SUCCEEDED','FAILED','CANCELLED','UNKNOWN_OUTCOME') ELSE required.state<>dep.required_outcome END) AS dependency_blocked
          FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id WHERE task.id=${input.taskId} AND run.state='ACTIVE'`;
        if (deferred?.state === "RUNNABLE" && deferred.revision === input.taskVersion && deferred.routing_class === input.routingClass && deferred.active_count >= (input.maxPerRun ?? 2)) throw new RuntimeConflictError("RABBIT_RUN_CONCURRENCY_LIMIT");
        if (deferred?.state === "RUNNABLE" && deferred.revision === input.taskVersion && deferred.routing_class === input.routingClass && deferred.pool_active_count >= (input.maxActivePool ?? 1000)) throw new RuntimeConflictError("RABBIT_POOL_CONCURRENCY_LIMIT");
        if (deferred?.state === "RUNNABLE" && deferred.revision === input.taskVersion && deferred.routing_class === input.routingClass && deferred.dependency_blocked) throw new RuntimeConflictError("RABBIT_DEPENDENCY_NOT_READY");
        if (deferred?.state === "RUNNABLE" && deferred.revision === input.taskVersion && deferred.routing_class === input.routingClass && deferred.available_at > input.now) throw new RuntimeConflictError("RABBIT_TASK_NOT_YET_AVAILABLE");
        return null;
      }
      if (routingClassForTool(candidate.tool_key) !== input.routingClass) throw new RuntimeConflictError("RABBIT_TASK_ROUTE_MISMATCH");
      const nextToken = candidate.lease_token + 1;
      const nextAttempt = candidate.attempt_count + 1;
      const attemptId = randomUUID();
      const updated = await transaction`UPDATE agent_tasks SET state='RUNNING',revision=revision+1,attempt_count=${nextAttempt},lease_owner=${input.worker},lease_token=${nextToken},lease_expires_at=${input.now + input.leaseMs} WHERE id=${candidate.id} AND state='RUNNABLE' AND revision=${input.taskVersion} RETURNING id`;
      if (!updated.length) return null;
      const budget = await transaction`UPDATE agent_budget_ledger SET used_value=used_value+1,revision=revision+1 WHERE run_id=${candidate.run_id} AND kind='taskAttempts' AND used_value<limit_value RETURNING id`;
      if (!budget.length) throw new RuntimeConflictError("BUDGET_EXHAUSTED:taskAttempts");
      await transaction`INSERT INTO agent_attempts (id,task_id,attempt_number,lease_owner,lease_token,state,started_at) VALUES (${attemptId},${candidate.id},${nextAttempt},${input.worker},${nextToken},'RUNNING',${new Date(input.now).toISOString()})`;
      if (candidate.fanout_group_id) await transaction`UPDATE agent_fanout_groups SET state='RUNNING' WHERE id=${String(candidate.fanout_group_id)} AND state='PLANNED'`;
      const sequence = await this.nextSequence(String(candidate.run_id), transaction);
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at)
        VALUES (${randomUUID()},${String(candidate.run_id)},${sequence},${`rabbit-task-started:${attemptId}`},'RABBIT_TASK_STARTED','runtime',
          (SELECT current_plan_version FROM agent_runs WHERE id=${String(candidate.run_id)}),${candidate.id},
          ${JSON.stringify({ workerId: input.worker, routingClass: input.routingClass, fanoutGroupId: candidate.fanout_group_id ?? null, shardIdentity: candidate.shard_identity ?? null })},${new Date(input.now).toISOString()})`;
      return { ...candidate, state: "RUNNING", revision: input.taskVersion + 1, attempt_count: nextAttempt, lease_owner: input.worker, lease_token: nextToken, lease_expires_at: input.now + input.leaseMs, attemptId };
    });
  }
  async heartbeat(input: { taskId: string; worker: string; leaseToken: number; now: number; leaseMs: number }) { const rows = await this.sql`UPDATE agent_tasks SET lease_expires_at=${input.now + input.leaseMs},revision=revision+1 WHERE id=${input.taskId} AND state='RUNNING' AND lease_owner=${input.worker} AND lease_token=${input.leaseToken} RETURNING id`; if (!rows.length) throw new RuntimeConflictError("STALE_LEASE_TOKEN"); }
  async checkpoint(input: { attemptId: string; taskId: string; worker: string; leaseToken: number; kind: string; identity: string; remoteJobId?: string; artifactIdentity?: string; checksum?: string }) {
    const task = await this.sql`SELECT id FROM agent_tasks WHERE id=${input.taskId} AND state='RUNNING' AND lease_owner=${input.worker} AND lease_token=${input.leaseToken}`; if (!task.length) throw new RuntimeConflictError("STALE_LEASE_TOKEN");
    await this.sql`INSERT INTO agent_checkpoints (id,attempt_id,lease_token,kind,identity,remote_job_id,artifact_identity,checksum,created_at) VALUES (${randomUUID()},${input.attemptId},${input.leaseToken},${input.kind},${input.identity},${input.remoteJobId ?? null},${input.artifactIdentity ?? null},${input.checksum ?? null},${new Date().toISOString()}) ON CONFLICT (attempt_id,kind,identity) DO NOTHING`;
    if (input.artifactIdentity) await this.sql`UPDATE agent_tasks SET output_artifact_id=${input.artifactIdentity} WHERE id=${input.taskId} AND state='RUNNING' AND lease_owner=${input.worker} AND lease_token=${input.leaseToken}`;
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
      const resumedTasks = await transaction<(DispatchableTask & { state: string })[]>`UPDATE agent_tasks SET state=CASE WHEN EXISTS (SELECT 1 FROM agent_outbox outbox WHERE outbox.run_id=agent_tasks.run_id AND outbox.operation_identity=agent_tasks.idempotency_identity AND outbox.state='UNKNOWN_OUTCOME') THEN 'UNKNOWN_OUTCOME' ELSE 'RUNNABLE' END,revision=revision+1 WHERE run_id=${String(row.run_id)} AND state='WAITING' RETURNING id,run_id,revision,attempt_count,tool_key,routing_class,state`;
      for (const resumedTask of resumedTasks) if (resumedTask.state === "RUNNABLE") await enqueueDispatch(transaction, resumedTask);
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${String(row.run_id)},${sequence},${`google-drive-reconnected:${String(row.escalation_id)}:${Number(row.version)}`},'GOOGLE_DRIVE_OAUTH_RECONNECTED','oauth',${Number(row.current_plan_version)},${JSON.stringify({ connectionId: input.connectionId, ownerSubjectVerified: Boolean(input.ownerSubject) })},${now})`;
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,safe_payload_json,created_at) VALUES (${randomUUID()},${String(row.run_id)},${sequence + 1},${`drive-resume:${String(row.escalation_id)}:${Number(row.version)}`},'DRIVE_RESUME_PUBLISHED','runtime',${Number(row.current_plan_version)},${JSON.stringify({ escalationId: row.escalation_id })},${now})`;
      await transaction`UPDATE candidates SET revision=revision+1,record_json=((record_json::jsonb || jsonb_build_object('status','ANALYZING','escalation',NULL))::text) WHERE id=${Number(row.candidate_id)}`; resumedRunIds.push(String(row.run_id));
    });
    return { resumedRunIds };
  }
  async defer(input: { taskId: string; attemptId: string; worker: string; leaseToken: number; now: number; retryAfterMs: number; reason: string }) {
    if (!Number.isInteger(input.retryAfterMs) || input.retryAfterMs < 1_000 || input.retryAfterMs > 300_000) throw new RuntimeConflictError("TASK_DEFER_DELAY_INVALID");
    const reason = /^[A-Z0-9_:.-]{1,160}$/.test(input.reason) ? input.reason : "PROVIDER_RESULT_PENDING";
    await withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<{ run_id: string; revision: number; attempt_count: number; tool_key: string; current_plan_version: number }[]>`UPDATE agent_tasks task SET state='RUNNABLE',revision=task.revision+1,lease_owner=NULL,lease_expires_at=NULL,available_at=${input.now + input.retryAfterMs}
        FROM agent_runs run WHERE task.id=${input.taskId} AND task.run_id=run.id AND task.state='RUNNING' AND task.lease_owner=${input.worker} AND task.lease_token=${input.leaseToken}
        RETURNING task.run_id,task.revision,task.attempt_count,task.tool_key,run.current_plan_version`;
      const task = rows[0]; if (!task) throw new RuntimeConflictError("STALE_LEASE_TOKEN");
      const attempts = await transaction`UPDATE agent_attempts SET state='DEFERRED',finished_at=${new Date(input.now).toISOString()},error_code=${reason} WHERE id=${input.attemptId} AND task_id=${input.taskId} AND state='RUNNING' AND lease_owner=${input.worker} AND lease_token=${input.leaseToken} RETURNING id`;
      if (!attempts.length) throw new RuntimeConflictError("STALE_LEASE_TOKEN");
      await transaction`UPDATE agent_budget_ledger SET used_value=GREATEST(0,used_value-1),revision=revision+1 WHERE run_id=${task.run_id} AND kind='taskAttempts'`;
      await enqueueDispatch(transaction, { id: input.taskId, run_id: task.run_id, revision: task.revision, attempt_count: task.attempt_count, tool_key: task.tool_key }, input.now + input.retryAfterMs);
      const sequence = await this.nextSequence(task.run_id, transaction);
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at)
        VALUES (${randomUUID()},${task.run_id},${sequence},${`task-deferred:${input.attemptId}`},'TASK_DEFERRED','runtime',${task.current_plan_version},${input.taskId},${JSON.stringify({ reason, retryAfterMs: input.retryAfterMs })},${new Date(input.now).toISOString()})`;
    });
  }
  async outcome(input: { taskId: string; attemptId: string; worker: string; leaseToken: number; outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN_OUTCOME"; errorCode?: string }) {
    await withTransaction(this.sql, async (transaction) => {
      const task = await transaction<{ idempotency_identity: string; run_id: string; task_key: string; tool_key: string; attempt_count: number; failure_count: number; current_plan_version: number; goal_id: string; candidate_id: number; fanout_group_id: string | null; shard_identity: string | null; routing_class: string }[]>`SELECT task.idempotency_identity,task.run_id,task.task_key,task.tool_key,task.attempt_count,task.fanout_group_id,task.shard_identity,task.routing_class,run.current_plan_version,run.goal_id,goal.candidate_id,
          ((SELECT count(*) FROM agent_attempts prior WHERE prior.task_id=task.id AND prior.state='FAILED')+1)::integer AS failure_count
        FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id JOIN agent_goals goal ON goal.id=run.goal_id
        WHERE task.id=${input.taskId} FOR UPDATE`; if (!task[0]) throw new RuntimeConflictError("TASK_NOT_FOUND");
      const current = task[0];
      const finishedAt = new Date().toISOString();
      const policy = input.outcome === "FAILED" ? taskFailurePolicy(current.tool_key, input.errorCode ?? "TASK_FAILED", current.failure_count) : undefined;
      const nextTaskState = policy?.retry ? "RUNNABLE" : input.outcome;
      const retryAt = policy?.retry ? Date.now() + policy.delayMs : null;
      const tasks = await transaction<{ id: string; revision: number }[]>`UPDATE agent_tasks SET state=${nextTaskState},revision=revision+1,lease_owner=NULL,lease_expires_at=NULL,available_at=${retryAt ?? 0} WHERE id=${input.taskId} AND state='RUNNING' AND lease_owner=${input.worker} AND lease_token=${input.leaseToken} RETURNING id,revision`;
      const attempts = await transaction`UPDATE agent_attempts SET state=${input.outcome},unknown_outcome=${input.outcome === "UNKNOWN_OUTCOME"},finished_at=${finishedAt},error_code=${input.errorCode ?? null} WHERE id=${input.attemptId} AND lease_owner=${input.worker} AND lease_token=${input.leaseToken} AND state='RUNNING' RETURNING id`;
      if (!tasks.length || !attempts.length) throw new RuntimeConflictError("STALE_LEASE_TOKEN");
      const finishSequence = await this.nextSequence(current.run_id, transaction);
      await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at)
        VALUES (${randomUUID()},${current.run_id},${finishSequence},${`rabbit-task-finished:${input.attemptId}`},'RABBIT_TASK_FINISHED','runtime',${current.current_plan_version},${input.taskId},
          ${JSON.stringify({ workerId: input.worker, routingClass: current.routing_class, fanoutGroupId: current.fanout_group_id, shardIdentity: current.shard_identity, outcome: input.outcome, errorCode: input.errorCode ?? null })},${finishedAt})`;
      const outboxState = input.outcome === "SUCCEEDED" ? "SENT" : input.outcome === "UNKNOWN_OUTCOME" ? "UNKNOWN_OUTCOME" : "FAILED";
      await transaction`UPDATE agent_outbox SET state=${outboxState},unknown_outcome=${input.outcome === "UNKNOWN_OUTCOME"},attempts=attempts+1 WHERE operation_identity=${current.idempotency_identity}`;
      if (input.outcome === "FAILED") {
        const sequence = await this.nextSequence(current.run_id, transaction);
        if (policy?.retry) {
          await enqueueDispatch(transaction, { id: input.taskId, run_id: current.run_id, revision: tasks[0].revision, attempt_count: current.attempt_count, tool_key: current.tool_key }, retryAt ?? 0);
          await transaction`UPDATE agent_runs SET revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE'`;
          await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at)
            VALUES (${randomUUID()},${current.run_id},${sequence},${`task-retry:${input.attemptId}`},'TASK_RETRY_SCHEDULED','runtime',${current.current_plan_version},${input.taskId},${JSON.stringify({ taskKey: current.task_key, errorCode: input.errorCode, attempt: current.failure_count, deliveryAttempt: current.attempt_count, maxAttempts: policy.maxAttempts, delayMs: policy.delayMs })},${finishedAt})`;
          return;
        }
        if (current.fanout_group_id) {
          await transaction`UPDATE agent_fanout_groups SET state='FAILED' WHERE id=${current.fanout_group_id} AND state IN ('PLANNED','RUNNING')`;
          await transaction`UPDATE agent_runs SET revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE'`;
          await promoteEligible(transaction, current.run_id);
          return;
        }
        const safeCode = input.errorCode ?? "TASK_FAILED";
        const safeMessage = candidateFailureMessage(safeCode);
        await transaction`UPDATE agent_runs SET state='FAILED',revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE'`;
        await transaction`UPDATE agent_goals SET state='FAILED',revision=revision+1 WHERE id=${current.goal_id} AND state='ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM agent_runs other WHERE other.goal_id=${current.goal_id} AND other.id<>${current.run_id} AND other.state='ACTIVE')`;
        await transaction`UPDATE candidates SET revision=revision+1,record_json=(record_json::jsonb || ${JSON.stringify({
          status: "FAILED", failedStage: current.task_key, failureReason: safeMessage,
          attempts: current.failure_count, automaticRetriesExhausted: true,
        })}::jsonb)::text WHERE id=${current.candidate_id}`;
        await transaction`INSERT INTO agent_events (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at)
          VALUES (${randomUUID()},${current.run_id},${sequence},${`run-failed:${current.run_id}`},'RUN_FAILED','runtime',${current.current_plan_version},${input.taskId},${JSON.stringify({ taskKey: current.task_key, errorCode: safeCode, attempts: current.failure_count, deliveryAttempts: current.attempt_count })},${finishedAt}) ON CONFLICT (event_identity) DO NOTHING`;
        return;
      }
      if (input.outcome === "UNKNOWN_OUTCOME" && current.fanout_group_id) {
        await transaction`UPDATE agent_fanout_groups SET state='FAILED' WHERE id=${current.fanout_group_id} AND state IN ('PLANNED','RUNNING')`;
        await transaction`UPDATE agent_runs SET revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE'`;
        await promoteEligible(transaction, current.run_id);
        return;
      }
      if (input.outcome === "SUCCEEDED") {
        await transaction`UPDATE agent_runs SET revision=revision+1,last_progress_at=${finishedAt} WHERE id=${current.run_id} AND state='ACTIVE'`;
        await promoteEligible(transaction, current.run_id);
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
        const updated = await transaction<{ revision: number; attempt_count: number; tool_key: string }[]>`UPDATE agent_tasks SET state=${nextState},revision=revision+1,lease_owner=NULL,lease_expires_at=NULL,available_at=0 WHERE id=${task.id} RETURNING revision,attempt_count,tool_key`;
        if (nextState === "RUNNABLE" && updated[0]) await enqueueDispatch(transaction, { id: task.id, run_id: task.run_id, revision: updated[0].revision, attempt_count: updated[0].attempt_count, tool_key: updated[0].tool_key });
        await transaction`UPDATE agent_runs SET last_progress_at=${recoveredAt},revision=revision+1 WHERE id=${task.run_id} AND state='ACTIVE'`;
      }
      return stale.map((task) => task.id);
    });
  }
  async claimDispatchBatch(input: { publisherId: string; now: number; leaseMs: number; limit: number }) {
    if (!input.publisherId.trim() || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new RuntimeConflictError("DISPATCH_CLAIM_INVALID");
    return withTransaction(this.sql, async (transaction) => {
      await transaction`UPDATE agent_task_dispatch_outbox SET state='PENDING',publish_owner=NULL,publish_lease_until=NULL,last_error_code='PUBLISH_LEASE_EXPIRED'
        WHERE state='PUBLISHING' AND publish_lease_until<=${input.now}`;
      const rows = await transaction<{ id: string; task_id: string; run_id: string; task_version: number; routing_class: RabbitRoutingClass; publish_attempts: number; created_at: string }[]>`
        WITH candidates AS (
          SELECT dispatch.id FROM agent_task_dispatch_outbox dispatch
          JOIN agent_tasks task ON task.id=dispatch.task_id
          JOIN agent_runs run ON run.id=dispatch.run_id
          WHERE dispatch.state='PENDING' AND dispatch.available_at<=${input.now}
            AND task.state='RUNNABLE' AND task.revision=dispatch.task_version AND run.state='ACTIVE'
          ORDER BY dispatch.available_at,dispatch.created_at,dispatch.id
          FOR UPDATE OF dispatch SKIP LOCKED LIMIT ${input.limit}
        )
        UPDATE agent_task_dispatch_outbox dispatch SET state='PUBLISHING',publish_owner=${input.publisherId},publish_lease_until=${input.now + input.leaseMs},publish_attempts=publish_attempts+1
        FROM candidates WHERE dispatch.id=candidates.id
        RETURNING dispatch.id,dispatch.task_id,dispatch.run_id,dispatch.task_version,dispatch.routing_class,dispatch.publish_attempts,dispatch.created_at`;
      return rows.map((row) => ({
        dispatchId: row.id,
        envelope: createRabbitTaskEnvelope({ taskId: row.task_id, runId: row.run_id, taskVersion: row.task_version, routingClass: row.routing_class, attemptHint: row.publish_attempts - 1, createdAt: row.created_at }),
      }));
    });
  }
  async confirmDispatch(input: { dispatchId: string; publisherId: string; brokerMessageId: string; now: number }) {
    const timestamp = new Date(input.now).toISOString();
    const rows = await this.sql`UPDATE agent_task_dispatch_outbox SET state='PUBLISHED',broker_message_id=${input.brokerMessageId},published_at=${timestamp},confirmed_at=${timestamp},publish_owner=NULL,publish_lease_until=NULL,last_error_code=NULL
      WHERE id=${input.dispatchId} AND state='PUBLISHING' AND publish_owner=${input.publisherId} RETURNING id`;
    if (!rows.length) throw new RuntimeConflictError("DISPATCH_PUBLISH_LEASE_LOST");
  }
  async failDispatch(input: { dispatchId: string; publisherId: string; now: number; retryAt: number; errorCode: string }) {
    const safeCode = /^[A-Z0-9_:.-]{1,160}$/.test(input.errorCode) ? input.errorCode : "RABBIT_PUBLISH_FAILED";
    const rows = await this.sql`UPDATE agent_task_dispatch_outbox SET state='PENDING',available_at=${input.retryAt},publish_owner=NULL,publish_lease_until=NULL,last_error_code=${safeCode}
      WHERE id=${input.dispatchId} AND state='PUBLISHING' AND publish_owner=${input.publisherId} RETURNING id`;
    if (!rows.length) throw new RuntimeConflictError("DISPATCH_PUBLISH_LEASE_LOST");
  }
  async deferPublishedDispatch(input: { taskId: string; taskVersion: number; retryAt: number; reason: string }) {
    const reason = /^[A-Z0-9_:.-]{1,160}$/.test(input.reason) ? input.reason : "DELIVERY_DEFERRED";
    const rows = await this.sql`UPDATE agent_task_dispatch_outbox dispatch SET state='PENDING',available_at=${input.retryAt},publish_owner=NULL,publish_lease_until=NULL,last_error_code=${reason}
      WHERE dispatch.task_id=${input.taskId} AND dispatch.task_version=${input.taskVersion} AND dispatch.state='PUBLISHED'
        AND EXISTS (SELECT 1 FROM agent_tasks task WHERE task.id=dispatch.task_id AND task.state='RUNNABLE' AND task.revision=dispatch.task_version)
      RETURNING id`;
    return rows.length > 0;
  }
  async reconcileDispatch(now = Date.now(), republishAfterMs?: number) {
    return withTransaction(this.sql, async (transaction) => {
      await transaction`UPDATE agent_task_dispatch_outbox SET state='PENDING',publish_owner=NULL,publish_lease_until=NULL,last_error_code='PUBLISH_LEASE_EXPIRED'
        WHERE state='PUBLISHING' AND publish_lease_until<=${now}`;
      const republished = republishAfterMs && republishAfterMs > 0
        ? await transaction<{ task_id: string }[]>`UPDATE agent_task_dispatch_outbox dispatch
            SET state='PENDING',available_at=${now},publish_owner=NULL,publish_lease_until=NULL,last_error_code='DELIVERY_REPUBLISH_TIMEOUT'
            WHERE dispatch.state='PUBLISHED' AND dispatch.confirmed_at IS NOT NULL
              AND dispatch.confirmed_at<=${new Date(now - republishAfterMs).toISOString()}
              AND EXISTS (SELECT 1 FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id
                WHERE task.id=dispatch.task_id AND task.revision=dispatch.task_version AND task.state='RUNNABLE' AND run.state='ACTIVE')
            RETURNING dispatch.task_id`
        : [];
      const tasks = await transaction<DispatchableTask[]>`SELECT task.id,task.run_id,task.revision,task.attempt_count,task.tool_key,task.routing_class
        FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id
        WHERE task.state='RUNNABLE' AND task.available_at<=${now} AND run.state='ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM agent_task_dispatch_outbox dispatch WHERE dispatch.task_id=task.id AND dispatch.task_version=task.revision)
        ORDER BY task.run_id,task.id FOR UPDATE OF task SKIP LOCKED`;
      for (const task of tasks) await enqueueDispatch(transaction, task, 0);
      return [...new Set([...republished.map((row) => row.task_id), ...tasks.map((task) => task.id)])];
    });
  }
  async dispatchStats(now = Date.now()) {
    const [row] = await this.sql<{ pending: number; publishing: number; published: number; failed: number; oldest_pending_ms: number; runnable_without_delivery: number }[]>`SELECT
      count(*) FILTER (WHERE state='PENDING')::integer AS pending,
      count(*) FILTER (WHERE state='PUBLISHING')::integer AS publishing,
      count(*) FILTER (WHERE state='PUBLISHED')::integer AS published,
      count(*) FILTER (WHERE state='FAILED')::integer AS failed,
      COALESCE(max(${now}-available_at) FILTER (WHERE state='PENDING' AND available_at<=${now}),0)::bigint AS oldest_pending_ms,
      (SELECT count(*)::integer FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id WHERE task.state='RUNNABLE' AND run.state='ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM agent_task_dispatch_outbox dispatch WHERE dispatch.task_id=task.id AND dispatch.task_version=task.revision)) AS runnable_without_delivery
      FROM agent_task_dispatch_outbox`;
    return row ?? { pending: 0, publishing: 0, published: 0, failed: 0, oldest_pending_ms: 0, runnable_without_delivery: 0 };
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
    const [runs,tasks,budgets,escalations,fanouts] = await Promise.all([
      this.sql`SELECT id,goal_id,state,revision,current_plan_version,last_progress_at FROM agent_runs WHERE id=${runId}`,
      this.sql`SELECT id,task_key,state,revision,attempt_count,lease_owner,lease_token,lease_expires_at FROM agent_tasks WHERE run_id=${runId} ORDER BY id`,
      this.sql`SELECT kind,limit_value,used_value,revision FROM agent_budget_ledger WHERE run_id=${runId} ORDER BY kind`,
      this.sql`SELECT id,version,state,safe_summary,impact FROM agent_escalations WHERE run_id=${runId} AND state='OPEN' ORDER BY version DESC LIMIT 1`,
      this.sql`SELECT group_record.id,group_record.group_key,group_record.kind,group_record.state,group_record.expected_count,
        count(*) FILTER (WHERE task.state='SUCCEEDED')::integer AS succeeded_count,
        count(*) FILTER (WHERE task.state='FAILED')::integer AS failed_count
        FROM agent_fanout_groups group_record LEFT JOIN agent_fanout_members member ON member.group_id=group_record.id
        LEFT JOIN agent_tasks task ON task.id=member.shard_task_id WHERE group_record.run_id=${runId}
        GROUP BY group_record.id ORDER BY group_record.created_at`,
    ]); return { run: runs[0] ?? null, tasks, budgets, fanouts, escalation: escalations[0] ?? null };
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
      await transaction`INSERT INTO agent_runs (id,goal_id,trigger_identity,origin_escalation_id,state,revision,current_plan_version,last_progress_at,workflow_version) VALUES (${newRunId},${newGoalId},${`human-resolution:${input.escalationId}:${input.expectedVersion}`},${input.escalationId},'ACTIVE',1,1,${eventTime},${String(row.workflow_version ?? COVERAGE_FIRST_WORKFLOW_VERSION)})`;
      await transaction`UPDATE candidates SET revision=revision+1,record_json=((record_json::jsonb || jsonb_build_object('status','MATERIALS_READY','escalation',NULL))::text) WHERE id=${Number(row.candidate_id)}`;
      return { sameRun: false, previousRunState: "SUPERSEDED", runId: newRunId, linkedEscalationId: input.escalationId, inputVersion: nextInput, profileVersion: nextProfile };
    });
  }
  private async nextSequence(runId: string, client = this.sql) {
    await client`SELECT pg_advisory_xact_lock(hashtext(${runId}))`;
    const [row] = await client<{ value: number }[]>`SELECT COALESCE(max(sequence),0)::integer+1 AS value FROM agent_events WHERE run_id=${runId}`;
    return row?.value ?? 1;
  }
}
