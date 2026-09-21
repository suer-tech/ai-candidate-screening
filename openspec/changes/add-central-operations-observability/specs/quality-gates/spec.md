## ADDED Requirements

### Requirement: TST-098 [CONFIRMED] Operations boundary проверяется на раскрытие и произвольные запросы
Acceptance MUST проверять invalid/missing token, unknown operation, extra arguments, range limits, upstream timeout, oversized result и response key denylist. Fixtures MUST содержать synthetic PII, IDs, URLs, paths, secrets и stack text и доказывать их отсутствие в remote responses.

#### Scenario: Malicious log fixture обработана
- **WHEN** log line содержит allowlisted event вместе с synthetic personal и secret fields
- **THEN** response сохраняет только разрешённые fields
- **AND** sentinel scan не находит запрещённые значения

### Requirement: TST-099 [CONFIRMED] Monitoring configuration валидируется до deployment
Acceptance MUST parse compose, Prometheus rules/config, Alertmanager config, Alloy config, Grafana provisioning и nginx template; MUST verify private ports, persistent volumes, restart policy, healthchecks, source-IP allowlist and credential-file use.

#### Scenario: Monitoring compose принят
- **WHEN** static and container configuration tests выполнены
- **THEN** ни один monitoring data port кроме loopback Grafana не опубликован
- **AND** operations route имеет двойную network/token protection

### Requirement: TST-100 [CONFIRMED] Две системы проверяются production-like smoke
Release evidence MUST include real scrape, Loki safe event, firing/resolved synthetic alert, successful Pulse HR query, separate OCR query and HR gateway outage/recovery notification. Unit/static tests MUST NOT сами по себе давать production-ready status.

#### Scenario: Локальные тесты зелёные, two-VPS smoke не выполнен
- **WHEN** change готовится к production deployment
- **THEN** implementation MAY быть опубликована для rollout
- **AND** production readiness остаётся `BLOCKED` до внешнего evidence
