import { createHttpToolAdapters } from "./http-tool-adapter.ts";
import { RabbitTaskWorker, loadRabbitWorkerConfig } from "./rabbitmq-worker.ts";
import { createWorkerIdentity } from "./worker-identity.ts";

if ((process.env.CANDIDATE_DISPATCH_TRANSPORT ?? "rabbit") !== "rabbit") {
  console.log(JSON.stringify({ event: "rabbit-worker.disabled", transport: process.env.CANDIDATE_DISPATCH_TRANSPORT ?? "postgres" }));
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  process.exit(0);
}

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const environment = (process.env.AGENT_RUNTIME_ENVIRONMENT ?? "local") as "local" | "staging" | "preproduction" | "production";
if (!("local staging preproduction production".split(" ") as string[]).includes(environment)) throw new Error("AGENT_RUNTIME_ENVIRONMENT is invalid");
const role = process.env.RABBITMQ_WORKER_CLASSES?.trim() || "control";
process.env.AGENT_RUNTIME_WORKER_ID = createWorkerIdentity(role, process.env.AGENT_RUNTIME_WORKER_ID);
const config = loadRabbitWorkerConfig();
const adapters = createHttpToolAdapters({ endpoint: required("CANDIDATE_TOOL_ENDPOINT"), token: required("CANDIDATE_TOOL_INTERNAL_TOKEN"), environment });
const worker = new RabbitTaskWorker(config, adapters);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void worker.stop(); });
await worker.start();
