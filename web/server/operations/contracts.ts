import { timingSafeEqual } from "node:crypto";

export const HR_METRICS = Object.freeze({
  terminal_runs_24h: "hh_terminal_runs_24h",
  failed_runs_1h: "hh_failed_runs_1h",
  oldest_active_seconds: "hh_oldest_active_run_seconds",
  queue_ready: "sum(rabbitmq_queue_messages_ready{queue=~\"candidate.tasks.*\"})",
  consumer_count: "sum(rabbitmq_queue_consumers{queue=~\"candidate.tasks.*\"})",
  host_cpu_percent: "100 * (1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])))",
  host_memory_percent: "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)",
  disk_free_percent: "100 * node_filesystem_avail_bytes{mountpoint=\"/\",fstype!~\"tmpfs|overlay\"} / node_filesystem_size_bytes{mountpoint=\"/\",fstype!~\"tmpfs|overlay\"}",
  web_up: "probe_success{probe=\"live\"}",
  processing_ready: "probe_success{probe=\"processing\"}",
  request_rate: "rate(nginx_http_requests_total[5m])",
  active_connections: "nginx_connections_active",
} as const);

export type HrMetric = keyof typeof HR_METRICS;
export const SAFE_EVENTS = new Set([
  "candidate-tool-outcome", "candidate-tool-preparation-error", "candidate-stage-error",
  "agent-worker-recovery-error", "agent-worker-task-error", "agent-worker-heartbeat-error",
  "rabbit-dispatch-publisher-error", "rabbit-dispatch-published", "rabbit-worker-ready",
  "rabbit-worker-consumer-cancelled", "rabbit-task-started", "rabbit-task-finished",
  "rabbit-worker-dead-letter", "rabbit-worker-delivery-error", "report-content-oracle-warning",
  "ops-gateway-ready",
]);
const SAFE_SERVICES = new Set([
  "web", "worker", "dispatch-publisher", "worker-control", "worker-documents", "worker-media",
  "worker-transcription", "worker-llm", "worker-reports", "worker-drive", "worker-notifications",
  "media-processor", "document-processor", "ops-gateway",
]);
const SAFE_LEVELS = new Set(["debug", "info", "warning", "warn", "error", "critical"]);
const SAFE_OUTCOMES = new Set(["SUCCEEDED", "FAILED", "UNKNOWN_OUTCOME", "WAITING_FOR_HUMAN", "RETRY_LATER"]);
const SAFE_ROUTING = new Set(["control", "documents", "media", "transcription", "llm", "reports", "drive", "notifications"]);
const SAFE_CODE = /^[A-Z0-9_:.-]{1,120}$/;
const ERROR_EVENTS = new Set([
  "candidate-tool-preparation-error", "candidate-stage-error", "agent-worker-recovery-error",
  "agent-worker-task-error", "agent-worker-heartbeat-error", "rabbit-dispatch-publisher-error",
  "rabbit-worker-consumer-cancelled", "rabbit-worker-dead-letter", "rabbit-worker-delivery-error",
]);

export function authorized(header: string | undefined, configured: string): boolean {
  const supplied = header?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(configured);
  return configured.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
}

export function integer(raw: string | null, fallback: number, minimum: number, maximum: number): number {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error("INVALID_ARGUMENT");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("INVALID_ARGUMENT");
  return value;
}

export function boolean(raw: string | null, fallback: boolean): boolean {
  if (raw === null || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("INVALID_ARGUMENT");
}

function finite(value: unknown, minimum = 0, maximum = 1e15): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum ? numeric : undefined;
}

export interface SafeLogEvent {
  timestamp: string;
  event: string;
  service?: string;
  level?: string;
  safe_code?: string;
  routing_class?: string;
  outcome?: string;
  count?: number;
  duration_ms?: number;
}

export function sanitizeLogValue(timestampNs: string, raw: string, service?: string): SafeLogEvent | undefined {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw) as Record<string, unknown>; }
  catch { return undefined; }
  const event = typeof value.event === "string" ? value.event : undefined;
  if (!event || !SAFE_EVENTS.has(event)) return undefined;
  const timestampNumber = Number(timestampNs) / 1e9;
  if (!Number.isFinite(timestampNumber)) return undefined;
  const result: SafeLogEvent = { timestamp: new Date(timestampNumber * 1000).toISOString(), event };
  if (service && SAFE_SERVICES.has(service)) result.service = service;
  const level = typeof value.level === "string" ? value.level.toLowerCase() : undefined;
  if (level && SAFE_LEVELS.has(level)) result.level = level === "warn" ? "warning" : level;
  else result.level = ERROR_EVENTS.has(event) ? "error" : event === "report-content-oracle-warning" ? "warning" : "info";
  const code = typeof value.safeCode === "string" ? value.safeCode : undefined;
  if (code && SAFE_CODE.test(code)) result.safe_code = code;
  const routing = typeof value.routingClass === "string" ? value.routingClass : undefined;
  if (routing && SAFE_ROUTING.has(routing)) result.routing_class = routing;
  const outcome = typeof value.outcome === "string" ? value.outcome : undefined;
  if (outcome && SAFE_OUTCOMES.has(outcome)) result.outcome = outcome;
  const count = finite(value.count, 0, 1e9);
  if (count !== undefined) result.count = count;
  const duration = finite(value.durationMs, 0, 86_400_000);
  if (duration !== undefined) result.duration_ms = duration;
  return result;
}

export function metricName(raw: string | null): HrMetric {
  if (!raw || !Object.hasOwn(HR_METRICS, raw)) throw new Error("INVALID_ARGUMENT");
  return raw as HrMetric;
}
