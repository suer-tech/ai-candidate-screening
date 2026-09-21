import type { PostgresClient } from "../storage/postgres.ts";
import { HR_METRICS, sanitizeLogValue, type HrMetric } from "./contracts.ts";

type Fetcher = typeof fetch;
type ScalarRow = Record<string, string | number | null>;
const SAFE_ALERT_NAMES = new Set([
  "HrOperationsExporterDown", "HrWebDown", "HrProcessingNotReady", "HrRabbitMqMetricsDown",
  "HrRabbitMqConsumerMissing", "HrRabbitMqBacklog", "HrTerminalFailures", "HrProcessingStalled",
  "HrHostMemoryHigh", "HrHostDiskLow", "HrContainerMemoryNearLimit", "HrPrometheusUnavailable",
  "HrLokiDown", "HrAlertmanagerMetricsDown",
]);
const METRIC_UNITS: Record<HrMetric, string> = {
  terminal_runs_24h: "runs", failed_runs_1h: "runs", oldest_active_seconds: "seconds",
  queue_ready: "messages", consumer_count: "consumers", host_cpu_percent: "percent",
  host_memory_percent: "percent", disk_free_percent: "percent", web_up: "0/1",
  processing_ready: "0/1", request_rate: "requests/second", active_connections: "connections",
};

function quoteLabel(value: unknown): string {
  return String(value ?? "unknown").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: Date): string { return value.toISOString().slice(0, 10); }

async function jsonWithLimit<T>(fetcher: Fetcher, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("UPSTREAM_UNAVAILABLE");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 2_000_000) throw new Error("UPSTREAM_RESULT_TOO_LARGE");
  const text = await response.text();
  if (Buffer.byteLength(text) > 2_000_000) throw new Error("UPSTREAM_RESULT_TOO_LARGE");
  return JSON.parse(text) as T;
}

export interface OperationsConfiguration {
  timezone: string;
  prometheusUrl: string;
  lokiUrl: string;
  alertmanagerUrl: string;
}

export class OperationsService {
  constructor(private readonly sql: PostgresClient, private readonly config: OperationsConfiguration,
    private readonly fetcher: Fetcher = fetch) {}

