import * as amqp from "amqplib";
import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage, Options } from "amqplib";
import type { PostgresAgentRuntimeRepository } from "./postgres-runtime-repository.ts";
import { parseRabbitTaskEnvelope, RABBIT_ROUTING_CLASSES, RABBIT_TASK_ENVELOPE_VERSION, type RabbitRoutingClass, type RabbitTaskEnvelope } from "./rabbitmq-contracts.ts";

export const RABBIT_TASK_EXCHANGE = "candidate.tasks";
export const RABBIT_DEAD_LETTER_EXCHANGE = "candidate.tasks.dlx";

export function rabbitQueueName(routingClass: RabbitRoutingClass) { return `candidate.tasks.${routingClass}`; }
export function rabbitDeadLetterQueueName(routingClass: RabbitRoutingClass) { return `candidate.tasks.${routingClass}.dead`; }

export type RabbitRuntimeConfig = {
  url: string;
  prefetch: number;
  publishBatchSize: number;
  publishLeaseMs: number;
  pollingMs: number;
  messageTtlMs: number;
  deadLetterTtlMs: number;
  republishAfterMs: number;
};

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

function positiveInteger(source: EnvironmentSource, name: string, fallback: number) {
  const value = Number(source[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`RABBIT_CONFIG_INVALID:${name}`);
  return value;
}

export function loadRabbitRuntimeConfig(source: EnvironmentSource = process.env): RabbitRuntimeConfig {
  const url = source.RABBITMQ_URL?.trim();
  if (!url) throw new Error("RABBITMQ_URL_REQUIRED");
  const parsed = new URL(url);
  if (!["amqp:", "amqps:"].includes(parsed.protocol) || !parsed.hostname) throw new Error("RABBITMQ_URL_INVALID");
  return {
    url,
    prefetch: positiveInteger(source, "RABBITMQ_PREFETCH", 1),
    publishBatchSize: positiveInteger(source, "RABBITMQ_PUBLISH_BATCH_SIZE", 50),
    publishLeaseMs: positiveInteger(source, "RABBITMQ_PUBLISH_LEASE_MS", 30_000),
    pollingMs: positiveInteger(source, "RABBITMQ_PUBLISH_POLLING_MS", 500),
    messageTtlMs: positiveInteger(source, "RABBITMQ_MESSAGE_TTL_MS", 7 * 24 * 60 * 60 * 1_000),
    deadLetterTtlMs: positiveInteger(source, "RABBITMQ_DEAD_LETTER_TTL_MS", 14 * 24 * 60 * 60 * 1_000),
    republishAfterMs: positiveInteger(source, "RABBITMQ_REPUBLISH_AFTER_MS", 5 * 60_000),
  };
}

export async function assertRabbitTopology(channel: Channel | ConfirmChannel, config: Pick<RabbitRuntimeConfig, "messageTtlMs" | "deadLetterTtlMs">) {
  await channel.assertExchange(RABBIT_TASK_EXCHANGE, "direct", { durable: true });
  await channel.assertExchange(RABBIT_DEAD_LETTER_EXCHANGE, "direct", { durable: true });
  for (const routingClass of RABBIT_ROUTING_CLASSES) {
    const queue = rabbitQueueName(routingClass);
    const dead = rabbitDeadLetterQueueName(routingClass);
    await channel.assertQueue(dead, { durable: true, arguments: { "x-message-ttl": config.deadLetterTtlMs } });
    await channel.bindQueue(dead, RABBIT_DEAD_LETTER_EXCHANGE, routingClass);
    await channel.assertQueue(queue, { durable: true, arguments: {
      "x-message-ttl": config.messageTtlMs,
      "x-dead-letter-exchange": RABBIT_DEAD_LETTER_EXCHANGE,
      "x-dead-letter-routing-key": routingClass,
    } });
    await channel.bindQueue(queue, RABBIT_TASK_EXCHANGE, routingClass);
  }
}

export async function connectRabbit(url: string): Promise<ChannelModel> {
  return amqp.connect(url);
}

function safePublishCode(error: unknown) {
  const code = error instanceof Error ? error.message : "RABBIT_PUBLISH_FAILED";
  return /^[A-Z0-9_:.-]{1,160}$/.test(code) ? code : "RABBIT_PUBLISH_FAILED";
}

export async function confirmPublish(channel: ConfirmChannel, envelope: RabbitTaskEnvelope, messageId: string) {
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  const options: Options.Publish = {
    persistent: true,
    mandatory: true,
    contentType: "application/json",
    contentEncoding: "utf-8",
    type: RABBIT_TASK_ENVELOPE_VERSION,
    messageId,
    correlationId: envelope.correlationId,
    timestamp: Math.floor(Date.parse(envelope.createdAt) / 1_000),
  };
  await new Promise<void>((resolve, reject) => {
    let returned = false;
    const onReturn = (message: ConsumeMessage) => {
      if (message.properties.messageId === messageId) returned = true;
    };
    const finish = (error?: Error | null) => {
      channel.off("return", onReturn);
      if (error) reject(error);
      else if (returned) reject(new Error("RABBIT_PUBLISH_UNROUTABLE"));
      else resolve();
    };
    channel.on("return", onReturn);
    try {
      channel.publish(RABBIT_TASK_EXCHANGE, envelope.routingClass, body, options, finish);
    } catch (error) {
      channel.off("return", onReturn);
      reject(error);
    }
  });
}

export class RabbitDispatchPublisher {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private stopping = false;
  private readonly config: RabbitRuntimeConfig;
  private readonly repository: PostgresAgentRuntimeRepository;
  private readonly publisherId: string;

  constructor(config: RabbitRuntimeConfig, repository: PostgresAgentRuntimeRepository, publisherId: string) {
    this.config = config;
    this.repository = repository;
    this.publisherId = publisherId;
  }

  async start() {
    while (!this.stopping) {
      try {
        await this.runOnce();
      } catch (error) {
        console.info(JSON.stringify({ event: "rabbit-dispatch-publisher-error", safeCode: safePublishCode(error) }));
        await this.disconnect();
      }
      if (!this.stopping) await new Promise((resolve) => setTimeout(resolve, this.config.pollingMs));
    }
  }

  async runOnce() {
    const channel = await this.ensureChannel();
    await this.repository.reconcileDispatch(Date.now(), this.config.republishAfterMs);
    const entries = await this.repository.claimDispatchBatch({ publisherId: this.publisherId, now: Date.now(), leaseMs: this.config.publishLeaseMs, limit: this.config.publishBatchSize });
    for (const entry of entries) {
      const messageId = entry.dispatchId;
      try {
        await confirmPublish(channel, entry.envelope, messageId);
        await this.repository.confirmDispatch({ dispatchId: entry.dispatchId, publisherId: this.publisherId, brokerMessageId: messageId, now: Date.now() });
      } catch (error) {
        const delay = Math.min(30_000, 250 * 2 ** Math.min(entry.envelope.attemptHint, 7));
        await this.repository.failDispatch({ dispatchId: entry.dispatchId, publisherId: this.publisherId, now: Date.now(), retryAt: Date.now() + delay, errorCode: safePublishCode(error) }).catch(() => undefined);
        throw error;
      }
    }
    if (entries.length) console.info(JSON.stringify({ event: "rabbit-dispatch-published", publisherId: this.publisherId, count: entries.length }));
    return entries.length;
  }

  async stop() { this.stopping = true; await this.disconnect(); }

  private async ensureChannel() {
    if (this.channel) return this.channel;
    this.connection = await connectRabbit(this.config.url);
    this.connection.on("error", () => { this.channel = undefined; });
    this.connection.on("close", () => { this.channel = undefined; this.connection = undefined; });
    this.channel = await this.connection.createConfirmChannel();
    await assertRabbitTopology(this.channel, this.config);
    return this.channel;
  }

  private async disconnect() {
    const channel = this.channel; const connection = this.connection;
    this.channel = undefined; this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }
}

export function decodeRabbitMessage(message: ConsumeMessage) {
  let value: unknown;
  try { value = JSON.parse(message.content.toString("utf8")); }
  catch { throw new Error("RABBIT_ENVELOPE_JSON_INVALID"); }
  return parseRabbitTaskEnvelope(value);
}
