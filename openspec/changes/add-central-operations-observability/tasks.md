## 1. Contract and security boundary

- [x] 1.1 Add normative operations, security and quality delta specs.
- [x] 1.2 Add constant-time token authentication, fixed query allowlists and bounded response tests.
- [x] 1.3 Add idempotent creation of the HR operations token without rotating existing tokens.

## 2. HR runtime observability

- [x] 2.1 Implement the operations service metrics and aggregate day history.
- [x] 2.2 Implement bounded Prometheus, Loki, overview and active-alert reads.
- [x] 2.3 Add Prometheus, Alertmanager, Loki, Grafana, Alloy, node/container/HTTP exporters and durable volumes to VPS compose.
- [x] 2.4 Add dashboards and alert rules for availability, host/container capacity, RabbitMQ backlog/consumers, failures and stalled work.
- [x] 2.5 Keep Grafana loopback-only and protect the operations route with TLS, bearer auth and nginx source-IP allowlist.

## 3. Shared Pulse

- [x] 3.1 Add HR connection settings and a fail-closed HTTP client to OCR admin-bot.
- [x] 3.2 Add `hr_days`, `hr_metric_history`, `hr_log_events` and `hr_overview` tools with explicit system labels.
- [x] 3.3 Update Pulse instructions to select and compare systems without mixing units or missing-data semantics.
- [x] 3.4 Add deduplicated HR firing/resolved and monitoring-unavailable notifications to the existing bot.

## 4. Verification and operations

- [x] 4.1 Validate TypeScript/Python tests and static compose/config contracts.
- [x] 4.2 Validate rendered Prometheus/Alertmanager/Alloy/Grafana configuration.
- [x] 4.3 Document HR VPS rollout, token transfer, firewall/IP allowlist, SSH Grafana tunnel and rollback.
- [ ] 4.4 Run production-like two-VPS smoke: scrape, log ingestion, test alert, Pulse HR question and recovery notification. Do not mark complete without external evidence.
