## MODIFIED Requirements

### Requirement: INT-005 [CONFIRMED] Personal My Drive OAuth и root `Найм`
Рабочая структура MUST находиться в личном Google My Drive подключённого владельца в root-папке `Найм`. Приложение MUST использовать server-side OAuth 2.0 authorization-code flow с PKCE, offline access и зашифрованным refresh token; доступ MUST быть ограничен выбранным root и зарегистрированными потомками через tool grants. Shared Drive, service account, domain-wide delegation и управление участниками MUST NOT требоваться или присутствовать в active конфигурации.

#### Scenario: Приложение обращается к рабочей области
- **WHEN** production-компонент читает материалы или создаёт отчёт
- **THEN** запрос выполняется от подключённого OAuth account только внутри зарегистрированного root `Найм`
- **AND** exact operation подтверждена durable tool grant

#### Scenario: Refresh token отозван
- **WHEN** Google возвращает `invalid_grant` либо account отключён
- **THEN** Drive effects прекращаются и run переходит в `WAITING_FOR_HUMAN` с действием переподключения

#### Scenario: Конфигурация содержит corporate Google credentials
- **WHEN** preflight обнаруживает service-account JSON, Shared Drive ID или domain delegation option
- **THEN** конфигурация отклоняется как устаревшая и не загружается

### Requirement: OPS-006 [CONFIRMED] Фоновая Node-среда на VPS
FFmpeg, ожидание AssemblyAI и другие long-running/effectful agent tasks MUST выполняться в постоянных Node-процессах на локальном компьютере либо Ubuntu VPS с временным диском, PostgreSQL и server secrets. Web/API MAY публиковать trigger и читать projection, но MUST NOT выполнять long-running workflow в request lifecycle. Cloudflare Worker MUST NOT быть production dependency.

#### Scenario: Загружено видео
- **WHEN** web/API принимает новое задание
- **THEN** оно атомарно публикует durable task в PostgreSQL, а фоновый Node worker выполняет media stage

#### Scenario: Background worker перезапущен
- **WHEN** systemd перезапускает процесс во время задания
- **THEN** worker восстанавливает claim/checkpoint из PostgreSQL и продолжает без повторения подтверждённого внешнего эффекта

## ADDED Requirements

### Requirement: OPS-007 [CONFIRMED] Единая локальная и VPS topology
Локальный и VPS контуры MUST использовать одинаковые Node entrypoints, PostgreSQL migrations, readiness probes и service-to-service authentication. Различаться MAY только hostnames, TLS termination, resource limits и secret values.

#### Scenario: Локальный contour принят
- **WHEN** локальный E2E получает GREEN
- **THEN** evidence фиксирует Node/PostgreSQL topology и не использует Miniflare, Wrangler D1/R2 или controlled storage substitute
