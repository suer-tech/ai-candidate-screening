import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import { AgentRuntimeConsumer, loadRuntimeConsumerConfig, type ClaimedTask, type RuntimeToolAdapterResolver } from "./consumer.ts";
import { assertRabbitTopology, connectRabbit, decodeRabbitMessage, loadRabbitRuntimeConfig, rabbitQueueName, type RabbitRuntimeConfig } from "./rabbitmq.ts";
import { RABBIT_ROUTING_CLASSES, type RabbitRoutingClass } from "./rabbitmq-contracts.ts";

export type RabbitWorkerConfig = RabbitRuntimeConfig & {
  endpoint: string;
  token: string;
  workerId: string;
  heartbeatMs: number;
  leaseMs: number;
  gracefulTimeoutMs: number;
  routingClasses: readonly RabbitRoutingClass[];
  maxPerRun: number;
  maxActivePool: number;
};

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : "RABBIT_WORKER_FAILED";
  return /^[A-Z0-9_:.-]{1,160}$/.test(value) ? value : "RABBIT_WORKER_FAILED";
}

async function runtimeCommand(endpoint: string, token: string, command: string, payload: Record<string, unknown>) {
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ command, ...payload }) });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" && /^[A-Z0-9_:.-]{1,160}$/.test(body.error) ? body.error : "RUNTIME_COMMAND_REJECTED");
  return body;
}

export function loadRabbitWorkerConfig(source: NodeJS.ProcessEnv = process.env): RabbitWorkerConfig {
  const rabbit = loadRabbitRuntimeConfig(source);
  const consumer = loadRuntimeConsumerConfig(source);
  const classes = (source.RABBITMQ_WORKER_CLASSES ?? "control").split(",").map((item) => item.trim()).filter(Boolean);
  if (!classes.length || classes.some((item) => !RABBIT_ROUTING_CLASSES.includes(item as RabbitRoutingClass))) throw new Error("RABBIT_WORKER_CLASSES_INVALID");
  const gracefulTimeoutMs = Number(source.RABBITMQ_GRACEFUL_TIMEOUT_MS ?? 30_000);
  const maxPerRun = Number(source.RABBITMQ_MAX_PER_RUN ?? 2);
  const maxActivePool = Number(source.RABBITMQ_POOL_CONCURRENCY ?? Math.max(rabbit.prefetch, 1));
  if (!Number.isInteger(gracefulTimeoutMs) || gracefulTimeoutMs < 1) throw new Error("RABBIT_GRACEFUL_TIMEOUT_INVALID");
  if (!Number.isInteger(maxPerRun) || maxPerRun < 1) throw new Error("RABBIT_MAX_PER_RUN_INVALID");
  if (!Number.isInteger(maxActivePool) || maxActivePool < 1) throw new Error("RABBIT_POOL_CONCURRENCY_INVALID");
  return { ...rabbit, endpoint: consumer.endpoint, token: consumer.token, workerId: consumer.workerId, heartbeatMs: consumer.heartbeatMs, leaseMs: consumer.leaseMs, gracefulTimeoutMs, routingClasses: classes as RabbitRoutingClass[], maxPerRun, maxActivePool };
}

export class RabbitTaskWorker {
  private connection?: ChannelModel;
  private channel?: Channel;
  private stopping = false;
  private readonly consumerTags: string[] = [];
  private readonly active = new Set<Promise<void>>();
  private readonly executor: AgentRuntimeConsumer;
  private rejectConsumerCancellation?: (error: Error) => void;

  constructor(private readonly config: RabbitWorkerConfig, adapters: RuntimeToolAdapterResolver) {
    this.executor = new AgentRuntimeConsumer({ endpoint: config.endpoint, token: config.token, workerId: config.workerId, pollingMs: config.pollingMs, heartbeatMs: config.heartbeatMs, leaseMs: config.leaseMs }, adapters);
  }

