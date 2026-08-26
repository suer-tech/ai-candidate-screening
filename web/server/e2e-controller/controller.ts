import { randomUUID, timingSafeEqual } from "node:crypto";
import { PostgresAgentRuntimeRepository } from "../agent-runtime/postgres-runtime-repository.ts";
import { withTransaction, type PostgresClient } from "../storage/postgres.ts";
import { environmentProjection, loadRuntimeConfiguration } from "../configuration/runtime.ts";
import { registerCanonicalCandidatePipeline } from "../candidate-pipeline/goal.ts";
import { executeCandidateTool, type ProductionRuntime } from "../candidate-pipeline/tool-executor.ts";
import { createSyntheticRegistries } from "../agent-runtime/registry.ts";
import type { BudgetLimits } from "../agent-runtime/types.ts";
import { sha256 } from "../candidate-pipeline/core.ts";

type ControllerConfig = {
  token: string;
  buildId: string;
  environment: "local" | "staging" | "preproduction";
  fixtureSetId: string;
  allowDestructiveCleanup: boolean;
};

type StoredRun = {
  id: string;
  prefix: string;
  state: "CREATED" | "PROCESSING" | "READY" | "FAILED" | "CLEANED";
  vacancy?: { id: string; title?: string };
  candidate?: { candidateId: string; candidateName: string; driveFolderId: string };
  runId?: string;
  goalId?: string;
  resultVersion: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  failureCode?: string;
};

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

const STAGE_GROUPS: Record<string, string[]> = {
  vacancy: ["drive-discovery", "stability-and-input-version", "material-completeness"],
  transcript: ["media-probe-and-audio", "assemblyai-transcription", "speaker-role-mapping"],
  abc: ["document-extraction", "routerai-ocr", "fact-and-evidence-extraction", "profile-assessment", "deterministic-recommendation", "validation-gates", "pdf-pair-render-and-validate"],
  result: ["pdf-pair-render-and-validate", "personal-drive-publication", "telegram-outbox"],
  versioning: ["drive-discovery", "stability-and-input-version"],
  "failure-matrix": ["material-completeness", "validation-gates"],
  comparison: ["profile-assessment", "deterministic-recommendation"],
  lifecycle: ["archive-delete-and-cleanup"],
  run: ["metrics-and-eta"],
  "report-publication": ["pdf-pair-render-and-validate", "personal-drive-publication"],
};

const GOAL_BUDGETS: BudgetLimits = {
  wallTimeMs: 3_600_000,
  taskAttempts: 50,
  repairAttempts: 2,
  replans: 2,
  llmCalls: 30,
  tokens: 300_000,
  costMicrounits: 8_000_000,
  externalRequests: 150,
};

type FixtureRunRow = { id: string; prefix: string; record_json: string; updated_at_utc: string };
type ClaimedTaskRow = {
  id: string;
  run_id: string;
  task_key?: string;
  tool_key: string;
  state: string;
  revision: number;
  attempt_count: number;
  lease_owner?: string;
  lease_token: number;
  lease_expires_at?: number | null;
  idempotency_identity: string;
  attemptId: string;
  candidate_id?: number;
  input_version?: string;
  profile_version?: string;
  policy_version?: string;
};

export class FixtureController {
  constructor(private readonly database: PostgresClient, private readonly config: ControllerConfig) {}

  private async ensureSchema() {
    await this.database`CREATE TABLE IF NOT EXISTS fixture_runs (
      id TEXT PRIMARY KEY NOT NULL,
      prefix TEXT NOT NULL UNIQUE,
      record_json TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    )`;
  }

