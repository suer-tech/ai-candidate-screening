## ADDED Requirements

### Requirement: OPS-007 [CONFIRMED] Инфраструктурная наблюдаемость production runtime
Production deployment MUST собирать историю availability, HTTP probes, RabbitMQ queues/consumers, PostgreSQL-derived workflow aggregates, host/container resources и safe application events. Monitoring components MUST restart automatically and use persistent storage with bounded retention.

#### Scenario: VPS или compose перезапущены
- **WHEN** Docker восстанавливает production stack
- **THEN** monitoring services запускаются автоматически
- **AND** retained metrics, logs, dashboards и alert state используют persistent volumes

### Requirement: OPS-008 [CONFIRMED] Operations gateway является отдельной read-only boundary
Operations gateway MUST NOT выполнять product mutations, provider calls, Drive operations, Telegram sends, runtime commands, restart, deploy или code changes. Его database access MUST выполнять только hard-coded aggregate SELECT operations.

#### Scenario: Администратор спрашивает Pulse о состоянии HR
- **WHEN** gateway обслуживает read request
- **THEN** product state и external systems не изменяются

