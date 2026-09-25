import { serverContainer } from "../configuration/container.ts";
import { PostgresAgentRuntimeRepository } from "./postgres-runtime-repository.ts";
import { RabbitDispatchPublisher, loadRabbitRuntimeConfig } from "./rabbitmq.ts";
import { createWorkerIdentity } from "./worker-identity.ts";
import { AdminOnlyProtectedTraceStore } from "../llm/protected-store.ts";
import { PostgresProtectedTracePersistence } from "../llm/postgres-persistence.ts";
import { PostgresBlobStore } from "../storage/blob-store.ts";

if ((process.env.CANDIDATE_DISPATCH_TRANSPORT ?? "rabbit") !== "rabbit") {
  console.log(JSON.stringify({ event: "rabbit-publisher.disabled", transport: process.env.CANDIDATE_DISPATCH_TRANSPORT ?? "postgres" }));
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  process.exit(0);
}

const container = await serverContainer();
const publisher = new RabbitDispatchPublisher(loadRabbitRuntimeConfig(container.environment), new PostgresAgentRuntimeRepository(container.sql), createWorkerIdentity("publisher", process.env.AGENT_RUNTIME_WORKER_ID));
const traces = new AdminOnlyProtectedTraceStore(new PostgresProtectedTracePersistence(new PostgresBlobStore(container.sql)));
const purgeTraces = async () => {
  try {
    const deleted = await traces.purgeExpired();
    const jevDeleted = await new PostgresBlobStore(container.sql).deleteExpired("protected-jev-trace", new Date().toISOString());
    console.info(JSON.stringify({ event: "protected-trace-retention", deleted, jevDeleted }));
  } catch {
    console.info(JSON.stringify({ event: "protected-trace-retention", safeCode: "PROTECTED_TRACE_PURGE_FAILED" }));
  }
};
await purgeTraces();
const retentionTimer = setInterval(() => { void purgeTraces(); }, 24 * 60 * 60 * 1000);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { clearInterval(retentionTimer); void publisher.stop(); });
await publisher.start();
