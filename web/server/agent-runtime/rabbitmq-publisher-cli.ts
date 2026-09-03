import { serverContainer } from "../configuration/container.ts";
import { PostgresAgentRuntimeRepository } from "./postgres-runtime-repository.ts";
import { RabbitDispatchPublisher, loadRabbitRuntimeConfig } from "./rabbitmq.ts";
import { createWorkerIdentity } from "./worker-identity.ts";

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
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void publisher.stop(); });
await publisher.start();
