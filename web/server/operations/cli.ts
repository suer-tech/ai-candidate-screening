import { serverContainer } from "../configuration/container.ts";
import { OperationsService } from "./service.ts";
import { createOperationsServer } from "./server.ts";

const container = await serverContainer();
const token = container.environment.OPS_READ_INTERNAL_TOKEN;
if (!token || token.length < 32) throw new Error("OPS_READ_INTERNAL_TOKEN_REQUIRED");
const host = container.environment.OPS_HOST || "127.0.0.1";
const port = Number(container.environment.OPS_PORT || 4313);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("OPS_PORT_INVALID");
const service = new OperationsService(container.sql, {
  timezone: container.environment.OPS_TIMEZONE || "Asia/Yekaterinburg",
  prometheusUrl: container.environment.OPS_PROMETHEUS_URL || "http://prometheus:9090",
  lokiUrl: container.environment.OPS_LOKI_URL || "http://loki:3100",
  alertmanagerUrl: container.environment.OPS_ALERTMANAGER_URL || "http://alertmanager:9093",
});
const server = createOperationsServer(service, token);
server.listen(port, host, () => console.log(JSON.stringify({ event: "ops-gateway-ready", host, port, system: "hr" })));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
