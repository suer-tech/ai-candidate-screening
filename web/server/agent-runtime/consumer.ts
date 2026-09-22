export type RuntimeConsumerConfig = {
  endpoint: string;
  token: string;
  workerId: string;
  pollingMs: number;
  heartbeatMs: number;
  leaseMs: number;
};

export type ClaimedTask = { id: string; run_id: string; lease_token: number; lease_owner?: string; lease_expires_at?: number; attemptId: string; tool_key: string; task_key?: string; candidate_id?: number; input_version?: string; profile_version?: string; policy_version?: string; idempotency_identity?: string; preconditions_json?: string; expected_outputs_json?: string; fanout_group_id?: string; shard_identity?: string; shard_payload_json?: string };

export type RuntimeToolAdapter = {
  sideEffectClass: "read-only" | "idempotent-write" | "reversible-write" | "irreversible-write";
  operation: string;
  execute(task: ClaimedTask, signal: AbortSignal, authorization: { grantId: string }): Promise<{ outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN_OUTCOME" | "WAITING_FOR_HUMAN" | "RETRY_LATER"; errorCode?: string; obstacle?: string; action?: string; retryAfterMs?: number }>;
};

export type RuntimeToolAdapterResolver = RuntimeToolAdapter | ReadonlyMap<string, RuntimeToolAdapter>;

export class AgentRuntimeConsumer {
  private stopping = false;
  private readonly active = new Set<{ task: ClaimedTask; controller: AbortController }>();

  constructor(private readonly config: RuntimeConsumerConfig, private readonly adapters: RuntimeToolAdapterResolver, private readonly fetcher: typeof fetch = fetch) {}

  async start() {
    this.installShutdownHandlers();
    await this.command("recover", { now: Date.now() });
    let lastRecoveryAt = Date.now();
    while (!this.stopping) {
      const claimed = await this.command("claim", { input: { worker: this.config.workerId, now: Date.now(), leaseMs: this.config.leaseMs } }).catch(() => null) as { task?: ClaimedTask } | null;
      if (!claimed?.task) {
        if (Date.now() - lastRecoveryAt >= this.config.leaseMs) {
          await this.command("recover", { now: Date.now() }).catch((error: unknown) => {
            console.info(JSON.stringify({ event: "agent-worker-recovery-error", safeCode: error instanceof Error && /^RUNTIME_API_[0-9]{3}:recover:[A-Z0-9_:.-]+$/.test(error.message) ? error.message : "RUNTIME_RECOVERY_FAILED" }));
          });
          lastRecoveryAt = Date.now();
        }
        await this.delay(this.config.pollingMs);
        continue;
      }
      try {
        await this.executeClaimedTask(claimed.task);
      } catch (error) {
        const message = error instanceof Error && /^RUNTIME_API_[0-9]{3}:[a-z-]+:[A-Z0-9_:.-]+$/.test(error.message)
          ? error.message
          : "WORKER_TASK_EXECUTION_FAILED";
        console.info(JSON.stringify({ event: "agent-worker-task-error", toolKey: claimed.task.tool_key, safeCode: message }));
        await this.delay(this.config.pollingMs);
      }
    }
  }

  async stop() {
    this.stopping = true;
    for (const execution of this.active) execution.controller.abort(new Error("WORKER_GRACEFUL_SHUTDOWN"));
  }

  async executeClaimedTask(task: ClaimedTask) {
    if (this.stopping) throw new Error("WORKER_GRACEFUL_SHUTDOWN");
    const adapter = this.adapters instanceof Map ? this.adapters.get(task.tool_key) : this.adapters;
    const controller = new AbortController();
    const execution = { task, controller };
    this.active.add(execution);
    let missedHeartbeats = 0;
    let closed = false;
    let pendingHeartbeat: AbortController | undefined;
    let confirmedUntil = Number(task.lease_expires_at ?? Date.now() + this.config.leaseMs);
    let expiryTimer: ReturnType<typeof setTimeout>;
    const context = { workerId: this.config.workerId, taskId: task.id, runId: task.run_id, attemptId: task.attemptId, toolKey: task.tool_key };
    const expire = () => {
      if (closed || controller.signal.aborted) return;
      console.info(JSON.stringify({ event: "agent-worker-lease-expired", ...context, safeCode: "LEASE_CONFIRMATION_EXPIRED" }));
      controller.abort(new Error("LEASE_LOST"));
    };
    const scheduleExpiry = () => {
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(expire, Math.max(0, confirmedUntil - Date.now()));
    };
    const assertOwnership = () => {
      if (Date.now() >= confirmedUntil) expire();
      controller.signal.throwIfAborted();
    };
    const cancelHeartbeat = () => pendingHeartbeat?.abort();
    controller.signal.addEventListener("abort", cancelHeartbeat, { once: true });
    scheduleExpiry();
    const heartbeat = setInterval(() => {
      if (closed || controller.signal.aborted || pendingHeartbeat) return;
      const sentAt = Date.now();
      if (sentAt >= confirmedUntil) { expire(); return; }
      const request = new AbortController();
      pendingHeartbeat = request;
      const timeout = setTimeout(() => request.abort(), Math.min(this.config.heartbeatMs, confirmedUntil - sentAt));
      void this.command("heartbeat", { input: { taskId: task.id, worker: this.config.workerId, leaseToken: task.lease_token, now: sentAt, leaseMs: this.config.leaseMs } }, request.signal)
        .then(() => {
          if (closed || controller.signal.aborted || request.signal.aborted) return;
          // The server renews from request time, not from receipt of a delayed response.
          confirmedUntil = sentAt + this.config.leaseMs;
          missedHeartbeats = 0;
          scheduleExpiry();
        })
        .catch((error: unknown) => {
          if (closed || controller.signal.aborted) return;
          missedHeartbeats += 1;
          const apiError = error instanceof Error ? /^RUNTIME_API_(\d{3}):heartbeat:([A-Z0-9_:.-]+)$/.exec(error.message) : null;
          const httpStatus = apiError ? Number(apiError[1]) : undefined;
          const serverCode = apiError?.[2];
          const explicitLeaseLoss = (httpStatus === 409 || httpStatus === 422) && serverCode === "STALE_LEASE_TOKEN";
          const knownCodes = ["STALE_LEASE_TOKEN", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "RUNTIME_HEARTBEAT_UNAVAILABLE", "RUNTIME_COMMAND_REJECTED", "INTERNAL_RUNTIME_UNAUTHORIZED", "RUNTIME_HEARTBEAT_INPUT_INVALID"];
          console.info(JSON.stringify({ event: "agent-worker-heartbeat-error", ...context, httpStatus,
            serverCode: serverCode && knownCodes.includes(serverCode) ? serverCode : undefined,
            safeCode: explicitLeaseLoss ? "LEASE_LOST" : request.signal.aborted ? "HEARTBEAT_REQUEST_TIMEOUT" : "HEARTBEAT_TRANSIENT_FAILURE",
            consecutiveFailures: missedHeartbeats, leaseRemainingMs: Math.max(0, confirmedUntil - Date.now()) }));
          if (explicitLeaseLoss) controller.abort(new Error("LEASE_LOST"));
        })
        .finally(() => {
          clearTimeout(timeout);
          if (pendingHeartbeat === request) pendingHeartbeat = undefined;
        });
    }, this.config.heartbeatMs);
    try {
      assertOwnership();
      if (!adapter) {
        await this.command("fail", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token, errorCode: "TOOL_ADAPTER_NOT_CONFIGURED" } }, controller.signal);
        return;
      }
      const authorization = await this.command("authorize", { input: { taskId: task.id, operation: adapter.operation, sideEffectClass: adapter.sideEffectClass, now: Date.now() } }, controller.signal) as { allowed?: boolean; code?: string; grantId?: string };
      assertOwnership();
      if (!authorization.allowed || !authorization.grantId) {
        await this.command("fail", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token, errorCode: authorization.code ?? "TOOL_POLICY_DENIED" } }, controller.signal);
        return;
      }
      await this.command("prepare-effect", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token,
        grantId: authorization.grantId, operation: adapter.operation, operationIdentity: task.idempotency_identity ?? task.id, sideEffectClass: adapter.sideEffectClass, now: Date.now() } }, controller.signal);
      assertOwnership();
      const result = await adapter.execute(task, controller.signal, { grantId: authorization.grantId });
      // An aborted HTTP adapter may return FAILED. It no longer owns an outcome.
      assertOwnership();
      if (result.outcome === "RETRY_LATER") {
        await this.command("defer", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token, now: Date.now(), retryAfterMs: result.retryAfterMs ?? 15_000, reason: result.errorCode ?? "PROVIDER_RESULT_PENDING" } }, controller.signal);
        return;
      }
      if (result.outcome === "WAITING_FOR_HUMAN") {
        await this.command("wait-for-human", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token,
          obstacle: result.obstacle ?? result.errorCode ?? "GOOGLE_OAUTH_INVALID_GRANT", action: result.action ?? "Переподключить Google Drive", now: Date.now() } }, controller.signal);
        return;
      }
      const outcomeCommand = result.outcome === "SUCCEEDED" ? "complete" : result.outcome === "UNKNOWN_OUTCOME" ? "unknown" : "fail";
      await this.command(outcomeCommand, { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token, errorCode: result.errorCode } }, controller.signal);
      if (result.outcome === "SUCCEEDED" && !controller.signal.aborted && Date.now() < confirmedUntil) {
        await this.command("promote", { runId: task.run_id }, controller.signal);
      }
    } finally {
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(expiryTimer!);
      pendingHeartbeat?.abort();
      controller.signal.removeEventListener("abort", cancelHeartbeat);
      this.active.delete(execution);
    }
  }

  private async command(command: string, payload: Record<string, unknown>, signal?: AbortSignal) {
    const deadline = new AbortController();
    const timeout = setTimeout(() => deadline.abort(new Error("RUNTIME_COMMAND_TIMEOUT")), this.config.leaseMs);
    try {
      const response = await this.fetcher(this.config.endpoint, { method: "POST", headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, ...payload }),
        signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: unknown };
        const safeCode = typeof body.error === "string" && /^[A-Z0-9_:.-]{1,160}$/.test(body.error)
          ? body.error
          : "RUNTIME_COMMAND_REJECTED";
        throw new Error(`RUNTIME_API_${response.status}:${command}:${safeCode}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private installShutdownHandlers() {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void this.stop(); });
  }

  private delay(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

export function loadRuntimeConsumerConfig(source: NodeJS.ProcessEnv = process.env): RuntimeConsumerConfig {
  const endpoint = source.AGENT_RUNTIME_ENDPOINT?.trim();
  const token = source.AGENT_RUNTIME_INTERNAL_TOKEN?.trim();
  if (!endpoint || !token) throw new Error("AGENT_RUNTIME_ENDPOINT and AGENT_RUNTIME_INTERNAL_TOKEN are required");
  const integer = (name: string, fallback: number) => {
    const value = Number(source[name] ?? fallback);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
    return value;
  };
  return { endpoint, token, workerId: source.AGENT_RUNTIME_WORKER_ID?.trim() || `worker-${process.pid}`, pollingMs: integer("AGENT_RUNTIME_POLLING_MS", 1_000), heartbeatMs: integer("AGENT_RUNTIME_HEARTBEAT_MS", 10_000), leaseMs: integer("AGENT_RUNTIME_LEASE_MS", 120_000) };
}
