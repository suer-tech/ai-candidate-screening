import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";
import { recoverStalePrivateTemp } from "../server/storage/private-temp.ts";

const service = process.argv[2];
const webRoot = path.resolve(import.meta.dirname, "..");
const entries: Record<string, string[]> = {
  web: [path.join(webRoot, ".output", "server", "index.mjs")],
  worker: ["--import", "tsx", path.join(webRoot, "server", "agent-runtime", "worker-cli.ts")],
  media: ["--import", "tsx", path.join(webRoot, "server", "media-processor", "server.ts")],
  document: ["--import", "tsx", path.join(webRoot, "server", "document-processor", "server.ts")],
  controller: ["--import", "tsx", path.join(webRoot, "server", "e2e-controller", "cli.ts")],
};
const argumentsForService = service ? entries[service] : undefined;
if (!argumentsForService) throw new Error("RUNTIME_SERVICE_UNKNOWN");
if (service === "web" && !await import("node:fs/promises").then(({ access }) => access(argumentsForService[0]).then(() => true, () => false))) {
  throw new Error("NODE_BUILD_MISSING");
}

const configuration = await loadRuntimeConfiguration(webRoot);
if (["worker", "media", "document"].includes(service ?? "")) await recoverStalePrivateTemp();
const environment = environmentProjection(configuration);
const childEnvironment = { ...process.env, ...environment, ...(service === "web" ? { NODE_ENV: "production" } : {}) } as NodeJS.ProcessEnv;
const child: ChildProcess = spawn(process.execPath, argumentsForService, {
  cwd: webRoot,
  env: childEnvironment,
  stdio: "inherit",
  windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => child.kill(signal));
child.once("error", (error: Error) => { throw error; });
child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
