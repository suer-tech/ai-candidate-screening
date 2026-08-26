## MODIFIED Requirements

### Requirement: INT-005 [CONFIRMED] Владение Shared Drive и сервисный аккаунт
Рабочая структура MUST находиться в `Моём диске` явно подключённого личного Gmail и MUST использовать server-side offline OAuth grant как единственную Google Drive credential boundary. Приложение MUST автоматически обновлять access token, ограничивать operations корнем `Найм`, читать входные материалы и создавать выходные отчёты без Shared Drive, service account или локального backend. Client credentials и refresh token MUST поступать только через согласованные защищённые границы.

#### Scenario: Приложение обращается к рабочей области
- **WHEN** production-компонент читает материалы или создаёт отчёт
- **THEN** запрос выполняется через Google Drive API от active OAuth connection личного Gmail
- **AND** application grant ограничен root `Найм` и необходимой operation

#### Scenario: Учётная запись HR отключена
- **WHEN** отдельный HR теряет app-доступ
- **THEN** Drive connection не меняется без явного disconnect владельцем интеграции

#### Scenario: Приложение пытается управлять участниками
- **WHEN** Drive operation запрашивает управление доступом или участниками вместо согласованного file workflow
- **THEN** operation отклоняется application policy

#### Scenario: OAuth grant отозван
- **WHEN** Gmail owner отзывает доступ приложения
- **THEN** новые Drive effects блокируются и runtime создаёт `WAITING_FOR_HUMAN` с повторным подключением

#### Scenario: Передана Shared Drive конфигурация
- **WHEN** startup получает Shared Drive ID либо service-account JSON как Drive backend
- **THEN** readiness отклоняет неподдерживаемую конфигурацию
