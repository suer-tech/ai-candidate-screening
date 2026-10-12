import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import path from "node:path";
import test from "node:test";
import { createPostgresClient, type PostgresClient } from "../server/storage/postgres.ts";
import { migratePostgres } from "../server/storage/migrations.ts";
import { PostgresGoogleDriveOAuthRepository } from "../server/google-drive-oauth/postgres-repository.ts";
import { createProductionCandidateToolExecution } from "../server/candidate-pipeline/production-runtime.ts";
import { executeCandidateTool } from "../server/candidate-pipeline/tool-executor.ts";
import { PostgresVacancyMatrixRepository } from "../server/candidate-pipeline/matrix-postgres-repository.ts";
import { taskFailurePolicy } from "../server/agent-runtime/failure-policy.ts";
import { loadRuntimeConfiguration } from "../server/llm/runtime-loader.ts";
import { matrixResponseSchemaForProfile } from "../server/llm/matrix-response-schema.ts";
import { countOpenAiCompatibleContextTokens } from "../server/llm/token-counting.ts";
import type { ProtectedLlmTrace } from "../server/llm/tracing.ts";
import type { JsonValue } from "../server/llm/value-utils.ts";

// Independent acceptance: WF-023 / OPS-003 plus the owner's adaptive matrix
// output-budget fix. Actual production tool execution, PostgreSQL 16 claims,
// checkpoints/artifacts/traces and a controlled loopback HTTP provider.
// No runtime configuration files, real candidates or external provider traffic.
const providerEndpoint = "https://synthetic-provider.example.invalid/v1/chat/completions";
const workflow = "matrix-v4-rabbit-parallel";
const toolKey = "candidate.matrix-compile/v1";
const credential = "synthetic-matrix-provider-credential";
const base = 8_192;
const safety = 4_096;
const profile = { profile: { experience: "Составление редакционного плана" } };
const sourceFragments = { "vacancy.profile.experience": profile.profile.experience };
const capabilities = {
  ocr: ["document-ocr/v1", "ocr-page/v1"],
  matrix_compiler: ["compile-vacancy-matrix/v1", "vacancy-matrix-draft/v1"],
  matrix_critic: ["critique-vacancy-matrix/v2", "vacancy-matrix-critic/v2"],
  criterion_claim_extraction: ["extract-claims-for-criteria/v1", "candidate-claims/v1"],
  unmapped_signal_discovery: ["discover-unmapped-signals/v1", "candidate-unmapped-signals/v1"],
  evidence_consolidation: ["consolidate-evidence/v1", "candidate-evidence-consolidation/v1"],
  global_conflict_detection: ["detect-global-conflicts/v1", "candidate-global-conflicts/v1"],
  matrix_row_evaluation: ["fill-matrix-rows/v2", "candidate-matrix-rows/v2"],
  matrix_assessment_summary: ["summarize-matrix-assessment/v1", "candidate-assessment-summary/v1"],
  abc_matrix_assessment: ["assess-abc-direction/v2", "candidate-abc-matrix/v1"],
  critical_row_verification: ["verify-critical-row/v1", "candidate-row-verification/v1"],
  candidate_report_composer: ["compose-candidate-report/v2", "candidate-report-composition/v2"],
};
function environment(contextWindow = 128_000) {
  return {
    E2E_ENVIRONMENT: "local", CANDIDATE_PIPELINE_ROUTING: "effectful",
    CANDIDATE_PIPELINE_BUILD_ID: "synthetic-matrix-output-acceptance",
    AGENT_RUNTIME_INTERNAL_TOKEN: "synthetic-internal-token", AGENT_RUNTIME_CONFIG_JSON: "{}",
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client", GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing", GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/integrations/google-drive/oauth/callback",
    GOOGLE_OAUTH_TOKEN_KEYRING_JSON: JSON.stringify({ activeVersion: "synthetic-v1", keys: { "synthetic-v1": Buffer.alloc(32, 7).toString("base64url") } }),
    ROUTERAI_API_KEY: credential, ASSEMBLYAI_API_KEY: "synthetic-unused-key",
    TELEGRAM_BOT_TOKEN: "synthetic-unused-token", TELEGRAM_RECIPIENT_REFS_JSON: "[]",
    ROUTERAI_CONTEXT_WINDOW_TOKENS: String(contextWindow), MATRIX_BATCH_SAFETY_TOKENS: String(safety),
    LLM_RUNTIME_CONFIG_JSON: JSON.stringify({ releaseVersion: "synthetic-matrix-output-v1",
      providers: { controlled: { provider: "synthetic-openai-compatible", endpoint: providerEndpoint,
        secretReference: "ROUTERAI_API_KEY", apiContractVersion: "openai-chat-completions/v1", supportsStructuredOutputs: true } },
      capabilities: Object.fromEntries(Object.entries(capabilities).map(([name, [promptArtifact, responseSchemaArtifact]]) => [name, {
        providerProfile: "controlled", model: "synthetic-model", promptArtifact, responseSchemaArtifact,
        toolSchemaArtifacts: ["no-tools/v1"], generationParameters: { temperature: 0 },
        limits: { maxInputBytes: 1_000_000, maxOutputTokens: base }, timeoutMs: 10_000,
        retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 }, fallbackPolicy: { mode: "disabled" },
      }])),
    }),
  };
}
function draft() {
  return { schemaVersion: "vacancy-matrix-draft/v1", criteria: [{
    temporaryId: "synthetic-criterion-1", sourceRefs: Object.keys(sourceFragments),
    sourceText: profile.profile.experience, interpretation: "Проверить опыт составления редакционного плана",
    category: "competency", required: true, requiredExplanation: "Требование синтетического профиля",
    hardRequired: false, operator: "ALL_OF", atLeast: null, evaluationRule: "Есть проверяемый пример",
    expectedEvidence: ["Пример редакционного плана"], allowedStates: ["Соответствует", "Не соответствует", "Недостаточно данных"],
    decisionEffect: "required-gap", missingDataQuestion: "Как составлялся редакционный план?", interpretationNotes: [], children: [],
  }] };
}
type ProviderRequestBody = {
  messages: { role: string; content: string }[];
  max_tokens?: number;
  max_completion_tokens?: number;
};
type ObservedRequest = {
  profileVersion: string;
  capability: "matrix_compiler" | "matrix_critic";
  maxTokens: number;
  truncated: boolean;
  body: ProviderRequestBody;
};
type Fixture = { candidatePk: number; runId: string; taskId: string; inputVersion: string; profileVersion: string };
async function makeFixture(database: PostgresClient, profileVersion = `synthetic-output-profile-${randomUUID()}`): Promise<Fixture> {
  const suffix = randomUUID();
  const candidatePk = 10_000 + parseInt(suffix.slice(0, 7), 16);
  const runId = `synthetic-output-run-${suffix}`;
  const taskId = `${runId}:matrix`;
  const inputVersion = `${runId}:input`;
  const goalId = `${runId}:goal`;
  const vacancyId = `${runId}:vacancy`;
  const snapshot = `${runId}:snapshot`;
  const now = new Date().toISOString();
  await database`INSERT INTO vacancies(id,normalized_title,record_json) VALUES (${vacancyId},${vacancyId},${JSON.stringify(profile)})`;
  await database`INSERT INTO candidates(id,revision,record_json) VALUES (${candidatePk},1,${JSON.stringify({ vacancyId, name: "Synthetic candidate" })})`;
  await database`INSERT INTO candidate_drive_folders(drive_folder_id,candidate_id,vacancy_folder_id,display_name,parent_path,first_seen_at_utc,last_seen_at_utc)
    VALUES (${`${runId}:folder`},${candidatePk},'synthetic-vacancy-folder','Synthetic','Synthetic/Fixture',${now},${now})`;
  await database`INSERT INTO candidate_material_snapshots(id,candidate_id,fingerprint,complete,stable_comparisons,captured_at_utc)
    VALUES (${snapshot},${candidatePk},'synthetic-fingerprint',true,3,${now})`;
  await database`INSERT INTO candidate_input_versions(id,candidate_id,snapshot_id,sequence,manifest_json,state,created_at_utc)
    VALUES (${inputVersion},${candidatePk},${snapshot},1,'{}','MATERIALS_READY',${now})`;
  await database`INSERT INTO agent_goals(id,candidate_id,goal_type,input_version,profile_version,policy_version,completion_criteria_version,completion_criteria_json,state,revision,created_at)
    VALUES (${goalId},${candidatePk},'candidate-analysis-matrix/v1',${inputVersion},${profileVersion},'synthetic-policy','synthetic-completion','[]','ACTIVE',1,${now})`;
  await database`INSERT INTO agent_runs(id,goal_id,trigger_identity,state,revision,current_plan_version,last_progress_at,workflow_version)
    VALUES (${runId},${goalId},${runId},'ACTIVE',1,1,${now},${workflow})`;
  await database`INSERT INTO agent_plan_versions(id,run_id,version,reason,plan_json,created_at)
    VALUES (${`${runId}:plan`},${runId},1,'synthetic-acceptance','{}',${now})`;
  await database`INSERT INTO agent_tasks(id,run_id,plan_version_id,task_key,tool_key,state,revision,attempt_count,lease_owner,lease_token,lease_expires_at,idempotency_identity,preconditions_json,expected_outputs_json)
    VALUES (${taskId},${runId},${`${runId}:plan`},'matrix',${toolKey},'RUNNING',1,0,'synthetic-worker',1,${Date.now() + 600_000},${taskId},'[]','[]')`;
  for (const kind of ["llmCalls", "externalRequests"]) await database`INSERT INTO agent_budget_ledger(id,run_id,kind,limit_value,used_value,revision)
    VALUES (${`${runId}:${kind}`},${runId},${kind},100,0,1)`;
  return { candidatePk, runId, taskId, inputVersion, profileVersion };
}
async function execute(database: PostgresClient, fixture: Fixture, deliveryAttempt: number, bindings = environment()) {
  const attemptId = `${fixture.taskId}:delivery:${deliveryAttempt}:${randomUUID()}`;
  const [leased] = await database<{ lease_token: number }[]>`UPDATE agent_tasks SET attempt_count=${deliveryAttempt},lease_token=lease_token+1
    WHERE id=${fixture.taskId} RETURNING lease_token`;
  assert.ok(leased);
  const leaseToken = leased.lease_token;
  await database`INSERT INTO agent_attempts(id,task_id,attempt_number,lease_owner,lease_token,state,started_at)
    VALUES (${attemptId},${fixture.taskId},${deliveryAttempt},'synthetic-worker',${leaseToken},'RUNNING',${new Date().toISOString()})`;
  const result = await createProductionCandidateToolExecution({ database, environment: bindings, task: {
    candidatePk: fixture.candidatePk, candidateId: fixture.candidatePk, runId: fixture.runId, id: fixture.taskId, toolKey,
    attemptId, attemptNumber: deliveryAttempt, worker: "synthetic-worker", leaseToken,
    authorizationGrantId: "synthetic-unused-matrix-grant", idempotencyIdentity: fixture.taskId,
    inputVersion: fixture.inputVersion, profileVersion: fixture.profileVersion,
  } });
  const execution = await executeCandidateTool({ toolKey, task: result.task, runtime: result.runtime, environmentBindings: bindings });
  await database`UPDATE agent_attempts SET state=${execution.outcome === "RETRY_LATER" ? "DEFERRED" : execution.outcome},
    finished_at=${new Date().toISOString()},error_code=${execution.errorCode ?? null} WHERE id=${attemptId}`;
  return execution;
}
async function traces(database: PostgresClient, profileVersion: string) {
  const rows = await database<{ content: Buffer }[]>`SELECT content FROM artifact_blobs WHERE scope='protected-llm-traces'
    AND convert_from(content,'UTF8')::jsonb#>>'{correlation,profileVersion}'=${profileVersion} ORDER BY created_at_utc`;
  return rows.map((row) => JSON.parse(row.content.toString("utf8")) as ProtectedLlmTrace);
}
async function claimState(database: PostgresClient, profileVersion: string) {
  const [row] = await database<{ state: string; attempt: number; terminal_error_code: string | null }[]>`SELECT state,attempt,terminal_error_code
    FROM vacancy_matrix_compilations WHERE profile_version=${profileVersion} AND workflow_identity=${workflow}`;
  return row;
}
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/v1/chat/completions`;
}
function assertTraceAlignment(observed: ObservedRequest[], saved: ProtectedLlmTrace[]) {
  assert.equal(saved.length, observed.length, "every controlled provider exchange must have an actual persisted protected trace");
  for (let index = 0; index < observed.length; index++) {
    const request = observed[index]; const trace = saved[index];
    assert.equal(trace.capability, request.capability);
    assert.equal((trace.effectiveConfig.limits as Record<string, JsonValue>).maxOutputTokens, request.maxTokens,
      "protected effective configuration must match the actual HTTP output budget");
    assert.equal(trace.effectiveConfig.retryPolicy.maxAttempts, 1, "adaptive growth must not multiply nested retries");
    assert.equal(trace.execution.outcome, request.truncated ? "failed" : "succeeded",
      "each successful compiler/critic response must validate successfully before its matrix is published");
  }
}

test("shared matrix compiler increases a bounded output budget at the real production tool boundary", async (context) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "TEST_DATABASE_URL must identify a prepared isolated synthetic PostgreSQL 16 database");
  const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
  assert.match(databaseName, /^(?:hh_matrix_output_acceptance|hh_fanout_artifact_acceptance)(?:_|$)/,
    "refuse migrations and synthetic fixtures outside the explicit acceptance database");
  const database = createPostgresClient({ url, max: 4, connectTimeoutSeconds: 5 });
  const observed: ObservedRequest[] = [];
  const minimums = new Map<string, number>();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.headers.authorization, `Bearer ${credential}`);
      const chunks: Buffer[] = [];
      for await (const part of request) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProviderRequestBody;
      const userMessage = body.messages.findLast((message) => message.role === "user");
      assert.ok(userMessage);
      const user = JSON.parse(userMessage.content) as { profileVersion: string; draft?: JsonValue };
      const capability = user.draft ? "matrix_critic" : "matrix_compiler";
      const maxTokens = Number(body.max_tokens ?? body.max_completion_tokens);
      const truncated = capability === "matrix_compiler" && maxTokens < (minimums.get(user.profileVersion) ?? 1);
      observed.push({ profileVersion: user.profileVersion, capability, maxTokens, truncated, body });
      const output = capability === "matrix_compiler" ? draft() : {
        schemaVersion: "vacancy-matrix-critic/v2", decision: "PASS", changes: [], successor: draft(), interpretationNotes: [],
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `synthetic-provider-${observed.length}`, model: "synthetic-model",
        choices: [{ finish_reason: truncated ? "length" : "stop", message: { role: "assistant",
          content: truncated ? '{"schemaVersion":"vacancy-matrix-draft/v1","criteria":[' : JSON.stringify(output) } }],
        usage: { prompt_tokens: 100, completion_tokens: truncated ? maxTokens : 200 },
      }));
    } catch {
      response.writeHead(500, { "content-type": "application/json" }); response.end('{"error":"SYNTHETIC_PROVIDER_CONTRACT_FAILED"}');
    }
  });
  const nativeFetch = globalThis.fetch;
  const originalStructured = process.env.ROUTERAI_STRUCTURED_OUTPUTS;
  try {
    const [metadata] = await database<{ database: string; major: number }[]>`SELECT current_database() AS database,
      floor(current_setting('server_version_num')::numeric/10000)::integer AS major`;
    assert.equal(metadata.database, databaseName); assert.equal(metadata.major, 16);
    await migratePostgres(database, path.resolve(import.meta.dirname, "../drizzle-postgres"));
    const oauth = new PostgresGoogleDriveOAuthRepository(database);
    const connection = await oauth.getConnection();
    if (connection) assert.equal(connection.id, "synthetic-matrix-output-oauth", "only this synthetic fixture's connection may be present");
    else await oauth.saveConnection({ id: "synthetic-matrix-output-oauth", state: "CONNECTED", ownerSubject: "synthetic-subject",
      ownerEmail: "synthetic@example.invalid", scopes: ["synthetic-drive-scope"], rootFolderId: "synthetic-root", rootFolderName: "Synthetic",
      deploymentMode: "testing", refreshTokenEnvelope: { algorithm: "AES-256-GCM", keyVersion: "synthetic-v1", ciphertext: "synthetic", nonce: "synthetic", tag: "synthetic" },
      connectedAt: new Date().toISOString(), revision: 1 });
    const localEndpoint = await listen(server);
    process.env.ROUTERAI_STRUCTURED_OUTPUTS = "true";
    globalThis.fetch = (input, init) => {
      assert.equal(String(input), providerEndpoint, "all nonfixture external traffic, including Drive and Telegram, is forbidden");
      // Production requires an HTTPS provider profile. Only transport routing is
      // adapted; HTTP parsing, provider envelopes and all application code are real.
      return nativeFetch(localEndpoint, init);
    };
    const repository = new PostgresVacancyMatrixRepository(database, workflow);
    const requests = (profileVersion: string) => observed.filter((entry) => entry.profileVersion === profileVersion);

    await context.test("a truncated first compiler answer is never published; shared claim 2 uses 16k for compiler and critic", async () => {
      const fixture = await makeFixture(database); minimums.set(fixture.profileVersion, 16_384);
      const first = await execute(database, fixture, 7);
      assert.equal(first.outcome, "FAILED"); assert.equal(first.errorCode, "LLM_CAPABILITY_FAILED:output_length_exceeded");
      assert.equal(await repository.readMatrix(fixture.profileVersion), null, "a partial compiler answer must never become a shared matrix");
      assert.equal((await claimState(database, fixture.profileVersion)).attempt, 1);
      assert.equal(requests(fixture.profileVersion)[0].maxTokens, base, "delivery attempt 7 must not inflate shared compilation attempt 1");
      const second = await execute(database, fixture, 8);
      assert.equal(second.outcome, "SUCCEEDED", "the next shared compilation claim must receive enough output budget to recover");
      const published = await repository.readMatrix(fixture.profileVersion);
      assert.ok(published); assert.equal(published.matrix.criteria.length, 1);
      assert.equal(published.matrix.criteria[0].sourceText, profile.profile.experience);
      assert.deepEqual(published.matrix.criteria[0].sourceRefs, Object.keys(sourceFragments));
      assert.deepEqual(requests(fixture.profileVersion).map((request) => [request.capability, request.maxTokens]),
        [["matrix_compiler", 8_192], ["matrix_compiler", 16_384], ["matrix_critic", 16_384]]);
      assert.equal((await claimState(database, fixture.profileVersion)).attempt, 2);
      assertTraceAlignment(requests(fixture.profileVersion), await traces(database, fixture.profileVersion));
      for (const attempt of [1, 2, 3]) assert.deepEqual(taskFailurePolicy(toolKey, "LLM_CAPABILITY_FAILED:output_length_exceeded", attempt),
        { retry: attempt < 3, delayMs: attempt === 1 ? 5_000 : attempt === 2 ? 15_000 : 0, maxAttempts: 3 });
    });

    await context.test("shared claim 6 is capped at 32k despite a new delivery attempt 1, then cached matrix reuse makes no call", async () => {
      const fixture = await makeFixture(database); minimums.set(fixture.profileVersion, 32_768);
      for (let attempt = 1; attempt <= 5; attempt++) {
        const ownerId = `${fixture.runId}:previous-owner:${attempt}`;
        const claim = await repository.claimCompilation({ profileVersion: fixture.profileVersion, ownerId, now: new Date(), leaseMs: 60_000, allowRetry: true });
        assert.equal(claim.attempt, attempt);
        await repository.failCompilation({ profileVersion: fixture.profileVersion, ownerId, fencingToken: claim.fencingToken, errorCode: "LLM_CAPABILITY_FAILED:output_length_exceeded" });
      }
      assert.equal((await execute(database, fixture, 1)).outcome, "SUCCEEDED");
      assert.deepEqual(requests(fixture.profileVersion).map((request) => request.maxTokens), [32_768, 32_768]);
      assert.equal((await claimState(database, fixture.profileVersion)).attempt, 6);
      const before = await repository.readMatrix(fixture.profileVersion);
      const another = await makeFixture(database, fixture.profileVersion);
      assert.equal((await execute(database, another, 99)).outcome, "SUCCEEDED");
      assert.equal(requests(fixture.profileVersion).length, 2, "cached matrices do not spend provider calls or grow the claim counter");
      assert.equal((await claimState(database, fixture.profileVersion)).attempt, 6);
      assert.equal((await repository.readMatrix(fixture.profileVersion))?.checksum, before?.checksum);
      assertTraceAlignment(requests(fixture.profileVersion), await traces(database, fixture.profileVersion));
    });

    await context.test("WAITING does not count as another compilation attempt or request; released owner permits 16k retry", async () => {
      const owner = await makeFixture(database);
      const claim = await repository.claimCompilation({ profileVersion: owner.profileVersion, ownerId: owner.runId, now: new Date(), leaseMs: 60_000 });
      const waiter = await makeFixture(database, owner.profileVersion); minimums.set(owner.profileVersion, 16_384);
      const waiting = await execute(database, waiter, 77);
      assert.equal(waiting.outcome, "RETRY_LATER"); assert.equal(waiting.errorCode, "MATRIX_COMPILATION_WAITING");
      assert.equal(requests(owner.profileVersion).length, 0); assert.equal((await claimState(database, owner.profileVersion)).attempt, 1);
      await repository.failCompilation({ profileVersion: owner.profileVersion, ownerId: owner.runId, fencingToken: claim.fencingToken, errorCode: "LLM_CAPABILITY_FAILED:output_length_exceeded" });
      assert.equal((await execute(database, waiter, 78)).outcome, "SUCCEEDED");
      assert.deepEqual(requests(owner.profileVersion).map((request) => request.maxTokens), [16_384, 16_384]);
      assert.equal((await claimState(database, owner.profileVersion)).attempt, 2);
      assertTraceAlignment(requests(owner.profileVersion), await traces(database, owner.profileVersion));
    });

    await context.test("context window clamps the grown budget and the HTTP request equals the effective trace configuration", async () => {
      const fixture = await makeFixture(database);
      const claim = await repository.claimCompilation({ profileVersion: fixture.profileVersion, ownerId: fixture.runId, now: new Date(), leaseMs: 60_000 });
      await repository.failCompilation({ profileVersion: fixture.profileVersion, ownerId: fixture.runId, fencingToken: claim.fencingToken, errorCode: "LLM_CAPABILITY_FAILED:output_length_exceeded" });
      const userContent = { profileVersion: fixture.profileVersion, canonicalProfile: profile, sourceFragments } as unknown as JsonValue;
      const initialConfig = loadRuntimeConfiguration(environment(), ["matrix_compiler"]).resolve("matrix_compiler");
      const config = { ...initialConfig, responseSchema: matrixResponseSchemaForProfile("matrix_compiler", initialConfig.responseSchema, userContent) };
      const contextWindow = countOpenAiCompatibleContextTokens({ config, userContent, safetyTokens: safety }) + 3_000;
      const result = await execute(database, fixture, 1, environment(contextWindow));
      assert.equal(result.outcome, "SUCCEEDED");
      const saved = await traces(database, fixture.profileVersion); assertTraceAlignment(requests(fixture.profileVersion), saved);
      assert.equal(requests(fixture.profileVersion).length, 2);
      const compiler = requests(fixture.profileVersion)[0];
      assert.ok(compiler.maxTokens > base && compiler.maxTokens < 16_384, "compiler budget must grow within the available context, rather than staying at 8192 or overrunning 16k");
      for (const trace of saved) {
        const total = countOpenAiCompatibleContextTokens({ config: trace.effectiveConfig, userContent: trace.inputSnapshot.context, safetyTokens: safety });
        assert.ok(total <= contextWindow, "prompt/schema/user/output/safety must fit the configured model context window");
        const current = Number((trace.effectiveConfig.limits as Record<string, JsonValue>).maxOutputTokens);
        const available = current + contextWindow - total;
        assert.equal(current, Math.min(16_384, available), "growth must stop at the available context budget");
      }
    });

    await context.test("context too small for the base budget fails before any provider request and publishes nothing", async () => {
      const fixture = await makeFixture(database);
      const result = await execute(database, fixture, 1, environment(5_000));
      assert.equal(result.outcome, "FAILED"); assert.equal(result.errorCode, "MATRIX_CONTEXT_BUDGET_EXCEEDED");
      assert.equal(requests(fixture.profileVersion).length, 0);
      assert.equal(await repository.readMatrix(fixture.profileVersion), null);
      assert.equal((await claimState(database, fixture.profileVersion)).state, "FAILED");
    });
  } finally {
    globalThis.fetch = nativeFetch;
    if (originalStructured === undefined) delete process.env.ROUTERAI_STRUCTURED_OUTPUTS;
    else process.env.ROUTERAI_STRUCTURED_OUTPUTS = originalStructured;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.end({ timeout: 3 });
    // Immutable published matrix rows are deliberately retained in this isolated
    // synthetic database for inspection; its disposable owner removes the DB.
  }
});
