import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { envelopeSchema, forbiddenEnvelopeFixtures } from "../fixtures/rabbitmq-parallel-pipeline/synthetic-acceptance.mjs";

const execFileAsync = promisify(execFile);
const adapterPath = path.resolve(import.meta.dirname, "../../server/agent-runtime/rabbitmq-acceptance-boundary.ts");
const postgresImage = process.env.RABBIT_ACCEPTANCE_POSTGRES_IMAGE || "postgres:16.10-alpine";
const rabbitImage = process.env.RABBIT_ACCEPTANCE_RABBIT_IMAGE || "rabbitmq:3-management";
const postgresUser = "rabbit_acceptance";
const postgresDatabase = "rabbit_acceptance";
const postgresPassword = "synthetic-local-only-password";
const rabbitUser = "guest";
const rabbitPassword = "guest";

let adapterPromise;

function safeSuffix() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function docker(args, options = {}) {
  const result = await execFileAsync("docker", args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
    windowsHide: true,
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function waitFor(check, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`INFRASTRUCTURE_NOT_READY:${label}:${lastError instanceof Error ? lastError.message : "timeout"}`);
}

async function mappedPort(container, containerPort) {
  const { stdout } = await docker(["port", container, `${containerPort}/tcp`]);
  const match = stdout.match(/:(\d+)\s*$/m);
  if (!match) throw new Error(`INFRASTRUCTURE_PORT_NOT_MAPPED:${containerPort}`);
  return Number(match[1]);
}

async function tcpReady(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

function managementHeaders() {
  return {
    authorization: `Basic ${Buffer.from(`${rabbitUser}:${rabbitPassword}`).toString("base64")}`,
    "content-type": "application/json",
  };
}

async function managementRequest(baseUrl, pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers: { ...managementHeaders(), ...(init.headers ?? {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`RABBIT_MANAGEMENT_HTTP_${response.status}:${pathname}`);
  return body ? JSON.parse(body) : null;
}

async function verifyRabbitBoundary(managementUrl) {
  const suffix = safeSuffix();
  const exchange = `acceptance.probe.${suffix}`;
  const queue = `acceptance.probe.${suffix}`;
  const encodedExchange = encodeURIComponent(exchange);
  const encodedQueue = encodeURIComponent(queue);
  await managementRequest(managementUrl, `/api/exchanges/%2F/${encodedExchange}`, {
    method: "PUT",
    body: JSON.stringify({ type: "direct", durable: false, auto_delete: true, internal: false, arguments: {} }),
  });
  await managementRequest(managementUrl, `/api/queues/%2F/${encodedQueue}`, {
    method: "PUT",
    body: JSON.stringify({ durable: false, auto_delete: true, arguments: {} }),
  });
  await managementRequest(managementUrl, `/api/bindings/%2F/e/${encodedExchange}/q/${encodedQueue}`, {
    method: "POST",
    body: JSON.stringify({ routing_key: "probe", arguments: {} }),
  });
  const payload = JSON.stringify({ schemaVersion: envelopeSchema.schemaVersion, taskId: "synthetic-infra-probe", routingClass: "control" });
  const published = await managementRequest(managementUrl, `/api/exchanges/%2F/${encodedExchange}/publish`, {
    method: "POST",
    body: JSON.stringify({ properties: { delivery_mode: 2 }, routing_key: "probe", payload, payload_encoding: "string" }),
  });
  const messages = await managementRequest(managementUrl, `/api/queues/%2F/${encodedQueue}/get`, {
    method: "POST",
    body: JSON.stringify({ count: 1, ackmode: "ack_requeue_false", encoding: "auto", truncate: 50_000 }),
  });
  if (published?.routed !== true || !Array.isArray(messages) || messages.length !== 1 || messages[0]?.payload !== payload) {
    throw new Error("INFRASTRUCTURE_RABBIT_PUBLISH_GET_FAILED");
  }
}

async function verifyPostgresBoundary(container) {
  const sql = [
    "CREATE TABLE acceptance_probe(id text PRIMARY KEY, value text NOT NULL);",
    "INSERT INTO acceptance_probe(id, value) VALUES ('probe', 'real-postgres-boundary');",
    "SELECT value FROM acceptance_probe WHERE id = 'probe';",
  ].join(" ");
  const { stdout } = await docker(["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", postgresUser, "-d", postgresDatabase, "-Atc", sql]);
  if (!stdout.split(/\r?\n/).includes("real-postgres-boundary")) throw new Error("INFRASTRUCTURE_POSTGRES_WRITE_READ_FAILED");
}

export async function startRabbitAcceptanceInfrastructure() {
  const suffix = safeSuffix();
  const postgresContainer = `hh-rabbit-acceptance-postgres-${suffix}`;
  const rabbitContainer = `hh-rabbit-acceptance-broker-${suffix}`;
  const containers = [postgresContainer, rabbitContainer];
  try {
    await docker(["run", "-d", "--name", postgresContainer, "-P", "-e", `POSTGRES_USER=${postgresUser}`, "-e", `POSTGRES_PASSWORD=${postgresPassword}`, "-e", `POSTGRES_DB=${postgresDatabase}`, postgresImage]);
    await docker(["run", "-d", "--name", rabbitContainer, "-P", rabbitImage]);
    const postgresPort = await mappedPort(postgresContainer, 5432);
    const rabbitPort = await mappedPort(rabbitContainer, 5672);
    const managementPort = await mappedPort(rabbitContainer, 15672);
    await waitFor(async () => {
      try {
        await docker(["exec", postgresContainer, "pg_isready", "-U", postgresUser, "-d", postgresDatabase], { timeout: 5_000 });
        return true;
      } catch { return false; }
    }, "postgresql");
    await waitFor(async () => {
      try {
        await docker(["exec", rabbitContainer, "rabbitmq-diagnostics", "-q", "ping"], { timeout: 5_000 });
        return true;
      } catch { return false; }
    }, "rabbitmq");
    await waitFor(() => tcpReady(rabbitPort), "rabbitmq-amqp-port");
    const managementUrl = `http://127.0.0.1:${managementPort}`;
    await waitFor(async () => {
      try {
        await managementRequest(managementUrl, "/api/overview");
        return true;
      } catch { return false; }
    }, "rabbitmq-management");
    await verifyPostgresBoundary(postgresContainer);
    await verifyRabbitBoundary(managementUrl);
    return {
      summary: Object.freeze({
        realPostgres: true,
        postgresWriteRead: true,
        realRabbitMq: true,
        rabbitPublishGet: true,
        infrastructureErrors: 0,
      }),
      boundary: Object.freeze({
        postgresUrl: `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDatabase}`,
        rabbitAmqpUrl: `amqp://${rabbitUser}:${rabbitPassword}@127.0.0.1:${rabbitPort}`,
        rabbitManagementUrl: managementUrl,
      }),
      async stop() {
        await Promise.all(containers.map(async (container) => {
          try { await docker(["rm", "-f", container], { timeout: 30_000 }); } catch { /* best-effort test cleanup */ }
        }));
      },
    };
  } catch (error) {
    await Promise.all(containers.map(async (container) => {
      try { await docker(["rm", "-f", container], { timeout: 30_000 }); } catch { /* best-effort setup cleanup */ }
    }));
    throw error;
  }
}

async function loadAdapter() {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      try { await access(adapterPath); } catch { return null; }
      const loaded = await import(`${pathToFileURL(adapterPath).href}?rabbitAcceptance=${Date.now()}`);
      if (typeof loaded.runRabbitMqParallelPipelineAcceptanceScenario !== "function") {
        throw new TypeError("RabbitMQ acceptance boundary must export runRabbitMqParallelPipelineAcceptanceScenario(fixture, boundary)");
      }
      return loaded;
    })();
  }
  return adapterPromise;
}

function safeEvidence(fixture, infrastructure) {
  return {
    fixtureSetId: fixture.fixtureSetId,
    synthetic: true,
    containsRealPii: false,
    containsSecrets: false,
    providerExpense: false,
    privateCandidateFolderRead: false,
    buildConfigFixtureIdentity: fixture.buildConfigFixtureIdentity,
    infrastructure,
  };
}

export async function runRabbitAcceptanceScenario(fixture, infrastructure) {
  const adapter = await loadAdapter();
  if (!adapter) {
    return {
      scenarioId: fixture.scenarioId,
      status: "NOT_IMPLEMENTED",
      safeCode: "RABBITMQ_APPLICATION_BOUNDARY_NOT_IMPLEMENTED",
      applicationBoundaryObserved: false,
      timeline: [],
      evidence: safeEvidence(fixture, infrastructure.summary),
    };
  }
  const observed = await adapter.runRabbitMqParallelPipelineAcceptanceScenario(structuredClone(fixture), infrastructure.boundary);
  if (!observed || typeof observed !== "object") throw new TypeError(`RabbitMQ acceptance boundary returned no result for ${fixture.scenarioId}`);
  return {
    scenarioId: fixture.scenarioId,
    ...observed,
    applicationBoundaryObserved: true,
    evidence: safeEvidence(fixture, infrastructure.summary),
  };
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, part) => current?.[part], value);
}

