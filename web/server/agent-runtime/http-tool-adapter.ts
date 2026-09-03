import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RuntimeToolAdapter, ClaimedTask } from "./consumer.ts";
import { GoalRegistry, ToolRegistry } from "./registry.ts";
import { registerCanonicalCandidatePipeline } from "../candidate-pipeline/goal.ts";

export type ToolExecutorConfig = { endpoint: string; token: string; environment: "local" | "staging" | "preproduction" | "production" };
type ToolExecutorBody = { outcome?: "SUCCEEDED" | "FAILED" | "UNKNOWN_OUTCOME" | "WAITING_FOR_HUMAN" | "RETRY_LATER"; errorCode?: string; obstacle?: string; action?: string; retryAfterMs?: number };

export function createHttpToolAdapters(config: ToolExecutorConfig, fetcher?: typeof fetch) {
  const endpoint = validateEndpoint(config.endpoint, config.environment);
  const tools = new ToolRegistry();
  registerCanonicalCandidatePipeline(tools, new GoalRegistry());
  const adapters = new Map<string, RuntimeToolAdapter>();
  for (const definition of tools.tools.values()) adapters.set(definition.key, {
    operation: "execute",
    sideEffectClass: definition.sideEffectClass,
    async execute(task: ClaimedTask, signal: AbortSignal, authorization: { grantId: string }) {
      try {
        const payload = JSON.stringify({ toolKey: definition.key, task: { ...safeTask(task), authorizationGrantId: authorization.grantId } });
        const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(15 * 60 * 1_000)]);
        const body = fetcher
          ? await fetcher(endpoint, { method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: payload, signal: combinedSignal })
            .then((response) => response.json().catch(() => ({})) as Promise<ToolExecutorBody>)
          : await postJsonWithLongResponseTimeout(endpoint, config.token, payload, combinedSignal);
        if (!body.outcome) return { outcome: "FAILED" as const, errorCode: body.errorCode ?? "TOOL_EXECUTOR_RESPONSE_INVALID" };
        return { outcome: body.outcome, errorCode: body.errorCode, obstacle: body.obstacle, action: body.action, ...(body.retryAfterMs === undefined ? {} : { retryAfterMs: body.retryAfterMs }) };
      } catch (error) {
        return { outcome: "FAILED" as const, errorCode: toolAdapterFailureCode(error, signal) };
      }
    },
  });
  return adapters;
}

async function postJsonWithLongResponseTimeout(endpoint: string, token: string, payload: string, signal: AbortSignal): Promise<ToolExecutorBody> {
  const url = new URL(endpoint);
  return new Promise<ToolExecutorBody>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
      signal,
    }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        if (received > 1_000_000) request.destroy(new Error("TOOL_EXECUTOR_RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as ToolExecutorBody); }
        catch { resolve({}); }
      });
      response.on("error", reject);
    });
    request.setTimeout(15 * 60 * 1_000, () => {
      const error = new Error("TOOL_EXECUTOR_TIMEOUT");
      error.name = "TimeoutError";
      request.destroy(error);
    });
    request.on("error", reject);
    request.end(payload);
  });
}

export function toolAdapterFailureCode(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted && signal.reason instanceof Error && signal.reason.message === "LEASE_LOST") return "TOOL_EXECUTOR_LEASE_LOST";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" && !signal?.aborted)) return "TOOL_EXECUTOR_TIMEOUT";
  return "TOOL_EXECUTOR_UNAVAILABLE";
}

function validateEndpoint(value: string, environment: ToolExecutorConfig["environment"]) {
  const url = new URL(value);
  const dockerNetwork = process.env.HH_DOCKER_NETWORK === "1";
  const dockerInternalToolEndpoint = dockerNetwork
    && url.protocol === "http:"
    && url.hostname === "web"
    && url.port === "3000"
    && url.pathname === "/api/internal/candidate-pipeline/tool"
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
  if (environment === "local") {
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("LOCAL_TOOL_ENDPOINT_MUST_BE_LOOPBACK");
    if (!dockerNetwork && !/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) throw new Error("LOCAL_TOOL_ENDPOINT_MUST_BE_LOOPBACK");
  } else if (!dockerInternalToolEndpoint && (url.protocol !== "https:" || /^(localhost|127\.0\.0\.1)$/i.test(url.hostname))) throw new Error("REMOTE_TOOL_ENDPOINT_MUST_USE_HTTPS");
  return url.toString();
}

function safeTask(task: ClaimedTask) {
  return {
    id: task.id,
    runId: task.run_id,
    taskKey: task.task_key,
    toolKey: task.tool_key,
    candidatePk: task.candidate_id,
    inputVersion: task.input_version,
    profileVersion: task.profile_version,
    policyVersion: task.policy_version,
    idempotencyIdentity: task.idempotency_identity,
    leaseToken: task.lease_token,
    worker: task.lease_owner,
    attemptId: task.attemptId,
    ...(task.fanout_group_id ? { fanoutGroupId: task.fanout_group_id } : {}),
    ...(task.shard_identity ? { shardIdentity: task.shard_identity } : {}),
    ...(task.shard_payload_json ? { shardPayload: JSON.parse(task.shard_payload_json) as Record<string, unknown> } : {}),
  };
}
