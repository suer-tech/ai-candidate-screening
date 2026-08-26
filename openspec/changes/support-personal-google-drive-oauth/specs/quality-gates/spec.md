## MODIFIED Requirements

### Requirement: TST-011 [CONFIRMED] Стартовые условия E2E-VAC-001
Тест MUST начинаться в авторизованном HR UI под единой ролью `HR-владелец вакансии`, с provisioned personal Google Drive OAuth, настроенным LLM и разделами вакансий, кандидатов и дашборда. Подготовка MUST подтвердить External OAuth web client, active offline grant ожидаемого Gmail, production-personal deployment mode, root `Найм`, чтение входов, создание выходов и отсутствие tokens в evidence. Проверка авторизации MUST подтвердить полный доступ одного HR к вакансии и кандидату другого HR и отказ неаутентифицированному запросу.

#### Scenario: Среда неполна
- **WHEN** OAuth connection, root binding или другой обязательный компонент недоступен
- **THEN** прогон не объявляется полноценным E2E-VAC-001

#### Scenario: Проверяются права сервисного аккаунта
- **WHEN** preflight обнаруживает service-account credential вместо personal OAuth connection
- **THEN** production E2E блокируется как неподдерживаемая конфигурация

#### Scenario: Проверяется личный OAuth grant
- **WHEN** provisioned personal connection проходит проверку
- **THEN** чтение созданного HR входа и создание результата в root разрешены после token refresh
- **AND** доступ к несвязанному контрольному файлу отклонён application grant

#### Scenario: Второй HR открывает общие данные
- **WHEN** один авторизованный HR открывает или редактирует вакансию и кандидата другого HR
- **THEN** операция разрешена единой ролью MVP

#### Scenario: Неавторизованный запрос обращается к данным
- **WHEN** запрос без действующей аутентификации открывает вакансию, кандидата или OAuth route
- **THEN** данные и operation недоступны

## ADDED Requirements

### Requirement: TST-120 [CONFIRMED] Приёмка личного Google Drive OAuth
Независимая приёмка MUST зафиксировать ожидаемый RED до реализации и проверить отсутствие service-account dependency, local callback, one-time state/PKCE, encrypted refresh token, production-personal readiness, restart refresh, root confinement, обнаружение вручную добавленных HR files, publication/reconcile PDF, cleanup, revoke, `WAITING_FOR_HUMAN`, reconnect и resume без дублей. Тесты MUST использовать отдельный Google Cloud test project и synthetic data; evidence MUST NOT содержать OAuth code, client secret или tokens.

#### Scenario: Worker перезапущен
- **WHEN** checkpointed pipeline продолжает работу после потери in-memory access token
- **THEN** новый access token получается по зашифрованному refresh token
- **AND** внешний side effect не дублируется

#### Scenario: Testing grant заявлен как production
- **WHEN** production preflight получает deployment mode `testing`
- **THEN** gate падает с безопасным кодом долговечности grant

#### Scenario: Grant отозван и восстановлен
- **WHEN** Google возвращает `invalid_grant`, затем owner переподключает ожидаемый account
- **THEN** тест наблюдает содержательную эскалацию и resume с checkpoint
- **AND** candidate, folders, versions и PDF не дублируются

#### Scenario: Проверяются секреты
- **WHEN** тест читает browser responses, D1 diagnostics, task payload, logs и evidence
- **THEN** OAuth code, client secret, refresh token и access token отсутствуют
