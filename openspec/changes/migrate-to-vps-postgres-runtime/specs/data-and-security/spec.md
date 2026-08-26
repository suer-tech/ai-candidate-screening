## MODIFIED Requirements

### Requirement: SEC-003 [CONFIRMED] Хранение секретов
Сервисные ключи MUST NOT храниться в коде, OpenSpec, PostgreSQL, browser state или логах. Google OAuth client secret, versioned token-encryption keyring, API-ключ RouterAI, AssemblyAI key, Telegram bot token, allowed Telegram recipients и database password MUST поступать только из одного server-only каталога secret files либо эквивалентного systemd credential mechanism. Non-secret runtime параметры MUST находиться в одном env-файле. Shared Drive ID, service-account JSON, domain delegation и Cloudflare credentials MUST отсутствовать в active templates и readiness.

#### Scenario: Компоненту нужен ключ
- **WHEN** server или worker запускается
- **THEN** secret загружается из allowlisted файла с проверенными владельцем/правами и не передаётся в command line

#### Scenario: Настраивается personal Google Drive
- **WHEN** оператор задаёт Google OAuth client
- **THEN** client ID находится в non-secret env, client secret и encryption keyring — в secret files
- **AND** refresh token сохраняется в PostgreSQL только как AES-256-GCM envelope

#### Scenario: Личный токен HR доступен разработчику
- **WHEN** настраивается production-интеграция Google Drive
- **THEN** разработчик не копирует access/refresh token в конфигурацию, а владелец выполняет server-side OAuth consent
- **AND** полученный refresh token доступен только token provider после расшифровки envelope

#### Scenario: Обнаружен устаревший corporate secret
- **WHEN** config audit видит service-account key либо Cloudflare token/binding
- **THEN** preflight сообщает точный устаревший параметр без значения и требует удалить его до production start

#### Scenario: Настраивается RouterAI
- **WHEN** оператор задаёт RouterAI и AssemblyAI API keys
- **THEN** каждое значение хранится в документированном allowlisted secret file
- **AND** browser/readiness/evidence показывают только configured boolean

#### Scenario: Настраивается Telegram-бот
- **WHEN** оператор задаёт token Telegram-бота
- **THEN** значение хранится в документированном allowlisted secret file
- **AND** browser/readiness/evidence показывают только configured boolean

#### Scenario: Настраиваются получатели Telegram
- **WHEN** оператор задаёт allowed recipient registry
- **THEN** registry хранится в server-only secret file
- **AND** browser/readiness/evidence показывают только безопасный recipient count без `chat_id`

## ADDED Requirements

### Requirement: SEC-031 [CONFIRMED] Защита PostgreSQL и backups
PostgreSQL MUST слушать loopback/private interface, использовать отдельного application role без superuser и TLS при non-loopback соединении. Backup MUST быть зашифрован, иметь ограниченные права и retention; restore test MUST использовать отдельные credentials и MUST NOT отправлять данные внешним сервисам.

#### Scenario: Проверяется database exposure
- **WHEN** production preflight проверяет PostgreSQL
- **THEN** public unauthenticated access отсутствует, application role не имеет superuser/createdb/createrole и backup location недоступен web user

### Requirement: SEC-032 [CONFIRMED] Приватность real-candidate benchmark
Consent proof MUST проверяться локально до чтения benchmark inputs. Reference reports и их производные MUST оставаться локальными, ignored и недоступными runtime/provider code; benchmark logs/evidence MUST содержать только opaque fixture ID, fingerprints, агрегированные scores и safe failure categories. Approved profile snapshot и generated PDF для review MUST находиться только в ignored private directory с owner-only permissions, checksum и hard retention deadline; после review/deadline MUST выполняться доказуемое удаление.

#### Scenario: Benchmark пишет evidence
- **WHEN** обработан согласованный реальный кандидат
- **THEN** evidence scan не находит имя, email, телефон, текст резюме/стенограммы, reference text, Drive/provider IDs или credentials

#### Scenario: Consent отсутствует или не подтверждён manifest
- **WHEN** benchmark preflight не может доказать локальный consent-proof
- **THEN** ни один файл кандидата не читается pipeline и ни один provider не вызывается

#### Scenario: Generated PDF сохранены для review
- **WHEN** полный benchmark сформировал два отчёта
- **THEN** локальные copies доступны только оператору, не содержатся в source/log/evidence JSON и не передаются сетевым endpoints
- **AND** retention metadata не раскрывает filename или персональный текст

#### Scenario: Review завершён или retention истёк
- **WHEN** наступает первое из этих событий
- **THEN** generated PDF удаляются, а safe evidence содержит только количество удалённых файлов и fingerprints
