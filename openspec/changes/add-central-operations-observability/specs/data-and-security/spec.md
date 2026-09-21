## ADDED Requirements

### Requirement: SEC-011 [CONFIRMED] Минимизация remote operations данных
Remote operations contract MUST возвращать только агрегированные counts/durations, allowlisted metrics и allowlisted structured event metadata. Даже авторизованный Pulse MUST NOT получать raw персональные или произвольные technical records.

#### Scenario: Pulse запрашивает ошибки
- **WHEN** Loki содержит safe JSON event и произвольный raw exception output
- **THEN** gateway может вернуть allowlisted event/safeCode/count/duration
- **AND** raw exception, stack, identifiers и исходная строка не возвращаются

### Requirement: SEC-012 [CONFIRMED] Operations credential изолирован и ротируется отдельно
`OPS_READ_INTERNAL_TOKEN` MUST храниться at rest только в credential file, иметь не менее 32 bytes entropy и не попадать в compose/user environment, argv, logs, Git или responses. Trusted runtime MAY проецировать credential в environment только внутри isolated application process по существующему internal-service-token contract. Добавление token в существующий credential JSON MUST сохранять все существующие credentials; ротация MUST быть явной отдельной операцией.

#### Scenario: Monitoring включается на существующем VPS
- **WHEN** token отсутствует в существующем `internal-service-tokens.json`
- **THEN** idempotent provisioning добавляет только `OPS_READ_INTERNAL_TOKEN`
- **AND** значения остальных tokens не меняются
