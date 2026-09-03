export type RuntimeConsumerConfig = {
  endpoint: string;
  token: string;
  workerId: string;
  pollingMs: number;
  heartbeatMs: number;
  leaseMs: number;
};

export type ClaimedTask = { id: string; run_id: string; lease_token: number; lease_owner?: string; attemptId: string; tool_key: string; task_key?: string; candidate_id?: number; input_version?: string; profile_version?: string; policy_version?: string; idempotency_identity?: string; preconditions_json?: string; expected_outputs_json?: string; fanout_group_id?: string; shard_identity?: string; shard_payload_json?: string };

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
    const adapter = this.adapters instanceof Map ? this.adapters.get(task.tool_key) : this.adapters;
    if (!adapter) {
      await this.command("fail", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token, errorCode: "TOOL_ADAPTER_NOT_CONFIGURED" } });
      return;
    }
    const controller = new AbortController();
    const execution = { task, controller };
    this.active.add(execution);
    let missedHeartbeats = 0;
    const heartbeat = setInterval(() => {
      void this.command("heartbeat", { input: { taskId: task.id, worker: this.config.workerId, leaseToken: task.lease_token, now: Date.now(), leaseMs: this.config.leaseMs } })
        .then(() => { missedHeartbeats = 0; })
        .catch((error: unknown) => {
          missedHeartbeats += 1;
          const explicitLeaseLoss = error instanceof Error && /^RUNTIME_API_(409|422):heartbeat:/.test(error.message);
          console.info(JSON.stringify({ event: "agent-worker-heartbeat-error", toolKey: task.tool_key,
            safeCode: explicitLeaseLoss ? "LEASE_LOST" : "HEARTBEAT_TRANSIENT_FAILURE", consecutiveFailures: missedHeartbeats }));
          if (explicitLeaseLoss || missedHeartbeats >= 3) controller.abort(new Error("LEASE_LOST"));
        });
    }, this.config.heartbeatMs);
    try {
      const authorization = await this.command("authorize", { input: { taskId: task.id, operation: adapter.operation, sideEffectClass: adapter.sideEffectClass, now: Date.now() } }) as { allowed?: boolean; code?: string; grantId?: string };
      if (!authorization.allowed || !authorization.grantId) {
        await this.command("fail", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token, errorCode: authorization.code ?? "TOOL_POLICY_DENIED" } });
        return;
      }
      await this.command("prepare-effect", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token,
        grantId: authorization.grantId, operation: adapter.operation, operationIdentity: task.idempotency_identity ?? task.id, sideEffectClass: adapter.sideEffectClass, now: Date.now() } });
      const result = await adapter.execute(task, controller.signal, { grantId: authorization.grantId });
      if (result.outcome === "RETRY_LATER") {
        await this.command("defer", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token, now: Date.now(), retryAfterMs: result.retryAfterMs ?? 15_000, reason: result.errorCode ?? "PROVIDER_RESULT_PENDING" } });
        return;
      }
      if (result.outcome === "WAITING_FOR_HUMAN") {
        await this.command("wait-for-human", { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token,
          obstacle: result.obstacle ?? result.errorCode ?? "GOOGLE_OAUTH_INVALID_GRANT", action: result.action ?? "Переподключить Google Drive", now: Date.now() } });
        return;
      }
      const outcomeCommand = result.outcome === "SUCCEEDED" ? "complete" : result.outcome === "UNKNOWN_OUTCOME" ? "unknown" : "fail";
      await this.command(outcomeCommand, { input: { taskId: task.id, attemptId: task.attemptId, worker: this.config.workerId, leaseToken: task.lease_token, errorCode: result.errorCode } });
      if (result.outcome === "SUCCEEDED") await this.command("promote", { runId: task.run_id });
    } finally {
      clearInterval(heartbeat);
      this.active.delete(execution);
    }
  }

  private async command(command: string, payload: Record<string, unknown>) {
    const response = await this.fetcher(this.config.endpoint, { method: "POST", headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, ...payload }) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: unknown };
      const safeCode = typeof body.error === "string" && /^[A-Z0-9_:.-]{1,160}$/.test(body.error)
        ? body.error
        : "RUNTIME_COMMAND_REJECTED";
      throw new Error(`RUNTIME_API_${response.status}:${command}:${safeCode}`);
    }
    return response.json();
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
  return { endpoint, token, workerId: source.AGENT_RUNTIME_WORKER_ID?.trim() || `worker-${process.pid}`, pollingMs: integer("AGENT_RUNTIME_POLLING_MS", 1_000), heartbeatMs: integer("AGENT_RUNTIME_HEARTBEAT_MS", 10_000), leaseMs: integer("AGENT_RUNTIME_LEASE_MS", 30_000) };
}