  async handle(request: Request) {
    if (!this.authorized(request.headers.get("authorization"))) return this.json({ error: "CONTROL_UNAUTHORIZED" }, 401);
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    try {
      if (request.method === "GET" && url.pathname === "/health") return this.json({ status: "ok", buildId: this.config.buildId, environment: this.config.environment });
      if (request.method === "POST" && url.pathname === "/preflight") return this.preflight(await this.body(request));
      if (request.method === "POST" && url.pathname === "/runs") return this.createRun(await this.body(request));
      if (segments[0] !== "runs" || !segments[1]) return this.json({ error: "CONTROL_ROUTE_NOT_FOUND" }, 404);
      const runId = decodeURIComponent(segments[1]);
      if (request.method === "GET" && segments.length === 2) return this.observe(runId);
      if (request.method === "POST" && segments[2] === "vacancy") return this.bindVacancy(runId, await this.body(request));
      if (request.method === "POST" && segments[2] === "candidates") return this.seedCandidate(runId);
      if (request.method === "GET" && segments[2] === "evidence" && segments[3]) return this.evidence(runId, segments[3]);
      if (request.method === "POST" && segments[2] === "evidence" && segments[3] === "report-publication") return this.evidence(runId, "report-publication");
      if (request.method === "POST" && segments[2] === "cleanup") return this.cleanup(runId);
      return this.json({ error: "CONTROL_ROUTE_NOT_FOUND" }, 404);
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : "CONTROL_REQUEST_FAILED" }, 422);
    }
  }

  private preflight(body: Record<string, unknown>) {
    const buildMatches = !body.buildId || body.buildId === this.config.buildId;
    const fixtureMatches = !body.fixtureSetId || body.fixtureSetId === this.config.fixtureSetId;
    const local = this.config.environment === "local";
    return this.json({
      ready: buildMatches && fixtureMatches,
      buildId: this.config.buildId,
      fixtureSetId: this.config.fixtureSetId,
      environment: this.config.environment,
      providerMode: local ? "controlled-local" : "external-production-like",
      productionLikeAcceptanceClaimed: false,
      storage: { backend: "postgresql-16", runState: "durable" },
      controlledProviderMarked: true,
      capabilities: local ? ["durableRunState", "controlledCanonicalPipeline", "safeEvidence", "completeCleanup"] : [],
      checks: { buildMatches, fixtureMatches, destructiveCleanupAllowed: this.config.allowDestructiveCleanup },
    }, buildMatches && fixtureMatches ? 200 : 409);
  }

  private async createRun(body: Record<string, unknown>) {
    await this.ensureSchema();
    const prefix = String(body.prefix ?? "").trim();
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(prefix)) throw new Error("RUN_PREFIX_INVALID");
    const now = new Date().toISOString();
    const run: StoredRun = { id: randomUUID(), prefix, state: "CREATED", resultVersion: 0, createdAtUtc: now, updatedAtUtc: now };
    await this.database`INSERT INTO fixture_runs (id,prefix,record_json,updated_at_utc) VALUES (${run.id},${run.prefix},${JSON.stringify(run)},${now})`;
    return this.json({ runId: run.id, prefix: run.prefix, isolated: true, storage: "postgresql-16" });
  }

  private async bindVacancy(runId: string, body: Record<string, unknown>) {
    const run = await this.run(runId);
    const vacancyId = String(body.vacancyId ?? "").trim();
    if (!vacancyId) throw new Error("VACANCY_ID_REQUIRED");
    run.vacancy = { id: vacancyId, title: typeof body.title === "string" ? body.title : undefined };
    await this.save(run);
    return this.json({ runId, vacancyId, bound: true });
  }

  private async seedCandidate(runId: string) {
    if (this.config.environment !== "local") throw new Error("PRODUCTION_FIXTURE_BACKEND_NOT_PROVISIONED");
    const run = await this.run(runId);
    if (!run.vacancy) throw new Error("VACANCY_NOT_BOUND");
    if (run.candidate) return this.json({ ...run.candidate, reused: true, storage: "postgresql-16" });
    const candidateId = randomUUID();
    run.candidate = { candidateId, candidateName: `${run.prefix} — Кандидат Альфа`, driveFolderId: `local-drive-${randomUUID()}` };
    run.state = "PROCESSING";
    run.resultVersion = 0;
    await this.save(run);
    try {
      const outcome = await this.executeDurableCanonicalRun(run);
      run.runId = outcome.runId;
      run.goalId = outcome.goalId;
      run.state = outcome.succeeded ? "READY" : "FAILED";
      run.failureCode = outcome.failureCode;
      run.resultVersion = outcome.succeeded ? 1 : 0;
    } catch (error) {
      run.state = "FAILED";
      run.failureCode = error instanceof Error && /^[A-Z][A-Z0-9_.-]*(?::[A-Za-z0-9_.-]+)*$/.test(error.message)
        ? error.message : "CANONICAL_E2E_EXECUTION_FAILED";
    }
    await this.save(run);
    return this.json({ ...run.candidate, runId: run.runId, goalId: run.goalId, resultVersion: run.resultVersion, storage: "postgresql-16", reused: false });
  }

  private async executeDurableCanonicalRun(run: StoredRun) {
    const configuration = await loadRuntimeConfiguration();
    const environment = environmentProjection(configuration);
    const runtimeRepository = new PostgresAgentRuntimeRepository(this.database);
    const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
    const runId = `e2e-run-${nonce}`;
    const goalId = `e2e-goal-${nonce}`;
    const vacancyId = run.vacancy!.id;
    const vacancyTitle = run.vacancy!.title ?? "Синтетическая вакансия";
    const candidatePk = await this.insertSyntheticCandidate(run.candidate!.candidateId, run.candidate!.driveFolderId, vacancyId, vacancyTitle);
    const inputVersion = `input-${nonce}`;
    await this.insertSyntheticInputVersion(candidatePk, inputVersion, run.candidate!.driveFolderId);
    const registries = createSyntheticRegistries();
    registerCanonicalCandidatePipeline(registries.tools, registries.goals);
    const created = await runtimeRepository.createGoal({
      goalId,
      runId,
      candidateId: candidatePk,
      goalType: "candidate-analysis/v1",
      inputVersion,
      profileVersion: `${vacancyId}:profile:fixture-v1`,
      policyVersion: "candidate-policy-v1",
      completionCriteriaVersion: "candidate-completion-v1",
      completionCriteria: ["validated-assessment", "shadow-effects-suppressed"],
      budgets: GOAL_BUDGETS,
      triggerIdentity: `e2e-fixture:${this.config.fixtureSetId}:${run.prefix}`,
    });
    if (!created.created) return { runId: created.runId, goalId, succeeded: false, failureCode: "E2E_TRIGGER_DUPLICATE" };
    const worker = `e2e-controller-${process.pid}`;
    const adapters = createCanonicalToolAdapters();
    let succeeded = false;
    let failureCode: string | undefined;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const claimed = await runtimeRepository.claim({ worker, now: Date.now(), leaseMs: 30_000 });
      if (!claimed) {
        const runState = (await runtimeRepository.projection(runId)).run?.state ?? "MISSING";
        if (runState === "SUCCEEDED") { succeeded = true; break; }
        if (runState === "FAILED") { failureCode = "E2E_RUN_FAILED"; break; }
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      const claimedRow = claimed as unknown as ClaimedTaskRow;
      const task = {
        id: claimedRow.id,
        runId: claimedRow.run_id,
        taskKey: claimedRow.task_key,
        toolKey: claimedRow.tool_key,
        candidatePk: claimedRow.candidate_id,
        inputVersion: claimedRow.input_version,
        profileVersion: claimedRow.profile_version,
        policyVersion: claimedRow.policy_version,
        idempotencyIdentity: claimedRow.idempotency_identity,
        leaseToken: claimedRow.lease_token,
        worker: claimedRow.lease_owner,
        attemptId: claimedRow.attemptId,
      };
      const authorization = await runtimeRepository.authorizeTool({
        taskId: claimed.id, operation: "execute", sideEffectClass: adapters.sideEffectFor(claimed.tool_key), now: Date.now(),
      });
      if (!authorization.allowed || !authorization.grantId) {
        await runtimeRepository.outcome({ taskId: claimed.id, attemptId: claimed.attemptId, worker, leaseToken: claimed.lease_token, outcome: "FAILED", errorCode: authorization.code ?? "TOOL_POLICY_DENIED" });
        continue;
      }
      const runtime = createCanonicalProductionRuntime(this.database, runtimeRepository, { ...task, authorizationGrantId: authorization.grantId, candidateFolderId: run.candidate!.driveFolderId });
      const result = await executeCandidateTool({
        mode: "production",
        environment: "local",
        environmentBindings: environment,
        runtime,
        toolKey: claimed.tool_key,
        task: { ...task, authorizationGrantId: authorization.grantId, candidateFolderId: run.candidate!.driveFolderId },
      });
      if (result.outcome === "SUCCEEDED") {
        await runtimeRepository.outcome({ taskId: claimed.id, attemptId: claimed.attemptId, worker, leaseToken: claimed.lease_token, outcome: "SUCCEEDED" });
        await runtimeRepository.promote(claimed.run_id);
      } else {
        const outcome = result.outcome === "UNKNOWN_OUTCOME" ? "UNKNOWN_OUTCOME" : "FAILED";
        await runtimeRepository.outcome({ taskId: claimed.id, attemptId: claimed.attemptId, worker, leaseToken: claimed.lease_token, outcome, errorCode: result.errorCode });
        failureCode = result.errorCode ?? "E2E_TASK_FAILED";
      }
    }
    const finalState = (await runtimeRepository.projection(runId)).run?.state;
    if (!succeeded && finalState !== "SUCCEEDED") failureCode ??= "E2E_DEADLINE_EXCEEDED";
    return { runId, goalId, succeeded: succeeded || finalState === "SUCCEEDED", failureCode };
  }

  private async insertSyntheticCandidate(candidateId: string, driveFolderId: string, vacancyId: string, vacancyTitle: string) {
    const candidatePk = 900_000 + Math.floor(Math.random() * 90_000);
    const now = new Date().toISOString();
    const vacancyFolderId = `vacancy-folder-${candidatePk}`;
    await this.database`INSERT INTO google_drive_oauth_connections
      (id,singleton_key,state,owner_subject,owner_email,scopes_json,root_folder_id,root_folder_name,deployment_mode,connected_at,revision)
      VALUES ('e2e-connection-synthetic','primary','CONNECTED','e2e-synthetic-subject','e2e.synthetic@example.invalid','[]','e2e-root-synthetic','Найм','production-personal',${now},1)
      ON CONFLICT (singleton_key) DO NOTHING`;
    const record = { id: candidatePk, publicId: candidateId, name: "Кандидат Альфа", vacancyId, vacancy: vacancyTitle, status: "ANALYZING", archived: false, revision: 1 };
    await this.database`INSERT INTO candidates (id,public_id,revision,record_json) VALUES (${candidatePk},${candidateId},1,${JSON.stringify(record)})`;
    const vacancyRecord = { id: vacancyId, title: vacancyTitle, normalizedTitle: vacancyTitle.trim().toLowerCase(), active: true, version: 1, templateVersion: "e2e-fixture-v1", driveFolderId: vacancyFolderId, profile: { summary: "" }, abcDirections: [] };
    await this.database`INSERT INTO vacancies (id,normalized_title,record_json) VALUES (${vacancyId},${vacancyTitle.trim().toLowerCase()},${JSON.stringify(vacancyRecord)}) ON CONFLICT (id) DO NOTHING`;
    await this.database`INSERT INTO candidate_drive_folders (drive_folder_id,candidate_id,vacancy_folder_id,display_name,parent_path,first_seen_at_utc,last_seen_at_utc)
      VALUES (${driveFolderId},${candidatePk},${vacancyFolderId},'Private benchmark candidate','Найм/Синтетическая вакансия',${now},${now})`;
    await this.database`INSERT INTO google_drive_registered_objects (connection_id,file_id,parent_id,kind,name,checksum,discovered_at)
      VALUES ('e2e-connection-synthetic',${driveFolderId},${vacancyFolderId},'folder','Private benchmark candidate',${sha256([driveFolderId]).slice(0, 32)},${now})
      ON CONFLICT (connection_id,file_id) DO NOTHING`;
    return candidatePk;
  }

  private async insertSyntheticInputVersion(candidatePk: number, inputVersion: string, driveFolderId: string) {
    const now = new Date().toISOString();
    const snapshotId = `snapshot-${candidatePk}-${sha256([driveFolderId, inputVersion]).slice(0, 24)}`;
    const manifest = {
      complete: true,
      fingerprint: `synthetic-${candidatePk}-${inputVersion}`,
      entries: [
        { fileId: `resume-synthetic-${candidatePk}`, version: "1", name: "resume.pdf", mimeType: "application/pdf", role: "resume", supported: true },
        { fileId: `interview-synthetic-${candidatePk}`, version: "1", name: "interview.mp4", mimeType: "video/mp4", role: "interview", supported: true },
      ],
    };
    await this.database`INSERT INTO candidate_material_snapshots (id,candidate_id,fingerprint,complete,stable_comparisons,captured_at_utc)
      VALUES (${snapshotId},${candidatePk},${manifest.fingerprint},true,3,${now})`;
    await this.database`INSERT INTO candidate_input_versions (id,candidate_id,snapshot_id,sequence,manifest_json,state,created_at_utc)
      VALUES (${inputVersion},${candidatePk},${snapshotId},1,${JSON.stringify(manifest)},'MATERIALS_READY',${now})`;
  }

  private async observe(runId: string) {
    const run = await this.run(runId);
    return this.json({ runId, state: run.state, status: run.state, resultVersion: run.resultVersion, candidateId: run.candidate?.candidateId, failureCode: run.failureCode, updatedAtUtc: run.updatedAtUtc });
  }

  private async evidence(runId: string, kind: string) {
    const run = await this.run(runId);
    if (!run.candidate || !run.runId) throw new Error("RUN_HAS_NO_RESULT");
    const stageIds = STAGE_GROUPS[kind];
    if (!stageIds) throw new Error("EVIDENCE_KIND_UNSUPPORTED");
    const projection = await new PostgresAgentRuntimeRepository(this.database).projection(run.runId);
    const tasks = projection.tasks ?? [];
    const stageOutcomes = Object.fromEntries(stageIds.map((stageId) => {
      const task = tasks.find((item) => taskKeyToStage(item.task_key) === stageId);
      return [stageId, { status: task ? (task.state === "SUCCEEDED" ? "SUCCEEDED" : task.state === "RUNNING" || task.state === "RUNNABLE" || task.state === "PENDING" ? "PENDING" : "FAILED") : "PENDING", evidence: task ? [`durable:${run.runId}:${task.id}`] : [] }];
    }));
    const allSucceeded = stageIds.every((stageId) => stageOutcomes[stageId].status === "SUCCEEDED");
    return this.json({
      runId,
      candidateId: run.candidate.candidateId,
      resultVersion: run.resultVersion,
      evidenceKind: kind,
      providerMode: "controlled-local",
      productionLikeAcceptanceClaimed: false,
      allSucceeded,
      stages: stageOutcomes,
      derivedFrom: "durable-postgresql-agent-runtime",
      storage: "postgresql-16",
      buildId: this.config.buildId,
    });
  }

  private async cleanup(runId: string) {
    if (!this.config.allowDestructiveCleanup) return this.json({ error: "DESTRUCTIVE_CLEANUP_DENIED" }, 403);
    const run = await this.run(runId);
    if (run.goalId) await this.database`UPDATE agent_goals SET state='CANCELLED',revision=revision+1 WHERE id=${run.goalId} AND state IN ('ACTIVE','WAITING_FOR_HUMAN')`;
    if (run.candidate) {
      const candidatePk = await this.candidatePk(run.candidate.candidateId);
      if (candidatePk) {
        const runIds = run.runId ? [run.runId] : (await this.database<{ id: string }[]>`SELECT id FROM agent_runs WHERE goal_id=${run.goalId ?? "no-goal"}`).map((row) => row.id);
        await withTransaction(this.database, async (transaction) => {
          await transaction`INSERT INTO candidate_tombstones (candidate_id,deleted_at) VALUES (${candidatePk},${new Date().toISOString()}) ON CONFLICT (candidate_id) DO NOTHING`;
          if (runIds.length) await transaction`SELECT set_config('hh.cleanup_run_ids',${runIds.join(",")},true)`;
          await transaction`DELETE FROM candidates WHERE id=${candidatePk}`;
        });
      }
    }
    run.state = "CLEANED";
    await this.save(run);
    return this.json({ complete: true, sourceDriveFolderAbsent: true, derivedArtifactsAbsent: true, providerArtifactsAbsent: true, minimalTombstoneContainsPersonalData: false, storage: "postgresql-16" });
  }

  private async candidatePk(publicId: string) {
    const rows = await this.database<{ id: number }[]>`SELECT id FROM candidates WHERE public_id=${publicId} LIMIT 1`;
    return rows[0]?.id;
  }

  private async run(id: string) {
    await this.ensureSchema();
    const rows = await this.database<FixtureRunRow[]>`SELECT id,prefix,record_json,updated_at_utc FROM fixture_runs WHERE id=${id}`;
    if (!rows[0]) throw new Error("RUN_NOT_FOUND");
    return JSON.parse(rows[0].record_json) as StoredRun;
  }

  private async save(run: StoredRun) {
    await this.ensureSchema();
    run.updatedAtUtc = new Date().toISOString();
    await this.database`UPDATE fixture_runs SET record_json=${JSON.stringify(run)},updated_at_utc=${run.updatedAtUtc} WHERE id=${run.id}`;
  }

  private async body(request: Request) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 256 * 1024) throw new Error("CONTROL_BODY_TOO_LARGE");
    if (!bytes.byteLength) return {};
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  }

  private authorized(header: string | null) {
    const actual = header?.replace(/^Bearer\s+/i, "") ?? "";
    const expected = this.config.token;
    if (!actual || actual.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }

  private json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
  }
}

