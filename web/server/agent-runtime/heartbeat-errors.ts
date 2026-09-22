import { RuntimeConflictError } from "./runtime.ts";

const infrastructureCodes = new Set([
  "08000", "08001", "08003", "08006", "08004", "08007", "08P01",
  "40001", "40P01", "53300", "53400", "55P03", "57014", "57P01", "57P02", "57P03",
  "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "CONNECTION_DESTROYED",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
]);

export function classifyHeartbeatError(error: unknown) {
  if (error instanceof RuntimeConflictError && error.code === "STALE_LEASE_TOKEN") {
    return { status: 409, error: "STALE_LEASE_TOKEN", reasonCode: "STALE_LEASE_TOKEN" };
  }
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const reasonCode = typeof code === "string" && infrastructureCodes.has(code) ? code : "UNCLASSIFIED_INFRASTRUCTURE_ERROR";
  return { status: 503, error: "RUNTIME_HEARTBEAT_UNAVAILABLE", reasonCode };
}