  async start() {
    this.connection = await connectRabbit(this.config.url);
    this.channel = await this.connection.createChannel();
    await assertRabbitTopology(this.channel, this.config);
    await this.channel.prefetch(this.config.prefetch, false);
    await runtimeCommand(this.config.endpoint, this.config.token, "recover", { now: Date.now() });
    await runtimeCommand(this.config.endpoint, this.config.token, "reconcile-dispatch", { now: Date.now(), republishAfterMs: this.config.republishAfterMs });
    const cancellation = new Promise<never>((_resolve, reject) => { this.rejectConsumerCancellation = reject; });
    for (const routingClass of this.config.routingClasses) {
      const result = await this.channel.consume(rabbitQueueName(routingClass), (message) => this.onMessage(message), { noAck: false });
      this.consumerTags.push(result.consumerTag);
    }
    console.info(JSON.stringify({ event: "rabbit-worker-ready", workerId: this.config.workerId, routingClasses: this.config.routingClasses, prefetch: this.config.prefetch }));
    try {
      await Promise.race([new Promise<void>((resolve) => this.connection!.once("close", resolve)), cancellation]);
    } finally {
      this.rejectConsumerCancellation = undefined;
    }
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    const channel = this.channel;
    if (channel) for (const tag of this.consumerTags) await channel.cancel(tag).catch(() => undefined);
    const drain = Promise.allSettled([...this.active]);
    let drained = false;
    await Promise.race([drain.then(() => { drained = true; }), new Promise((resolve) => setTimeout(resolve, this.config.gracefulTimeoutMs))]);
    if (!drained) {
      await this.executor.stop();
      await Promise.race([drain, new Promise((resolve) => setTimeout(resolve, Math.min(5_000, this.config.gracefulTimeoutMs)))]);
    }
    await channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  private onMessage(message: ConsumeMessage | null) {
    if (!message) {
      console.info(JSON.stringify({ event: "rabbit-worker-consumer-cancelled", workerId: this.config.workerId, safeCode: "RABBIT_CONSUMER_CANCELLED" }));
      this.rejectConsumerCancellation?.(new Error("RABBIT_CONSUMER_CANCELLED"));
      void this.connection?.close().catch(() => undefined);
      return;
    }
    if (!this.channel) return;
    const execution = this.processMessage(message).finally(() => this.active.delete(execution));
    this.active.add(execution);
  }

  private async processMessage(message: ConsumeMessage) {
    const channel = this.channel;
    if (!channel) return;
    try {
      const envelope = decodeRabbitMessage(message);
      if (!this.config.routingClasses.includes(envelope.routingClass)) throw new Error("RABBIT_ENVELOPE_ROUTING_NOT_OWNED");
      const body = await runtimeCommand(this.config.endpoint, this.config.token, "claim-task", { input: {
        taskId: envelope.taskId, taskVersion: envelope.taskVersion, routingClass: envelope.routingClass,
        worker: this.config.workerId, now: Date.now(), leaseMs: this.config.leaseMs, maxPerRun: this.config.maxPerRun, maxActivePool: this.config.maxActivePool,
      } });
      const task = body.task as ClaimedTask | null | undefined;
      if (!task) { channel.ack(message); return; }
      const startedAt = Date.now();
      console.info(JSON.stringify({ event: "rabbit-task-started", workerId: this.config.workerId, routingClass: envelope.routingClass, taskId: envelope.taskId, runId: envelope.runId,
        fanoutGroupId: task.fanout_group_id, shardIdentity: task.shard_identity, redelivered: message.fields.redelivered }));
      await this.executor.executeClaimedTask(task);
      channel.ack(message);
      console.info(JSON.stringify({ event: "rabbit-task-finished", workerId: this.config.workerId, routingClass: envelope.routingClass, taskId: envelope.taskId, runId: envelope.runId,
        fanoutGroupId: task.fanout_group_id, shardIdentity: task.shard_identity, elapsedMs: Date.now() - startedAt }));
    } catch (error) {
      const code = safeCode(error);
      const invalid = code.startsWith("RABBIT_ENVELOPE_") || code === "RABBIT_TASK_ROUTE_MISMATCH";
      console.info(JSON.stringify({ event: invalid ? "rabbit-worker-dead-letter" : "rabbit-worker-delivery-error", workerId: this.config.workerId, safeCode: code, redelivered: message.fields.redelivered }));
      if (["RABBIT_RUN_CONCURRENCY_LIMIT", "RABBIT_POOL_CONCURRENCY_LIMIT", "RABBIT_DEPENDENCY_NOT_READY", "RABBIT_TASK_NOT_YET_AVAILABLE"].includes(code)) {
        const envelope = decodeRabbitMessage(message);
        const deferred = await runtimeCommand(this.config.endpoint, this.config.token, "defer-dispatch", { input: { taskId: envelope.taskId, taskVersion: envelope.taskVersion,
          retryAt: Date.now() + 1_000, reason: code } }).catch(() => ({ accepted: false }));
        if (deferred.accepted === true) { channel.ack(message); return; }
      }
      if (!invalid) await new Promise((resolve) => setTimeout(resolve, 250));
      channel.nack(message, false, !invalid);
    }
  }
}