function intervalsOverlap(left, right) {
  const leftStart = Date.parse(left.startedAt);
  const leftFinish = Date.parse(left.finishedAt);
  const rightStart = Date.parse(right.startedAt);
  const rightFinish = Date.parse(right.finishedAt);
  return Number.isFinite(leftStart) && Number.isFinite(leftFinish) && Number.isFinite(rightStart) && Number.isFinite(rightFinish)
    && leftStart < rightFinish && rightStart < leftFinish;
}

function hasOverlap(items, minimum) {
  if (!Array.isArray(items) || items.length < minimum) return false;
  for (let index = 0; index < items.length; index += 1) {
    const overlapping = items.filter((item, otherIndex) => otherIndex === index || intervalsOverlap(items[index], item));
    if (overlapping.length >= minimum) return true;
  }
  return false;
}

export function collectTimelineObservation(timeline, fixture) {
  const events = Array.isArray(timeline) ? timeline : [];
  const wellFormed = events.every((item) => typeof item?.taskId === "string"
    && typeof item?.workerId === "string"
    && typeof item?.groupId === "string"
    && typeof item?.shardId === "string"
    && typeof item?.joinId === "string"
    && Number.isFinite(Date.parse(item?.startedAt))
    && Number.isFinite(Date.parse(item?.finishedAt)));
  const overlaps = Object.fromEntries((fixture.parallelGroups ?? []).map((group) => {
    const items = events.filter((item) => item.parallelKind === group.kind && group.taskKinds.includes(item.taskKind));
    const workerIds = new Set(items.map((item) => item.workerId));
    return [group.kind, hasOverlap(items, group.minimumOverlappingTasks) && workerIds.size >= 2];
  }));
  return { wellFormed, overlaps };
}

