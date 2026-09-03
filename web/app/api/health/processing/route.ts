import { serverContainer } from "../../../../server/configuration/container.ts";
import { PostgresAgentRuntimeRepository } from "../../../../server/agent-runtime/postgres-runtime-repository.ts";
import { connectRabbit, rabbitQueueName } from "../../../../server/agent-runtime/rabbitmq.ts";
import { RABBIT_ROUTING_CLASSES } from "../../../../server/agent-runtime/rabbitmq-contracts.ts";

const headers = { "cache-control": "no-store" };

export async function GET() {
  try {
    const container = await serverContainer();
    if (container.environment.CANDIDATE_DISPATCH_TRANSPORT === "postgres") {
      await container.sql`SELECT 1 AS ready`;
      return Response.json({ ready: true, transport: "postgres", broker: "disabled" }, { status: 200, headers });
    }
    const url = container.environment.RABBITMQ_URL;
    if (!url) throw new Error("RABBITMQ_URL_REQUIRED");
    const connection = await connectRabbit(url); const channel = await connection.createChannel();
    try {
      const pools = Object.fromEntries(await Promise.all(RABBIT_ROUTING_CLASSES.map(async (routingClass) => {
        const status = await channel.checkQueue(rabbitQueueName(routingClass));
        return [routingClass, { consumers: status.consumerCount, messages: status.messageCount }];
      }))) as Record<string, { consumers: number; messages: number }>;
      const stats = await new PostgresAgentRuntimeRepository(container.sql).dispatchStats();
      const missingPools = Object.entries(pools).filter(([, status]) => status.consumers < 1).map(([routingClass]) => routingClass);
      const ready = missingPools.length === 0 && stats.runnable_without_delivery === 0 && stats.oldest_pending_ms < 60_000;
      return Response.json({ ready, broker: "connected", missingPools, dispatch: stats, pools }, { status: ready ? 200 : 503, headers });
    } finally { await channel.close().catch(() => undefined); await connection.close().catch(() => undefined); }
  } catch {
    return Response.json({ ready: false, broker: "unavailable", code: "CANDIDATE_PROCESSING_NOT_READY" }, { status: 503, headers });
  }
}
