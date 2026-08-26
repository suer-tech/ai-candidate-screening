import { createServer } from "node:http";
import { environmentProjection, loadRuntimeConfiguration } from "../configuration/runtime.ts";
import { createPostgresClient } from "../storage/postgres.ts";
import { FixtureController } from "./controller.ts";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const port = Number(process.env.FIXTURE_CONTROLLER_PORT ?? 4077);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("FIXTURE_CONTROLLER_PORT is invalid");
const configuration = await loadRuntimeConfiguration();
const environmentProjectionValue = environmentProjection(configuration);
const database = createPostgresClient({ url: environmentProjectionValue.DATABASE_URL, max: 2 });
const environment = (process.env.E2E_ENVIRONMENT ?? "local") as "local" | "staging" | "preproduction";
if (!(["local", "staging", "preproduction"] as const).includes(environment)) throw new Error("E2E_ENVIRONMENT is invalid");
const controller = new FixtureController(database, {
  token: required("E2E_FIXTURE_CONTROL_TOKEN"),
  buildId: required("CANDIDATE_PIPELINE_BUILD_ID"),
  environment,
  fixtureSetId: process.env.E2E_FIXTURE_SET_ID?.trim() || "canonical-candidate-v1",
  allowDestructiveCleanup: process.env.E2E_ALLOW_DESTRUCTIVE_CLEANUP === "true",
});

const server = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  const origin = `http://${incoming.headers.host ?? `127.0.0.1:${port}`}`;
  const request = new Request(new URL(incoming.url ?? "/", origin), { method: incoming.method, headers: incoming.headers as HeadersInit, body: ["GET", "HEAD"].includes(incoming.method ?? "GET") ? undefined : Buffer.concat(chunks) });
  const response = await controller.handle(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, "127.0.0.1", () => process.stdout.write(`fixture-controller listening on 127.0.0.1:${port}\n`));
const shutdown = () => server.close(() => { void database.end({ timeout: 5 }).finally(() => process.exit(0)); });
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
