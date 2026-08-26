import { randomUUID } from "node:crypto";
import { LLM_CAPABILITIES } from "../llm/configuration.ts";
import type { PostgresBlobStore } from "../storage/blob-store.ts";
import { assertMigrationsCurrent } from "../storage/migrations.ts";
import { probePostgres, type PostgresClient } from "../storage/postgres.ts";

const REQUIRED_TABLES = ["vacancies", "vacancy_operations", "candidates", "result_documents", "audit_events", "candidate_tombstones"] as const;
export type ReadinessCheckName = "identity" | "postgresql" | "blob" | "drive" | "llm" | "stt";
export type ReadinessCheck = { name: ReadinessCheckName; ready: boolean; detail: string };
export type ProductionReadiness = { ready: boolean; mode: "production-like"; checks: ReadinessCheck[] };
type Environment = Record<string, unknown>;
export type PreflightDependencies = {
  identity: string | null; database: PostgresClient; blobs: PostgresBlobStore; environment: Environment;
  driveProbe(): Promise<void>;
  validateLlm(environment: Environment, capabilities: typeof LLM_CAPABILITIES): void;
};

function configured(environment: Environment, name: string): string {
  const value = environment[name]; if (typeof value !== "string" || !value.trim()) throw new Error(`${name}_MISSING`); return value.trim();
}
function safeDetail(error: unknown) { return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "CHECK_FAILED"; }
async function check(name: ReadinessCheckName, operation: () => Promise<void> | void): Promise<ReadinessCheck> {
  try { await operation(); return { name, ready: true, detail: "READY" }; }
  catch (error) { return { name, ready: false, detail: safeDetail(error) }; }
}

export async function evaluateProductionReadiness(dependencies: PreflightDependencies): Promise<ProductionReadiness> {
  const checks = await Promise.all([
    check("identity", () => { if (!dependencies.identity) throw new Error("HR_IDENTITY_MISSING"); }),
    check("postgresql", async () => {
      await probePostgres(dependencies.database); await assertMigrationsCurrent(dependencies.database);
      const rows = await dependencies.database<{ name: string }[]>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ${dependencies.database(REQUIRED_TABLES)}`;
      const names = new Set(rows.map((row) => row.name)); if (REQUIRED_TABLES.some((name) => !names.has(name))) throw new Error("POSTGRES_MIGRATION_INCOMPLETE");
    }),
    check("blob", async () => {
      const scope = `readiness:${randomUUID()}`;
      try { await dependencies.blobs.put({ scope, kind: "readiness", mimeType: "application/octet-stream", bytes: new Uint8Array([1]) }); }
      finally { await dependencies.blobs.deleteScope(scope, true); }
    }),
    check("drive", dependencies.driveProbe),
    check("llm", () => dependencies.validateLlm(dependencies.environment, LLM_CAPABILITIES)),
    check("stt", () => { configured(dependencies.environment, "ASSEMBLYAI_API_KEY"); }),
  ]);
  return { ready: checks.every((item) => item.ready), mode: "production-like", checks };
}
export { REQUIRED_TABLES };