function add(failures, condition, message) {
  if (!condition) failures.push(message);
}

export function verifyRabbitAcceptanceResult(result, fixture) {
  const failures = [];
  add(failures, result?.evidence?.synthetic === true, "evidence must be synthetic");
  add(failures, result?.evidence?.containsRealPii === false, "evidence must not contain real PII");
  add(failures, result?.evidence?.containsSecrets === false, "evidence must not contain secrets");
  add(failures, result?.evidence?.providerExpense === false, "acceptance must not call paid providers");
  add(failures, result?.evidence?.privateCandidateFolderRead === false, "acceptance must not read candidate/");
  add(failures, result?.evidence?.infrastructure?.realPostgres === true, "real PostgreSQL must be ready");
  add(failures, result?.evidence?.infrastructure?.postgresWriteRead === true, "PostgreSQL write/read probe must pass");
  add(failures, result?.evidence?.infrastructure?.realRabbitMq === true, "real RabbitMQ must be ready");
  add(failures, result?.evidence?.infrastructure?.rabbitPublishGet === true, "RabbitMQ publish/get probe must pass");
  add(failures, result?.evidence?.infrastructure?.infrastructureErrors === 0, "infrastructureErrors must remain zero");
  add(failures, result?.applicationBoundaryObserved === true, "production RabbitMQ application boundary must be observed");
  add(failures, result?.status === "SUCCEEDED", `scenario must succeed; status=${JSON.stringify(result?.status)} safeCode=${JSON.stringify(result?.safeCode)}`);

  if (fixture.scenarioId === "TST-086") {
    add(failures, result?.productionRuntimeTablesObserved === true, "crash boundary must exercise production agent_tasks/attempts/dispatch-outbox tables, not an acceptance-only table");
    add(failures, result?.transactionalPublish === true, "transactional dispatch outbox and publisher confirm must be observed");
    add(failures, result?.claimById === true, "claim-by-ID must be observed");
    add(failures, result?.ackAfterCommit === true, "ack after PostgreSQL commit must be observed");
    add(failures, result?.crashBeforeCommitRecovered === true, "crash before commit must redeliver and recover");
    add(failures, result?.crashAfterCommitBeforeAckDeduplicated === true, "crash after commit before ack must terminal-deduplicate");
    add(failures, result?.effectiveExecutions === 2, "two crash cases must yield exactly two effective executions");
    add(failures, result?.duplicateEffects === 0, "crash recovery must not duplicate effects");
  }
  if (fixture.scenarioId === "TST-087") {
    add(failures, result?.timelineSource === "agent_events", "parallel timeline must be read from persisted production agent_events");
    const observation = collectTimelineObservation(result?.timeline, fixture);
    add(failures, observation.wellFormed, "timeline must contain task/worker/group/shard/join IDs and valid intervals");
    for (const group of fixture.parallelGroups) add(failures, observation.overlaps[group.kind] === true, `${group.kind} tasks must overlap on at least two workers`);
    add(failures, result?.allRequiredJoinsCompleted === true, "all required joins must complete");
    add(failures, result?.finalStartedAfterRequiredJoins === true, "final work must start only after required joins");
  }
  if (fixture.scenarioId === "TST-088") {
    add(failures, result?.candidateStateSource === "production-read-model", "candidate isolation states must come from the production read model");
    add(failures, result?.candidateStates?.[fixture.candidateRunIds[0]] === "FAILED", "poison candidate must receive terminal failure");
    add(failures, result?.candidateStates?.[fixture.candidateRunIds[1]] === "READY", "first healthy candidate must reach READY");
    add(failures, result?.candidateStates?.[fixture.candidateRunIds[2]] === "READY", "second healthy candidate must reach READY");
    add(failures, result?.typedFailure === true, "poison shard failure must be typed");
    add(failures, result?.deadLetterDiagnostic === true, "poison shard must have dead-letter diagnostic");
    add(failures, result?.workersRemainReady === true, "worker pools must remain ready");
  }
  if (fixture.scenarioId === "TST-089") {
    add(failures, result?.dispatchOutboxTransitionsObserved === true, "broker recovery must observe production dispatch-outbox state transitions");
    add(failures, result?.outboxRepublishedAfterRecovery === true, "unpublished runnable work must be republished after broker recovery");
    add(failures, result?.unackedRedelivered === true, "unacked delivery must be redelivered after broker recovery");
    add(failures, result?.lostRunnableTasks === 0, "broker outage must not lose runnable tasks");
    add(failures, result?.falseCompletions === 0, "broker outage must not create false completion");
    add(failures, result?.duplicateEffects === 0, "broker recovery must not duplicate effects");
    add(failures, result?.manualCandidateRestartRequired === false, "broker recovery must not require manual candidate restart");
  }
  if (fixture.scenarioId === "TST-090") {
    add(failures, JSON.stringify(result?.allowedFields) === JSON.stringify(envelopeSchema.allowedFields), "envelope allowlist must match the versioned contract");
    add(failures, result?.unknownFieldsRejected === true, "unknown envelope fields must be rejected");
    add(failures, result?.unknownRoutingCombinationsRejected === true, "unknown task/routing combinations must be rejected");
    add(failures, Array.isArray(result?.canonicalToolKeys) && result.canonicalToolKeys.length > 0, "canonical matrix-v4 tools must be derived from ToolRegistry and the workflow graph");
    add(failures, result?.routingRegistryEntriesVerified === result?.canonicalToolKeys?.length, "every canonical matrix-v4 tool must have an exact Rabbit route");
    add(failures, Array.isArray(result?.routingRegistryMismatches) && result.routingRegistryMismatches.length === 0, "ToolRegistry and exact Rabbit registry must agree for every canonical matrix-v4 tool");
    add(failures, Array.isArray(result?.rabbitOnlyUnregisteredKeys) && result.rabbitOnlyUnregisteredKeys.length === 0, "Rabbit registry must not contain aliases absent from ToolRegistry");
    add(failures, result?.inspectedLocations?.published === true && result?.inspectedLocations?.unacked === true && result?.inspectedLocations?.["dead-letter"] === true, "published, unacked and dead-letter envelopes must be inspected");
    add(failures, result?.forbiddenMatches === 0, "broker envelopes must not contain forbidden fixture values");
    const serialized = JSON.stringify(result);
    for (const item of forbiddenEnvelopeFixtures) add(failures, !serialized.includes(item.value), `result/evidence must not emit forbidden sentinel from ${item.field}`);
  }
  if (fixture.scenarioId === "TST-091") {
    add(failures, result?.immutableEvidenceArtifactsObserved === true, "release composition must inspect immutable Rabbit and required-E2E evidence artifacts");
    add(failures, result?.rabbitAcceptanceStatus === "GREEN", "RabbitMQ acceptance result must be independently GREEN");
    add(failures, result?.requiredE2eIdentityMatches === true, "four E2E and Rabbit acceptance must share immutable identity");
    add(failures, result?.releaseGateStatus === "RED_BLOCKED", "release gate must remain RED/BLOCKED for the existing Drive conflict");
    add(failures, result?.driveConflict === fixture.requiredDriveConflict, "existing Shared Drive/service-account conflict must be named explicitly");
  }
  return failures;
}

export { adapterPath };
