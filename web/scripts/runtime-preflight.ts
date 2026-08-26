import path from "node:path";
import { validateAgentRuntimeConfiguration } from "../server/agent-runtime/configuration.ts";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";
import { loadGoogleOAuthConfiguration } from "../server/google-drive-oauth/configuration.ts";
import { parseGoogleOAuthKeyring } from "../server/google-drive-oauth/crypto.ts";
import { LLM_CAPABILITIES } from "../server/llm/configuration.ts";
import { loadRuntimeConfiguration as validateLlmRuntime } from "../server/llm/runtime-loader.ts";
import { assertMigrationsCurrent } from "../server/storage/migrations.ts";
import { createPostgresClient, probePostgres } from "../server/storage/postgres.ts";
import { candidatePipelineReadiness } from "../server/candidate-pipeline/readiness.ts";

const webRoot = path.resolve(import.meta.dirname, "..");
const configuration = await loadRuntimeConfiguration(webRoot);
const environment = environmentProjection(configuration);
if (environment.AUTH_MODE !== "postgres-password") throw new Error("AUTH_MODE_NOT_READY");
if (environment.E2E_ENVIRONMENT === "production" && (environment.LOCAL_AUTH_USER_ID || environment.LOCAL_AUTH_USER_EMAIL || environment.LOCAL_AUTH_USER_FULL_NAME)) {
  throw new Error("PRODUCTION_TEST_IDENTITY_BYPASS_REJECTED");
}
if (environment.E2E_ENVIRONMENT === "production" && !environment.APP_ORIGIN.startsWith("https://")) throw new Error("AUTH_HTTPS_ORIGIN_REQUIRED");
loadGoogleOAuthConfiguration(environment);
parseGoogleOAuthKeyring(environment.GOOGLE_OAUTH_TOKEN_KEYRING_JSON);
validateAgentRuntimeConfiguration(JSON.parse(environment.AGENT_RUNTIME_CONFIG_JSON));
validateLlmRuntime(environment, LLM_CAPABILITIES);
const candidatePipeline = candidatePipelineReadiness(environment);
if (!candidatePipeline.ready) throw new Error(`CANDIDATE_PIPELINE_NOT_READY:${candidatePipeline.reason}`);
const database = createPostgresClient({ url: environment.DATABASE_URL, max: 1, connectTimeoutSeconds: 5, idleTimeoutSeconds: 5 });
try {
  const probe = await probePostgres(database);
  const migrations = await assertMigrationsCurrent(database, path.join(webRoot, "drizzle-postgres"));
  const activeUsers = await database<{ count: number }[]>`SELECT count(*)::integer AS count FROM auth_users WHERE state='ACTIVE'`;
  if ((activeUsers[0]?.count ?? 0) < 1) throw new Error("AUTH_ACTIVE_HR_REQUIRED");
  console.log(JSON.stringify({ ready: true, runtime: "node", backend: probe.backend, serverMajor: probe.serverMajor,
    migrations: { current: migrations.current, expected: migrations.expected }, credentialFiles: configuration.readiness.credentialFiles,
    auth: { mode: environment.AUTH_MODE, activeUsers: activeUsers[0]?.count ?? 0 },
    candidatePipeline: { routing: candidatePipeline.mode, releaseEvidence: candidatePipeline.mode === "effectful" }, secretsExposed: 0 }));
} finally { await database.end({ timeout: 3 }); }
