## ADDED Requirements

### Requirement: QG-050 [CONFIRMED] PostgreSQL migration acceptance
Release MUST пройти на чистой и upgrade PostgreSQL schema: migrations, constraints/triggers, concurrent claim/fencing, restart, outbox/reconcile, cascade/retention, blob checksum и backup/restore smoke. D1/SQLite-only GREEN MUST NOT удовлетворять этому gate.

#### Scenario: Проверяется upgrade
- **WHEN** предыдущая supported schema обновляется текущими migrations
- **THEN** row counts, identities, revisions, encrypted OAuth envelope, outbox и immutable artifact checksums сохраняются

### Requirement: QG-051 [CONFIRMED] Независимый RED для миграции
До реализации независимый субагент MUST создать падающие acceptance scenarios для PostgreSQL topology, отсутствия Cloudflare runtime, real-candidate benchmark isolation и progress bars. Реализация считается выполненной только после GREEN этих tests и полного regression.

#### Scenario: Реализация ещё использует D1/R2
- **WHEN** acceptance harness вызывает production storage/runtime boundary
- **THEN** тест содержательно падает на Cloudflare dependency, а не на syntax/import/fixture error

### Requirement: QG-052 [CONFIRMED] Real-candidate benchmark release gate
После любого изменения provider model, prompt, schema, extraction, assessment, recommendation, validation или reports MUST выполняться приватный benchmark на локальном PostgreSQL с тем же явно утверждённым profile fingerprint. Любой profile mismatch, hard oracle failure либо incomplete cleanup MUST блокировать release; сравнение MUST сохранять оба generated PDF только в private evidence area до завершения review/retention и затем доказывать их удаление.

#### Scenario: Изменена инструкция модели
- **WHEN** build содержит новую prompt/model configuration
- **THEN** прежний benchmark evidence не переиспользуется и требуется новый полный run с новым fingerprint

### Requirement: QG-053 [CONFIRMED] Progress UI acceptance
Rendered UI tests MUST доказать наличие корректной accessible progress bar в dashboard processing card и каждой candidate list card, одинаковый server-derived процент и отсутствие browser-inferred/fake progress.

#### Scenario: Projection сообщает 55 процентов
- **WHEN** dashboard и список получают одного кандидата с `progressPercent=55`
- **THEN** обе карточки отображают 55%, одинаковый milestone и `aria-valuenow=55`

### Requirement: QG-055 [CONFIRMED] Local canonical E2E использует PostgreSQL runtime
Четыре обязательных `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` MUST выполняться последовательно на одном immutable local build/config/fixture identity через собранный Node web/API, постоянный worker и PostgreSQL той же major/schema version. Test-control plane MUST создавать synthetic run через application boundary и выводить evidence из durable PostgreSQL state и созданных artifacts; прямой вызов in-memory canonical pipeline либо SQLite fixture state MUST NOT закрывать этот gate. Детерминированный synthetic RouterAI-compatible provider MAY использоваться только для стабильного oracle, MUST быть явно отмечен controlled и MUST NOT создавать VPS production-like claim.

#### Scenario: Controlled local conformance прошёл без application runtime
- **WHEN** четыре сценария вызвали pipeline напрямую либо fixture controller сохранил run только в SQLite
- **THEN** hermetic conformance MAY быть GREEN, но local canonical E2E gate остаётся незавершённым

#### Scenario: Local PostgreSQL E2E завершён
- **WHEN** все четыре сценария прошли через один запущенный Node/PostgreSQL build и обязательный cleanup завершён
- **THEN** safe evidence содержит совпадающие build/config/fixture/schema fingerprints и `productionLikeAcceptanceClaimed=false`

### Requirement: QG-054 [CONFIRMED] VPS production-like gate
Production readiness MAY быть заявлена только на одном immutable VPS build/config identity после PostgreSQL preflight, четырёх обязательных E2E, revoke/reconnect, restart/reconcile, real-provider smoke, backup/restore и secret/config audit. Skipped, controlled либо SQLite evidence MUST оставлять change незавершённым.

#### Scenario: Локальный contour GREEN, VPS не проверен
- **WHEN** все локальные tests прошли, но immutable VPS evidence отсутствует
- **THEN** система MAY считаться локально готовой, но MUST NOT считаться production-ready
