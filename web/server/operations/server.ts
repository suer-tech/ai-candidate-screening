import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { authorized, boolean, integer, metricName } from "./contracts.ts";
import { OperationsService } from "./service.ts";

const PRIVATE_HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, PRIVATE_HEADERS); response.end(JSON.stringify(body));
}

function exactQuery(url: URL, allowed: readonly string[]) {
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key))) throw new Error("INVALID_ARGUMENT");
}

export function createOperationsServer(service: OperationsService, token: string) {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://ops.internal");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ready: true, system: "hr" });
    if (request.method === "GET" && url.pathname === "/metrics") {
      try { response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" }); response.end(await service.metrics()); }
      catch { response.writeHead(503, { "content-type": "text/plain; charset=utf-8" }); response.end("hh_ops_up 0\n"); }
      return;
    }
    if (request.method !== "GET" || !url.pathname.startsWith("/v1/")) return json(response, 404, { status: "unavailable", reason: "not_found" });
    if (!authorized(request.headers.authorization, token)) return json(response, 401, { status: "unavailable", reason: "unauthorized" });
    try {
      if (url.pathname === "/v1/days") { exactQuery(url, ["days", "same_time"]); return json(response, 200, await service.days(integer(url.searchParams.get("days"), 8, 1, 31), boolean(url.searchParams.get("same_time"), true))); }
      if (url.pathname === "/v1/metrics") { exactQuery(url, ["metric", "hours"]); return json(response, 200, await service.metricHistory(metricName(url.searchParams.get("metric")), integer(url.searchParams.get("hours"), 24, 1, 720))); }
      if (url.pathname === "/v1/logs") {
        exactQuery(url, ["hours", "level", "limit"]);
        const level = url.searchParams.get("level") ?? "error";
        if (!["all", "debug", "info", "warning", "error", "critical"].includes(level)) throw new Error("INVALID_ARGUMENT");
        return json(response, 200, await service.logs(integer(url.searchParams.get("hours"), 24, 1, 336), level, integer(url.searchParams.get("limit"), 30, 1, 100)));
      }
      if (url.pathname === "/v1/overview") { exactQuery(url, []); return json(response, 200, await service.overview()); }
      if (url.pathname === "/v1/alerts") { exactQuery(url, []); return json(response, 200, await service.alerts()); }
      return json(response, 404, { status: "unavailable", reason: "unknown_operation" });
    } catch (error) {
      const invalid = error instanceof Error && error.message === "INVALID_ARGUMENT";
      return json(response, invalid ? 422 : 503, { status: "unavailable", reason: invalid ? "invalid_arguments" : "upstream_unavailable" });
    }
  });
}
