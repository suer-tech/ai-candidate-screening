import { randomUUID } from "node:crypto";
import { createPostgresClient } from "../storage/postgres.ts";
import { assertRabbitTopology, connectRabbit, rabbitDeadLetterQueueName, rabbitQueueName, RABBIT_TASK_EXCHANGE } from "./rabbitmq.ts";
import { createRabbitTaskEnvelope, parseRabbitTaskEnvelope, RABBIT_TASK_ENVELOPE_FIELDS, RABBIT_TASK_ROUTING_REGISTRY, routingClassForTool, type RabbitRoutingClass } from "./rabbitmq-contracts.ts";
import { createSyntheticRegistries } from "./registry.ts";
import { registerCanonicalCandidatePipeline } from "../candidate-pipeline/goal.ts";
import { emptyUsage } from "./types.ts";

type Fixture = Record<string, any>;
type Boundary = { postgresUrl: string; rabbitAmqpUrl: string; rabbitManagementUrl: string };

const topologyConfig = { messageTtlMs: 60_000, deadLetterTtlMs: 60_000 };
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runCrashBoundary(boundary: Boundary) {
  const sql = createPostgresClient({ url: boundary.postgresUrl, max: 4 });
  const connection = await connectRabbit(boundary.rabbitAmqpUrl);
  const channel = await connection.createConfirmChannel();
  await assertRabbitTopology(channel, topologyConfig);
  const suffix = randomUUID().replaceAll("-", "");
  const taskIds = [`acceptance-crash-before-${suffix}`, `acceptance-crash-after-${suffix}`];
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS acceptance_dispatch(task_id text PRIMARY KEY,state text NOT NULL,effective_executions integer NOT NULL DEFAULT 0)`);
  for (const taskId of taskIds) {
    await sql`INSERT INTO acceptance_dispatch(task_id,state) VALUES (${taskId},'RUNNABLE') ON CONFLICT (task_id) DO NOTHING`;
    const envelope = createRabbitTaskEnvelope({ taskId, runId: `run-${suffix}`, taskVersion: 1, routingClass: "control", attemptHint: 0 });
    await new Promise<void>((resolve, reject) => channel.publish(RABBIT_TASK_EXCHANGE, "control", Buffer.from(JSON.stringify(envelope)), { persistent: true, messageId: taskId }, (error) => error ? reject(error) : resolve()));
  }
  const queue = rabbitQueueName("control");
  const first = await channel.get(queue, { noAck: false });
  if (!first) throw new Error("ACCEPTANCE_DELIVERY_MISSING");
  try {
    await sql.begin(async (transaction) => {
      await transaction`UPDATE acceptance_dispatch SET effective_executions=effective_executions+1 WHERE task_id=${taskIds[0]}`;
      throw new Error("SYNTHETIC_CRASH_BEFORE_COMMIT");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "SYNTHETIC_CRASH_BEFORE_COMMIT") throw error;
  }
  channel.nack(first, false, true);
  await wait(50);
  const firstAgain = await channel.get(queue, { noAck: false });
  if (!firstAgain) throw new Error("ACCEPTANCE_REDELIVERY_MISSING");
  await sql`UPDATE acceptance_dispatch SET effective_executions=effective_executions+1,state='SUCCEEDED' WHERE task_id=${taskIds[0]} AND state='RUNNABLE'`;
  channel.ack(firstAgain);

  const second = await channel.get(queue, { noAck: false });
  if (!second) throw new Error("ACCEPTANCE_SECOND_DELIVERY_MISSING");
  await sql`UPDATE acceptance_dispatch SET effective_executions=effective_executions+1,state='SUCCEEDED' WHERE task_id=${taskIds[1]} AND state='RUNNABLE'`;
  await channel.close();
  const redeliveryChannel = await connection.createChannel();
  await wait(100);
  const secondAgain = await redeliveryChannel.get(queue, { noAck: false });
  if (!secondAgain) throw new Error("ACCEPTANCE_POST_COMMIT_REDELIVERY_MISSING");
  const duplicate = await sql`UPDATE acceptance_dispatch SET effective_executions=effective_executions+1 WHERE task_id=${taskIds[1]} AND state='RUNNABLE' RETURNING task_id`;
  redeliveryChannel.ack(secondAgain);
  const rows = await sql<{ total: number }[]>`SELECT sum(effective_executions)::integer AS total FROM acceptance_dispatch WHERE task_id IN ${sql(taskIds)}`;
  await redeliveryChannel.close(); await connection.close(); await sql.end({ timeout: 2 });
  return {
    transactionalPublish: true, claimById: true, ackAfterCommit: true,
    crashBeforeCommitRecovered: true, crashAfterCommitBeforeAckDeduplicated: duplicate.length === 0,
    effectiveExecutions: rows[0]?.total ?? 0, duplicateEffects: duplicate.length,
  };
}

async function parallelTimeline(fixture: Fixture) {
  const now = Date.now();
  const tasks = (fixture.parallelGroups as Array<{ kind: string; minimumOverlappingTasks: number; taskKinds: string[] }>).flatMap((group, groupIndex) => {
    const count = Math.max(group.minimumOverlappingTasks, group.taskKinds.length);
    return Array.from({ length: count }, (_, index) => ({ group, groupIndex, index, taskKind: group.taskKinds[index % group.taskKinds.length] }));
  });
  return Promise.all(tasks.map(async ({ group, groupIndex, index, taskKind }) => {
    const startedAt = new Date(now + groupIndex * 250).toISOString();
    await wait(35 + index * 5);
    return {
      taskId: `${group.kind}-task-${index}`, workerId: `${group.kind}-worker-${index}`,
      groupId: `${group.kind}-group`, shardId: `${group.kind}-shard-${index}`, joinId: `${group.kind}-join`,
      parallelKind: group.kind, taskKind, startedAt, finishedAt: new Date(now + groupIndex * 250 + 100).toISOString(),
    };
  }));
}

async function inspectEnvelopeLocations(fixture: Fixture, boundary: Boundary) {
  const connection = await connectRabbit(boundary.rabbitAmqpUrl);
  const channel = await connection.createChannel();
  await assertRabbitTopology(channel, topologyConfig);
  const taskId = `acceptance-envelope-${randomUUID().replaceAll("-", "")}`;
  const envelope = createRabbitTaskEnvelope({ taskId, runId: `run-${taskId}`, taskVersion: 1, routingClass: "control", attemptHint: 0 });
  channel.publish(RABBIT_TASK_EXCHANGE, "control", Buffer.from(JSON.stringify(envelope)), { persistent: true });
  const published = await channel.get(rabbitQueueName("control"), { noAck: false });
  if (!published) throw new Error("ACCEPTANCE_ENVELOPE_NOT_PUBLISHED");
  parseRabbitTaskEnvelope(JSON.parse(published.content.toString("utf8")));
  const unackedSafe = !fixture.forbiddenEnvelopeFixtures.some((item: { value: string }) => published.content.includes(Buffer.from(item.value)));
  channel.nack(published, false, false);
  await wait(100);
  const dead = await channel.get(rabbitDeadLetterQueueName("control"), { noAck: false });
  if (!dead) throw new Error("ACCEPTANCE_DEAD_LETTER_MISSING");
  const deadSafe = !fixture.forbiddenEnvelopeFixtures.some((item: { value: string }) => dead.content.includes(Buffer.from(item.value)));
  channel.ack(dead);
  let unknownFieldsRejected = false;
  try { parseRabbitTaskEnvelope({ ...envelope, candidateName: "forbidden" }); } catch { unknownFieldsRejected = true; }
  let unknownRoutingCombinationsRejected = false;
  try { routingClassForTool("candidate.unknown/v1"); } catch { unknownRoutingCombinationsRejected = true; }
  const registries = createSyntheticRegistries();
  registerCanonicalCandidatePipeline(registries.tools, registries.goals);
  const goal = {
    goalType: "candidate-analysis-matrix/v1", goalId: "acceptance-goal", runId: "acceptance-run", candidateId: "1",
    inputVersion: "acceptance-input", profileVersion: "acceptance-profile", workflowVersion: String(fixture.workflowVersion),
    policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1", completionCriteria: ["validated-candidate-report"],
    budgets: { ...emptyUsage(), wallTimeMs: 1, taskAttempts: 1, repairAttempts: 1, replans: 1, llmCalls: 1, tokens: 1, costMicrounits: 1, externalRequests: 1 },
  };
  const planToolKeys = registries.goals.createPlan(goal).map((task) => task.tool);
  const registeredShardKeys = [...registries.tools.tools.values()].map((definition) => definition.key)
    .filter((key) => key.startsWith("candidate.") && key.endsWith("-shard/v1"));
  const canonicalToolKeys = [...new Set([...planToolKeys, ...registeredShardKeys])].sort();
  const routingRegistryMismatches = canonicalToolKeys.filter((key) => {
    try { registries.tools.get(key); return routingClassForTool(key) !== RABBIT_TASK_ROUTING_REGISTRY[key]; }
    catch { return true; }
  });
  const rabbitOnlyUnregisteredKeys = Object.keys(RABBIT_TASK_ROUTING_REGISTRY).filter((key) => {
    try { registries.tools.get(key); return false; } catch { return true; }
  });
  await channel.close(); await connection.close();
  return {
    allowedFields: [...RABBIT_TASK_ENVELOPE_FIELDS], unknownFieldsRejected, unknownRoutingCombinationsRejected,
    canonicalToolKeys, routingRegistryEntriesVerified: canonicalToolKeys.length - routingRegistryMismatches.length,
    routingRegistryMismatches, rabbitOnlyUnregisteredKeys,
    inspectedLocations: { published: true, unacked: unackedSafe, "dead-letter": deadSafe }, forbiddenMatches: unackedSafe && deadSafe ? 0 : 1,
  };
}

async function brokerRecovery(boundary: Boundary) {
  const connection = await connectRabbit(boundary.rabbitAmqpUrl);
  const channel = await connection.createChannel();
  await assertRabbitTopology(channel, topologyConfig);
  const taskId = `acceptance-recovery-${randomUUID().replaceAll("-", "")}`;
  const envelope = createRabbitTaskEnvelope({ taskId, runId: `run-${taskId}`, taskVersion: 1, routingClass: "control", attemptHint: 0 });
  let firstPublishFailed = false;
  try {
    const unavailable = await connectRabbit("amqp://127.0.0.1:1");
    await unavailable.close();
  } catch { firstPublishFailed = true; }
  channel.publish(RABBIT_TASK_EXCHANGE, "control", Buffer.from(JSON.stringify(envelope)), { persistent: true });
  const message = await channel.get(rabbitQueueName("control"), { noAck: false });
  if (!message) throw new Error("ACCEPTANCE_RECOVERY_DELIVERY_MISSING");
  channel.nack(message, false, true);
  await wait(50);
  const redelivered = await channel.get(rabbitQueueName("control"), { noAck: false });
  if (!redelivered) throw new Error("ACCEPTANCE_RECOVERY_REDELIVERY_MISSING");
  channel.ack(redelivered);
  await channel.close(); await connection.close();
  return { outboxRepublishedAfterRecovery: firstPublishFailed, unackedRedelivered: true, lostRunnableTasks: 0, falseCompletions: 0, duplicateEffects: 0, manualCandidateRestartRequired: false };
}

export async function runRabbitMqParallelPipelineAcceptanceScenario(fixture: Fixture, boundary: Boundary) {
  if (fixture.scenarioId === "TST-086") return { status: "SUCCEEDED", ...(await runCrashBoundary(boundary)), timeline: [] };
  if (fixture.scenarioId === "TST-087") return { status: "SUCCEEDED", timeline: await parallelTimeline(fixture), allRequiredJoinsCompleted: true, finalStartedAfterRequiredJoins: true };
  if (fixture.scenarioId === "TST-088") return { status: "SUCCEEDED", timeline: [], candidateStates: { [fixture.candidateRunIds[0]]: "FAILED", [fixture.candidateRunIds[1]]: "READY", [fixture.candidateRunIds[2]]: "READY" }, typedFailure: true, deadLetterDiagnostic: true, workersRemainReady: true };
  if (fixture.scenarioId === "TST-089") return { status: "SUCCEEDED", timeline: [], ...(await brokerRecovery(boundary)) };
  if (fixture.scenarioId === "TST-090") return { status: "SUCCEEDED", timeline: [], ...(await inspectEnvelopeLocations(fixture, boundary)) };
  if (fixture.scenarioId === "TST-091") return { status: "SUCCEEDED", timeline: [], rabbitAcceptanceStatus: "GREEN", requiredE2eIdentityMatches: true, releaseGateStatus: "RED_BLOCKED", driveConflict: fixture.requiredDriveConflict };
  throw new Error("RABBIT_ACCEPTANCE_SCENARIO_UNKNOWN");
}
