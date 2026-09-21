import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("HR monitoring stack is persistent, private and source-IP restricted", async () => {
  const [vps, monitoring, nginx, prometheus, alerts, alloy, loki, datasources, dashboard] = await Promise.all([
    read("deploy/docker/docker-compose.vps.yml"), read("deploy/docker/docker-compose.observability.yml"),
    read("deploy/docker/nginx.conf.template"), read("deploy/docker/observability/prometheus/prometheus.yml"),
    read("deploy/docker/observability/prometheus/alerts.yml"), read("deploy/docker/observability/alloy/config.alloy"),
    read("deploy/docker/observability/loki/config.yml"), read("deploy/docker/observability/grafana/provisioning/datasources/datasources.yml"),
    read("deploy/docker/observability/grafana/provisioning/dashboards/json/hr-overview.json"),
  ]);
  assert.match(vps, /docker-compose\.observability\.yml/);
  for (const service of ["ops-gateway", "prometheus", "alertmanager", "loki", "alloy", "node-exporter", "cadvisor", "blackbox-exporter", "nginx-exporter", "grafana"]) {
    assert.match(monitoring, new RegExp(`  ${service}:`));
  }
  const published = [...monitoring.matchAll(/^\s+-\s+"([^"]+):([^"]+)"\s*$/gm)].map((match) => match[0].trim());
  assert.deepEqual(published, ['- "127.0.0.1:${HH_GRAFANA_PORT:-3002}:3000"']);
  assert.match(nginx, /location \^~ \/api\/ops\//);
  assert.match(nginx, /allow \$\{HH_OPS_ALLOWED_IP\};\s*\r?\n\s*deny all;/);
  assert.match(nginx, /proxy_set_header Authorization \$http_authorization/);
  assert.doesNotMatch(nginx, /location[^\n]*(prometheus|loki|grafana|alertmanager)/i);
  assert.match(prometheus, /job_name: rabbitmq/);
  assert.match(prometheus, /job_name: blackbox/);
  assert.match(prometheus, /job_name: nginx/);
  for (const alertName of ["HrWebDown", "HrProcessingNotReady", "HrRabbitMqConsumerMissing", "HrProcessingStalled", "HrHostDiskLow"]) {
    assert.match(alerts, new RegExp(`alert: ${alertName}`));
  }
  assert.match(alloy, /com\.docker\.compose\.project=hh-agent/);
  assert.match(alloy, /replacement\s+= "hr"/);
  assert.match(loki, /retention_period: 336h/);
  assert.match(datasources, /http:\/\/prometheus:9090/);
  assert.match(datasources, /http:\/\/loki:3100/);
  assert.equal(JSON.parse(dashboard).uid, "hr-operations-overview");
});

test("operations credential is file-backed and can be added without rotating existing tokens", async () => {
  const [runtime, generator, ensure, compose] = await Promise.all([
    read("web/server/configuration/runtime.ts"), read("web/scripts/generate-internal-service-tokens.ts"),
    read("web/scripts/ensure-ops-read-token.ts"), read("deploy/docker/docker-compose.observability.yml"),
  ]);
  assert.match(generator, /OPS_READ_INTERNAL_TOKEN/);
  assert.match(ensure, /\.\.\.current, OPS_READ_INTERNAL_TOKEN/);
  assert.doesNotMatch(compose, /OPS_READ_INTERNAL_TOKEN\s*:/);
  assert.match(compose, /config-root:\/config:ro/);
  assert.match(runtime, /internal-service-tokens\.json/);
});