  async days(days: number, sameTime: boolean, now = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: this.config.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const localDate = formatter.format(now);
    const localParts = new Intl.DateTimeFormat("en-GB", { timeZone: this.config.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now).reduce<Record<string, string>>((acc, part) => { acc[part.type] = part.value; return acc; }, {});
    const endDate = new Date(`${localDate}T00:00:00Z`);
    const startDate = new Date(endDate); startDate.setUTCDate(startDate.getUTCDate() - days + 1);
    const cutoff = `${localParts.hour}:${localParts.minute}:${localParts.second}`;
    const rows = await this.sql<ScalarRow[]>`
      WITH terminal AS (
        SELECT run.id, run.state, goal.candidate_id, goal.created_at, run.last_progress_at,
          (run.last_progress_at::timestamptz AT TIME ZONE ${this.config.timezone})::date AS local_day
        FROM agent_runs run JOIN agent_goals goal ON goal.id=run.goal_id
        WHERE run.state IN ('SUCCEEDED','FAILED')
          AND run.last_progress_at::timestamptz >= (${isoDate(startDate)}::date::timestamp AT TIME ZONE ${this.config.timezone})
          AND run.last_progress_at::timestamptz <= ${now.toISOString()}::timestamptz
          AND (NOT ${sameTime} OR (run.last_progress_at::timestamptz AT TIME ZONE ${this.config.timezone})::time <= ${cutoff}::time)
      ), retries AS (
        SELECT task.run_id, count(*) FILTER (WHERE attempt.attempt_number > 1)::integer AS retry_count
        FROM agent_attempts attempt JOIN agent_tasks task ON task.id=attempt.task_id
        WHERE task.run_id IN (SELECT id FROM terminal) GROUP BY task.run_id
      )
      SELECT terminal.local_day::text AS day, count(*)::integer AS terminal_runs,
        count(*) FILTER (WHERE terminal.state='SUCCEEDED')::integer AS successful_runs,
        count(*) FILTER (WHERE terminal.state='FAILED')::integer AS failures,
        count(DISTINCT terminal.candidate_id)::integer AS unique_candidates,
        coalesce(sum(retries.retry_count),0)::integer AS retries,
        round(avg(extract(epoch FROM (terminal.last_progress_at::timestamptz-terminal.created_at::timestamptz)))::numeric,2) AS avg_seconds
      FROM terminal LEFT JOIN retries ON retries.run_id=terminal.id GROUP BY terminal.local_day ORDER BY terminal.local_day`;
    const attemptRows = await this.sql<ScalarRow[]>`
      SELECT (attempt.finished_at::timestamptz AT TIME ZONE ${this.config.timezone})::date::text AS day,
        task.routing_class, count(*)::integer AS attempts,
        count(*) FILTER (WHERE attempt.state='FAILED')::integer AS failures,
        count(*) FILTER (WHERE attempt.attempt_number>1)::integer AS retries,
        round(avg(extract(epoch FROM (attempt.finished_at::timestamptz-attempt.started_at::timestamptz)))::numeric,2) AS avg_seconds
      FROM agent_attempts attempt JOIN agent_tasks task ON task.id=attempt.task_id
      WHERE attempt.finished_at IS NOT NULL
        AND attempt.finished_at::timestamptz >= (${isoDate(startDate)}::date::timestamp AT TIME ZONE ${this.config.timezone})
        AND attempt.finished_at::timestamptz <= ${now.toISOString()}::timestamptz
        AND task.routing_class IN ('control','documents','media','transcription','llm','reports','drive','notifications')
        AND (NOT ${sameTime} OR (attempt.finished_at::timestamptz AT TIME ZONE ${this.config.timezone})::time <= ${cutoff}::time)
      GROUP BY 1,2 ORDER BY 1,2`;
    const byDay = new Map(rows.map((row) => [String(row.day), row]));
    const attemptsByDay = new Map<string, Record<string, object>>();
    for (const row of attemptRows) {
      const group = attemptsByDay.get(String(row.day)) ?? {};
      group[String(row.routing_class)] = { attempts: number(row.attempts), failures: number(row.failures),
        retries: number(row.retries), avg_seconds: row.avg_seconds === null ? null : number(row.avg_seconds) };
      attemptsByDay.set(String(row.day), group);
    }
    const result = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(endDate); date.setUTCDate(date.getUTCDate() - offset);
      const day = isoDate(date);
      const row = byDay.get(day) ?? {};
      result.push({ date: day, partial_day: sameTime || day === localDate, cutoff_local: sameTime || day === localDate ? cutoff : "24:00:00",
        terminal_runs: number(row.terminal_runs), successful_runs: number(row.successful_runs), failures: number(row.failures),
        unique_candidates: number(row.unique_candidates), retries: number(row.retries),
        avg_seconds: row.avg_seconds === null || row.avg_seconds === undefined ? null : number(row.avg_seconds),
        by_routing_class: attemptsByDay.get(day) ?? {} });
    }
    const baseline = result.slice(0, -1).map((entry) => entry.unique_candidates);
    const baselineAverage = baseline.length ? baseline.reduce((sum, value) => sum + value, 0) / baseline.length : null;
    const current = result.at(-1)?.unique_candidates ?? 0;
    return { status: "ok", system: "hr", source: "PostgreSQL agent_runs + agent_goals + agent_attempts", timezone: this.config.timezone,
      as_of: now.toISOString(), same_time_cutoff: sameTime, days: result,
      comparison: { baseline_days: baseline.length, baseline_average_candidates: baselineAverage, latest_candidates: current,
        change_percent: baselineAverage ? Math.round((current / baselineAverage - 1) * 1000) / 10 : null },
      coverage: "retained_records_only",
      counting_note: "Terminal runs use agent_runs.last_progress_at; unique candidates are deduplicated per window; retries count attempts after the first; duration is goal creation to terminal run progress. by_routing_class counts technical task attempts, not candidates or source files. Deleted/expired records are not zero." };
  }