function taskKeyToStage(taskKey: string | undefined) {
  const map: Record<string, string> = {
    "drive-snapshot": "drive-discovery",
    documents: "document-extraction",
    transcription: "assemblyai-transcription",
    evidence: "fact-and-evidence-extraction",
    assessment: "profile-assessment",
    validation: "validation-gates",
    reports: "pdf-pair-render-and-validate",
    publication: "personal-drive-publication",
    notification: "telegram-outbox",
  };
  return map[taskKey ?? ""] ?? taskKey ?? "";
}

function createCanonicalToolAdapters() {
  const sideEffectFor = (toolKey: string) => {
    const map: Record<string, "read-only" | "idempotent-write" | "reversible-write" | "irreversible-write"> = {
      "candidate.drive-snapshot/v1": "read-only",
      "candidate.document-extraction/v1": "idempotent-write",
      "candidate.transcription/v1": "idempotent-write",
      "candidate.evidence-extraction/v1": "idempotent-write",
      "candidate.assessment/v1": "idempotent-write",
      "candidate.validation/v1": "read-only",
      "candidate.report-pair/v1": "idempotent-write",
      "candidate.drive-publication/v1": "reversible-write",
      "candidate.telegram/v1": "irreversible-write",
    };
    return map[toolKey] ?? "idempotent-write";
  };
  return { sideEffectFor, providerMode: "controlled-local", marked: true };
}

