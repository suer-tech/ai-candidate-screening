import { LLM_CAPABILITIES } from "../llm/configuration.ts";

const REQUIRED_TABLES = [
  "vacancies",
  "vacancy_operations",
  "candidates",
  "result_documents",
  "audit_events",
  "candidate_tombstones",
] as const;

export type ReadinessCheckName = "identity" | "d1" | "r2" | "drive" | "llm" | "stt";

export type ReadinessCheck = {
  name: ReadinessCheckName;
  ready: boolean;
  detail: string;
};

export type ProductionReadiness = {
  ready: boolean;
  mode: "production-like";
  checks: ReadinessCheck[];
};

type Environment = Record<string, unknown>;

export type PreflightDependencies = {
  identity: string | null;
  database?: Pick<D1Database, "prepare">;
  traceBucket?: Pick<R2Bucket, "list">;
  environment: Environment;
  fetcher?: typeof fetch;
  validateLlm(environment: Environment, capabilities: typeof LLM_CAPABILITIES): void;
};

function configured(environment: Environment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name}_MISSING`);
  return value.trim();
}

function detail(error: unknown): string {
  if (!(error instanceof Error)) return "CHECK_FAILED";
  if (/^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return "CHECK_FAILED";
}

async function check(name: ReadinessCheckName, operation: () => Promise<void> | void): Promise<ReadinessCheck> {
  try {
    await operation();
    return { name, ready: true, detail: "READY" };
  } catch (error) {
    return { name, ready: false, detail: detail(error) };
  }
}

async function providerSmoke(environment: Environment, fetcher: typeof fetch, prefix: "LLM" | "STT") {
  const endpoint = configured(environment, `E2E_${prefix}_SMOKE_URL`);
  const token = configured(environment, `E2E_${prefix}_SMOKE_TOKEN`);
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ probe: "production-readiness" }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${prefix}_SMOKE_UNAVAILABLE`);
  const payload = await response.json() as { ready?: boolean; providerMode?: string };
  if (payload.ready !== true || payload.providerMode !== "real") throw new Error(`${prefix}_SMOKE_NOT_REAL`);
}

export async function evaluateProductionReadiness(dependencies: PreflightDependencies): Promise<ProductionReadiness> {
  const fetcher = dependencies.fetcher ?? fetch;
  const checks = await Promise.all([
    check("identity", () => {
      if (!dependencies.identity) throw new Error("HR_IDENTITY_MISSING");
    }),
    check("d1", async () => {
      if (!dependencies.database) throw new Error("D1_BINDING_MISSING");
      const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
      const result = await dependencies.database.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      ).bind(...REQUIRED_TABLES).all<{ name: string }>();
      const names = new Set((result.results ?? []).map((row) => row.name));
      if (REQUIRED_TABLES.some((name) => !names.has(name))) throw new Error("D1_MIGRATION_INCOMPLETE");
    }),
    check("r2", async () => {
      if (!dependencies.traceBucket) throw new Error("R2_BINDING_MISSING");
      await dependencies.traceBucket.list({ limit: 1, prefix: "protected-llm-traces/" });
    }),
    check("drive", async () => {
      const endpoint = configured(dependencies.environment, "GOOGLE_DRIVE_HEALTHCHECK_URL");
      const token = configured(dependencies.environment, "GOOGLE_DRIVE_HEALTHCHECK_TOKEN");
      configured(dependencies.environment, "GOOGLE_DRIVE_VACANCY_FOLDER_URL");
      configured(dependencies.environment, "GOOGLE_DRIVE_VACANCY_FOLDER_TOKEN");
      configured(dependencies.environment, "GOOGLE_DRIVE_RESULT_PDF_URL");
      configured(dependencies.environment, "GOOGLE_DRIVE_RESULT_PDF_TOKEN");
      const response = await fetcher(endpoint, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("DRIVE_HEALTH_UNAVAILABLE");
      const payload = await response.json() as {
        connected?: boolean;
        providerMode?: string;
        permissions?: { readInputs?: boolean; createOutputs?: boolean; manageMembers?: boolean };
      };
      if (payload.connected !== true || payload.providerMode !== "real") throw new Error("DRIVE_HEALTH_NOT_REAL");
      if (payload.permissions?.readInputs !== true || payload.permissions.createOutputs !== true || payload.permissions.manageMembers !== false) {
        throw new Error("DRIVE_PERMISSIONS_INVALID");
      }
    }),
    check("llm", async () => {
      dependencies.validateLlm(dependencies.environment, LLM_CAPABILITIES);
      await providerSmoke(dependencies.environment, fetcher, "LLM");
    }),
    check("stt", async () => {
      configured(dependencies.environment, "ASSEMBLYAI_API_KEY");
      await providerSmoke(dependencies.environment, fetcher, "STT");
    }),
  ]);
  return { ready: checks.every((item) => item.ready), mode: "production-like", checks };
}

export { REQUIRED_TABLES };