  async metrics(): Promise<string> {
    const [candidateStates, runStates, taskStates, totals] = await Promise.all([
      this.sql<ScalarRow[]>`SELECT coalesce(record_json::jsonb->>'status','UNKNOWN') AS label,count(*)::integer AS value FROM candidates GROUP BY 1`,
      this.sql<ScalarRow[]>`SELECT state AS label,count(*)::integer AS value FROM agent_runs GROUP BY state`,
      this.sql<ScalarRow[]>`SELECT state,routing_class,count(*)::integer AS value FROM agent_tasks GROUP BY state,routing_class`,
      this.sql<ScalarRow[]>`SELECT
        count(*) FILTER (WHERE state IN ('SUCCEEDED','FAILED') AND last_progress_at::timestamptz >= now()-interval '24 hours')::integer AS terminal_24h,
        count(*) FILTER (WHERE state='FAILED' AND last_progress_at::timestamptz >= now()-interval '1 hour')::integer AS failed_1h,
        coalesce(max(extract(epoch FROM (now()-last_progress_at::timestamptz))) FILTER (WHERE state='ACTIVE'),0)::double precision AS oldest_active
        FROM agent_runs`,
    ]);
    const lines = ["# HELP hh_ops_up HR operations exporter database query succeeded.", "# TYPE hh_ops_up gauge", "hh_ops_up 1"];
    for (const row of candidateStates) lines.push(`hh_candidates_current{status="${quoteLabel(row.label)}"} ${number(row.value)}`);
    for (const row of runStates) lines.push(`hh_agent_runs{state="${quoteLabel(row.label)}"} ${number(row.value)}`);
    for (const row of taskStates) lines.push(`hh_agent_tasks{state="${quoteLabel(row.state)}",routing_class="${quoteLabel(row.routing_class)}"} ${number(row.value)}`);
    const total = totals[0] ?? {};
    lines.push(`hh_terminal_runs_24h ${number(total.terminal_24h)}`);
    lines.push(`hh_failed_runs_1h ${number(total.failed_1h)}`);
    lines.push(`hh_oldest_active_run_seconds ${number(total.oldest_active)}`);
    return `${lines.join("\n")}\n`;
  }

  async metricHistory(metric: HrMetric, hours: number, now = new Date()) {
    const step = Math.max(60, Math.ceil(hours * 3600 / 240));
    const url = new URL("/api/v1/query_range", this.config.prometheusUrl);
    url.search = new URLSearchParams({ query: HR_METRICS[metric], start: String((now.getTime() - hours * 3_600_000) / 1000),
      end: String(now.getTime() / 1000), step: String(step) }).toString();
    const payload = await jsonWithLimit<{ data?: { result?: Array<{ values?: Array<[number, string]> }> } }>(this.fetcher, url.toString());
    const series = (payload.data?.result ?? []).slice(0, 8);
    const points = series.flatMap((item) => (item.values ?? []).slice(0, 241).map(([timestamp, value]) => {
      const parsed = Number(value); return { timestamp: new Date(Number(timestamp) * 1000).toISOString(), value: Number.isFinite(parsed) ? parsed : null };
    }));
    const finite = points.flatMap((point) => point.value === null ? [] : [point.value]);
    return { status: "ok", system: "hr", source: "HR Prometheus query_range", metric, unit: METRIC_UNITS[metric], hours, step_seconds: step,
      points, sampled_min: finite.length ? Math.min(...finite) : null, sampled_max: finite.length ? Math.max(...finite) : null,
      sampled_average: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null,
      finite_points: finite.length, coverage: finite.length ? "sampled" : "unavailable",
      note: "Sampled allowlisted metric. Missing/NaN points are unavailable, not zero." };
  }

