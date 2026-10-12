import type { PostgresClient } from "../storage/postgres.ts";

export type TaskExecutionSignal = { signal: AbortSignal; stop(): void };

export function candidateToolRequiresLeaseSignal(toolKey: string) {
  return ["candidate.transcript-media-shard/v1", "candidate.transcription/v1", "candidate.transcript-shard/v1"].includes(toolKey);
}

/** Keep server-side media work fenced even if the worker's HTTP disconnect is lost. */
export async function createTaskExecutionSignal(
  database: PostgresClient,
  task: Record<string, unknown>,
  requestSignal?: AbortSignal,
  options: { pollMs?: number; initialTimeoutMs?: number } = {},
): Promise<TaskExecutionSignal> {
  const requiredText = (key: string) => {
    if (typeof task[key] !== "string" || !task[key]) throw new Error("TASK_LEASE_SCOPE_INVALID");
    return task[key];
  };
  const parameters = [requiredText("id"), requiredText("runId"), requiredText("worker"), task.leaseToken,
    requiredText("attemptId"), requiredText("toolKey")];
  if (!Number.isSafeInteger(task.leaseToken) || Number(task.leaseToken) < 1) throw new Error("TASK_LEASE_SCOPE_INVALID");
  const pollMs = Math.max(1, Math.min(5_000, options.pollMs ?? 5_000));
  const initialTimeoutMs = Math.max(1, Math.min(5_000, options.initialTimeoutMs ?? 5_000));
  const controller = new AbortController();
  let closed = false;
  let checking = false;
  let confirmedUntil = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    if (closed || controller.signal.aborted) return;
    const remaining = confirmedUntil - Date.now();
    if (remaining > 0) expiryTimer = setTimeout(expire, remaining);
    else controller.abort(new Error("LEASE_EXPIRED"));
  };
  const abortRequest = () => controller.abort(new Error("TASK_REQUEST_ABORTED"));
  const stop = () => {
    closed = true;
    clearInterval(pollTimer);
    clearTimeout(expiryTimer);
    requestSignal?.removeEventListener("abort", abortRequest);
    controller.signal.removeEventListener("abort", stop);
  };
  controller.signal.addEventListener("abort", stop, { once: true });
  requestSignal?.addEventListener("abort", abortRequest, { once: true });
  if (requestSignal?.aborted) abortRequest();

  const confirmOwnership = async (initial: boolean) => {
    if (closed || checking) return;
    checking = true;
    try {
      const rows = await database.unsafe<{ lease_expires_at: number | string }[]>(`SELECT task.lease_expires_at
        FROM agent_tasks task JOIN agent_runs run ON run.id=task.run_id
        JOIN agent_attempts attempt ON attempt.task_id=task.id
        WHERE task.id=$1 AND task.run_id=$2 AND task.lease_owner=$3 AND task.lease_token=$4
          AND attempt.id=$5 AND task.tool_key=$6 AND task.state='RUNNING' AND run.state='ACTIVE'
          AND attempt.state='RUNNING' AND attempt.lease_owner=$3 AND attempt.lease_token=$4`, parameters as never[]);
      if (closed || controller.signal.aborted) return;
      if (!initial && Date.now() >= confirmedUntil) {
        controller.abort(new Error("LEASE_EXPIRED"));
        return;
      }
      const deadline = Number(rows[0]?.lease_expires_at);
      if (!rows[0] || !Number.isSafeInteger(deadline)) {
        controller.abort(new Error("LEASE_LOST"));
        return;
      }
      if (deadline <= Date.now()) {
        controller.abort(new Error("LEASE_EXPIRED"));
        return;
      }
      confirmedUntil = deadline;
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(expire, Math.max(0, confirmedUntil - Date.now()));
    } catch {
      if (initial && !closed) controller.abort(new Error("TASK_LEASE_CHECK_UNAVAILABLE"));
      // A transient database failure cannot extend the last confirmed lease.
    } finally {
      checking = false;
    }
  };

  let initialTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectOnAbort: (() => void) | undefined;
  try {
    controller.signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    initialTimer = setTimeout(() => controller.abort(new Error("TASK_LEASE_CHECK_TIMEOUT")), initialTimeoutMs);
    await Promise.race([confirmOwnership(true), aborted]);
    controller.signal.throwIfAborted();
    pollTimer = setInterval(() => {
      if (Date.now() >= confirmedUntil) controller.abort(new Error("LEASE_EXPIRED"));
      else void confirmOwnership(false);
    }, pollMs);
    return { signal: controller.signal, stop };
  } catch (error) {
    stop();
    throw error;
  } finally {
    clearTimeout(initialTimer);
    if (rejectOnAbort) controller.signal.removeEventListener("abort", rejectOnAbort);
  }
}
