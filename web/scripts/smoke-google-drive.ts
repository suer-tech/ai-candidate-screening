import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";

const environment = environmentProjection(await loadRuntimeConfiguration(process.cwd()));
const token = environment.AGENT_RUNTIME_INTERNAL_TOKEN;
if (!token) throw new Error("AGENT_RUNTIME_INTERNAL_TOKEN_MISSING");
const response = await fetch(new URL("/api/integrations/google-drive/smoke", environment.INTERNAL_APP_ORIGIN || environment.APP_ORIGIN), {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(120_000),
});
const result = await response.json() as { ready?: boolean; code?: string; checks?: Record<string, boolean> };
if (!response.ok || result.ready !== true) throw new Error(result.code ?? `GOOGLE_DRIVE_LOCAL_SMOKE_HTTP_${response.status}`);
if (!result.checks || Object.values(result.checks).some((value) => value !== true)) throw new Error("GOOGLE_DRIVE_LOCAL_SMOKE_INCOMPLETE");
const evidenceDirectory = resolve(process.cwd(), ".runtime/evidence");
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(resolve(evidenceDirectory, "google-drive-local-smoke.json"), `${JSON.stringify({
  schemaVersion: "google-drive-local-smoke/v1",
  capturedAtUtc: new Date().toISOString(),
  environment: "local",
  providerMode: "real",
  productionLikeAcceptanceClaimed: false,
  containsCredentials: false,
  checks: result.checks,
}, null, 2)}\n`, { encoding: "utf8", flag: "w" });
console.log("Google Drive real OAuth smoke: GREEN");
console.log("Проверено: refresh после нового runtime, чтение, публикация, reconcile без дубля и cleanup.");
console.log("Идентификаторы и credentials не выводились.");
