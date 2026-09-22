type Phase = "media-source-download" | "media-processor-request" | "media-response-read" | "media-artifact-store";
type Correlation = { runId: string; taskId: string; attemptId: string };

const safeCodes = new Set([
  "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ENOSPC",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "08000", "08001", "08003", "08006", "08004", "08007", "08P01", "40001", "40P01", "53300", "53400", "55P03", "57014", "57P01", "57P02", "57P03",
  "BLOB_SIZE_LIMIT_EXCEEDED", "BLOB_IDENTITY_CONFLICT", "BLOB_CHECKSUM_MISMATCH",
]);

function safeReason(error: unknown): string {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const value = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (typeof value.code === "string" && safeCodes.has(value.code)) return value.code;
    if (value.name === "TimeoutError") return "TIMEOUT";
    if (value.name === "AbortError") return "ABORTED";
    if (typeof value.message === "string" && /^MEDIA_PROCESSOR_HTTP_[1-5]\d{2}$/.test(value.message)) return value.message;
    current = value.cause;
  }
  return "UNCLASSIFIED_ERROR";
}

export async function runCandidatePhase<T>(
  context: Correlation,
  phase: Phase,
  operation: () => Promise<T>,
  log: (entry: Record<string, unknown>) => void = (entry) => console.info(JSON.stringify(entry)),
): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } catch (error) {
    try {
      log({ event: "candidate-phase-error", runId: context.runId, taskId: context.taskId, attemptId: context.attemptId,
        phase, elapsedMs: Math.max(0, Math.round(performance.now() - started)), reasonCode: safeReason(error) });
    } catch { /* Diagnostics must never replace the operation's original failure. */ }
    throw error;
  }
}