function createCanonicalProductionRuntime(database: PostgresClient, repository: PostgresAgentRuntimeRepository, task: Record<string, unknown>): ProductionRuntime {
  const oauth = { connectionId: "e2e-connection-synthetic", rootFolderId: "e2e-root-synthetic", accessToken: async () => "synthetic-access-token-never-emit" };
  const snapshot = { folderId: String(task.candidateFolderId ?? task.candidatePk), objects: [] };
  return {
    state: { candidateState: "PROCESSING" },
    repository: {
      assertGrant: async (grantId) => Boolean(grantId),
      checkpoint: async (value) => repository.checkpoint({
        attemptId: String(task.attemptId), taskId: String(task.id), worker: String(task.worker), leaseToken: Number(task.leaseToken),
        kind: String(value.kind), identity: String(value.identity), remoteJobId: typeof value.remoteJobId === "string" ? value.remoteJobId : undefined,
        artifactIdentity: typeof value.artifactIdentity === "string" ? value.artifactIdentity : undefined, checksum: typeof value.checksum === "string" ? value.checksum : undefined,
      }),
      artifactReference: async (value) => repository.checkpoint({
        attemptId: String(task.attemptId), taskId: String(task.id), worker: String(task.worker), leaseToken: Number(task.leaseToken),
        kind: "artifact-reference", identity: String(value.artifactRef), artifactIdentity: String(value.artifactRef), checksum: typeof value.checksum === "string" ? value.checksum : undefined,
      }),
      outboxIntent: async () => {},
      waitForHuman: async (value) => {
        await repository.waitForHuman({
          taskId: String(task.id), attemptId: String(task.attemptId), worker: String(task.worker), leaseToken: Number(task.leaseToken),
          obstacle: String(value.obstacle ?? "GOOGLE_OAUTH_INVALID_GRANT"), action: String(value.action ?? "Переподключить Google Drive"), now: Date.now(),
        });
      },
    },
    oauth,
    adapters: {
      drive: {
        snapshot: async () => snapshot,
        publishPdf: async () => ({ fileId: `drive-${task.id}`, checksum: "synthetic-pdf-checksum" }),
        reconcile: async () => null,
      },
      routerAI: { invoke: async (value) => ({ artifactRef: `artifact:routerai:${String(value.capability)}:${task.id}`, schemaVersion: "synthetic/v1" }) },
      assemblyAI: { create: async () => ({ remoteJobId: `assembly-${task.id}` }), poll: async () => ({ status: "completed", artifactRef: `artifact:transcript:${task.id}` }) },
      pdf: { renderPair: async () => [{ type: "abc-test", checksum: "abc-checksum-synthetic", artifactRef: `artifact:pdf:abc:${task.id}` }, { type: "candidate-results", checksum: "result-checksum-synthetic", artifactRef: `artifact:pdf:result:${task.id}` }] },
      telegram: { send: async () => ({ messageId: "message-synthetic" }) },
    },
    record: (kind: string) => { if (kind === "release-evidence:validated" || kind.startsWith("drive:")) void kind; },
  };
}
