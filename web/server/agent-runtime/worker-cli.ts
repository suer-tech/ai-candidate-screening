import { AgentRuntimeConsumer, loadRuntimeConsumerConfig } from "./consumer.ts";
import { createHttpToolAdapters } from "./http-tool-adapter.ts";
import { startProductionDriveDiscoveryWorker } from "../candidate-pipeline/production-discovery.ts";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const environment = (process.env.AGENT_RUNTIME_ENVIRONMENT ?? "local") as "local" | "staging" | "preproduction" | "production";
if (!(["local", "staging", "preproduction", "production"] as const).includes(environment)) throw new Error("AGENT_RUNTIME_ENVIRONMENT is invalid");
const config = loadRuntimeConsumerConfig();
const adapters = createHttpToolAdapters({ endpoint: required("CANDIDATE_TOOL_ENDPOINT"), token: required("CANDIDATE_TOOL_INTERNAL_TOKEN"), environment });
const consumer = new AgentRuntimeConsumer(config, adapters);
const discovery = await startProductionDriveDiscoveryWorker();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => discovery.stop());
await consumer.start();