  async logs(hours: number, level: string, limit: number, now = new Date()) {
    const selector = '{system="hr"}';
    const url = new URL("/loki/api/v1/query_range", this.config.lokiUrl);
    url.search = new URLSearchParams({ query: selector, start: `${now.getTime() - hours * 3_600_000}000000`,
      end: `${now.getTime()}000000`, limit: String(Math.min(limit * 5, 500)), direction: "backward" }).toString();
    const payload = await jsonWithLimit<{ data?: { result?: Array<{ stream?: Record<string, string>; values?: Array<[string, string]> }> } }>(this.fetcher, url.toString());
    const streams = payload.data?.result ?? [];
    const events = streams.flatMap((stream) => (stream.values ?? []).map(([timestamp, raw]) => sanitizeLogValue(timestamp, raw, stream.stream?.service)))
      .filter((event) => event !== undefined && (level === "all" || event.level === level))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
    return { status: "ok", system: "hr", source: "HR Loki allowlisted structured events", hours, level, events, limit,
      limit_reached: events.length >= limit, coverage: "filtered_events_only",
      note: "Raw lines, free text, IDs, labels, paths and stack traces are removed. Empty output does not prove there were no incidents." };
  }

  async alerts() {
    const url = new URL("/api/v2/alerts", this.config.alertmanagerUrl);
    url.search = new URLSearchParams({ active: "true", silenced: "false", inhibited: "false" }).toString();
    const payload = await jsonWithLimit<Array<{ labels?: Record<string, string>; status?: { state?: string }; startsAt?: string }>>(this.fetcher, url.toString());
    const alerts = Array.isArray(payload) ? payload.slice(0, 100).flatMap((item) => {
      const name = item.labels?.alertname;
      if (!name || !SAFE_ALERT_NAMES.has(name)) return [];
      const severity = item.labels?.severity;
      return [{ name, severity: ["warning", "critical"].includes(severity ?? "") ? severity : "warning",
        state: item.status?.state === "active" ? "firing" : "unknown", starts_at: item.startsAt ?? null }];
    }) : [];
    try {
      const prometheus = new URL("/api/v1/query", this.config.prometheusUrl);
      prometheus.search = new URLSearchParams({ query: 'up{job="prometheus"}' }).toString();
      const probe = await jsonWithLimit<{ data?: { result?: Array<{ value?: [number, string] }> } }>(this.fetcher, prometheus.toString());
      if (Number(probe.data?.result?.[0]?.value?.[1]) !== 1) throw new Error("PROMETHEUS_NOT_READY");
    } catch {
      alerts.push({ name: "HrPrometheusUnavailable", severity: "critical", state: "firing", starts_at: null });
    }
    return { status: "ok", system: "hr", source: "HR Alertmanager active unsilenced alerts", alerts, count: alerts.length };
  }

  async overview(now = new Date()) {
    const [days, alerts, health] = await Promise.all([
      this.days(1, true, now), this.alerts(),
      Promise.all((["web_up", "processing_ready", "request_rate", "active_connections", "queue_ready", "consumer_count", "host_cpu_percent", "host_memory_percent", "disk_free_percent"] as HrMetric[])
        .map(async (metric) => { const value = await this.metricHistory(metric, 1, now); return [metric, value.points.at(-1)?.value ?? null] as const; })),
    ]);
    return { status: "ok", system: "hr", as_of: now.toISOString(), timezone: this.config.timezone,
      today: days.days[0], health: Object.fromEntries(health), active_alerts: alerts.alerts,
      sources: ["PostgreSQL aggregates", "HR Prometheus", "HR Alertmanager"],
      limitations: "Read-only aggregate view; no candidate identity/content, raw logs, arbitrary queries, host shell or control actions." };
  }
}
