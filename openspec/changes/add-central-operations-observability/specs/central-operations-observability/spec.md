## Purpose

Определить безопасную техническую наблюдаемость HR runtime и единый read-only Pulse для раздельного контроля HR и OCR.

## ADDED Requirements

### Requirement: OBS-001 [CONFIRMED] Локальная история метрик и логов HR
HR VPS MUST собирать в локальные persistent Prometheus и Loki business, HTTP, RabbitMQ, host, container и component-health signals. Grafana MUST использовать эти локальные datasources и MUST быть опубликована только на loopback host interface.

#### Scenario: Внешний клиент обращается к monitoring ports
- **WHEN** клиент не находится на HR VPS
- **THEN** Prometheus, Loki, Alertmanager, exporters и Grafana недоступны напрямую
- **AND** оператор может открыть Grafana через SSH tunnel

### Requirement: OBS-002 [CONFIRMED] Безопасный operations gateway
Remote monitoring MUST предоставляться только фиксированными read-only operations. Gateway MUST требовать отдельный bearer token, сравнивать его constant-time, применять timeout и result limits и находиться за TLS source-IP allowlist. Arbitrary SQL, PromQL, LogQL, URL, shell и filesystem input MUST отсутствовать.

#### Scenario: Pulse запрашивает историю HR
- **WHEN** source IP и bearer token разрешены, operation и arguments входят в allowlist
- **THEN** gateway возвращает bounded aggregate result с `system=hr`, source, window и coverage

#### Scenario: Запрос пытается выбрать произвольный источник
- **WHEN** request содержит неизвестную operation, metric, label, query либо лишнее поле
- **THEN** gateway отклоняет запрос без исполнения переданного выражения

### Requirement: OBS-003 [CONFIRMED] Наблюдаемость не раскрывает данные кандидата
Remote operations responses MUST NOT содержать candidate/vacancy names или identifiers, Drive IDs, source names, resume/interview/transcript text, evidence, prompts, raw logs, stack traces, paths, URLs, secrets либо arbitrary database/log fields. Counts MAY группироваться только по каноническому state, stage, routing class, outcome, safe event и safe error code.

#### Scenario: Application log содержит identifiers
- **WHEN** allowlisted event содержит одновременно technical IDs или free text
- **THEN** remote log operation возвращает только allowlisted event metadata
- **AND** исходная строка и identifiers отсутствуют

### Requirement: OBS-004 [CONFIRMED] HR workload history имеет явную семантику
Daily history MUST различать terminal runs, successful runs, failures, unique candidates, retries и durations. Сравнение неполного текущего дня MUST использовать тот же local-time cutoff предшествующих дней. Missing/expired/partial coverage MUST NOT интерпретироваться как zero или полный период.

#### Scenario: Администратор спрашивает, много ли кандидатов сегодня
- **WHEN** Pulse сравнивает текущий день с предыдущими
- **THEN** ответ указывает timezone, cutoff, даты, actual count, baseline и coverage
- **AND** не сравнивает partial day с полными днями и не экстраполирует итог дня

### Requirement: OBS-005 [CONFIRMED] Alerts обнаруживают критические operational states
Prometheus MUST оценивать availability, scrape failure, host disk/memory, container CPU/memory, RabbitMQ consumer/backlog, terminal failures, dispatch lag и stalled processing. Alertmanager MUST group и deduplicate alerts. Краткие transient values MUST использовать `for` interval, кроме полного исчезновения обязательного monitoring target.

#### Scenario: Обязательный RabbitMQ pool потерял consumers
- **WHEN** consumer count остаётся нулевым дольше configured interval
- **THEN** alert становится firing с system `hr`, severity и безопасным summary
- **AND** данные кандидата отсутствуют

### Requirement: OBS-006 [CONFIRMED] Один Pulse различает OCR и HR
Existing Telegram bot MUST отвечать по OCR, HR или обоим контурам. Tools и результаты MUST иметь явный system identity. Pulse MUST NOT складывать документы OCR и кандидатов HR либо смешивать их latency/error units без раздельных значений.

#### Scenario: Вопрос не называет систему
- **WHEN** смысл вопроса применим к обоим контурам
- **THEN** Pulse запрашивает оба источника либо явно сообщает, какой источник использован
- **AND** вывод содержит отдельные OCR и HR sections

### Requirement: OBS-007 [CONFIRMED] Telegram alerts переживают частичный отказ
Existing bot MUST доставлять deduplicated HR firing/resolved notifications и MUST отдельно обнаруживать повторяющуюся недоступность HR gateway. Сбой HR monitoring MUST NOT останавливать OCR dialog, OCR alerts или Telegram polling.

#### Scenario: HR VPS недоступен, OCR VPS работает
- **WHEN** несколько последовательных HR probes завершились ошибкой
- **THEN** bot отправляет одно уведомление о потере HR visibility
- **AND** после восстановления отправляет одно resolved уведомление
- **AND** продолжает обслуживать OCR requests

