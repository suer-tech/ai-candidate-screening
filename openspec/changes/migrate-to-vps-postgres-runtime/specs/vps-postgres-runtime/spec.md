## Purpose

Определяет принадлежащий оператору PostgreSQL/Node runtime для локального и Ubuntu VPS контуров без обязательной зависимости от Cloudflare storage или execution services.

## ADDED Requirements

### Requirement: VPS PostgreSQL является production source of truth
Production-система MUST хранить продуктовые сущности, OAuth state, durable goals/runs/tasks, leases, checkpoints, budgets, memory metadata, audit, outbox, metrics и retention state в PostgreSQL 16+ на том же управляемом VPS либо в его приватной сети. Production path MUST NOT требовать Cloudflare D1, R2, Workers, Queues, KV, Sites или Wrangler.

#### Scenario: VPS потерял доступ к Cloudflare
- **WHEN** web, PostgreSQL и background workers на VPS исправны, а Cloudflare API полностью недоступен
- **THEN** создание вакансии, обработка кандидата, resume после рестарта и просмотр dashboard продолжают работать

#### Scenario: PostgreSQL недоступен
- **WHEN** компонент не может подтвердить соединение, schema version и транзакционную запись PostgreSQL
- **THEN** readiness становится false и новые effectful операции не запускаются

### Requirement: Durable concurrency сохраняет прежние гарантии
PostgreSQL runtime MUST атомарно выполнять claim runnable task, fencing lease token, budget/grant check, checkpoint/outbox intent и projection update. Параллельные workers MUST использовать row locking без двойного claim; поздний worker MUST NOT подтверждать результат после потери lease.

#### Scenario: Два worker одновременно запрашивают задачу
- **WHEN** два процесса пытаются claim одну runnable task
- **THEN** ровно один получает lease, а второй получает другую задачу либо пустой результат

#### Scenario: Worker завершился после внешнего эффекта
- **WHEN** worker создал внешний объект, но не сохранил outcome
- **THEN** следующий worker сначала выполняет reconcile по operation identity и не создаёт дубликат

### Requirement: App-owned immutable blobs хранятся в PostgreSQL
Исходные provider responses, normalized artifacts, protected traces, transcript artifacts и сгенерированные PDF MUST храниться как immutable PostgreSQL blob records с checksum, MIME type, byte size, candidate/run scope, retention class и created timestamp. Каждый blob MUST иметь configurable hard size limit; превышение MUST завершаться безопасной ошибкой до записи, а task/event/log MUST хранить только reference и checksum.

#### Scenario: Сохраняется артефакт
- **WHEN** этап создаёт новый app-owned artifact в пределах лимита
- **THEN** PostgreSQL атомарно сохраняет metadata и bytes, а downstream получает opaque reference и checksum

#### Scenario: Blob превышает лимит
- **WHEN** размер артефакта превышает разрешённый предел
- **THEN** система отклоняет запись с безопасным кодом и не сохраняет частичный blob

### Requirement: Локальный integration contour использует PostgreSQL
Локальный server, background worker и обязательные integration/E2E MUST работать с PostgreSQL той же major version и теми же migrations, что VPS. SQLite MAY использоваться только для hermetic unit/schema tests через совместимый repository contract и MUST NOT считаться production-like evidence.

#### Scenario: Запускается локальная приёмка
- **WHEN** оператор запускает обязательный E2E или real-candidate benchmark
- **THEN** preflight подтверждает PostgreSQL backend и отклоняет SQLite либо Cloudflare emulator

### Requirement: Web/API и workers исполняются на Node VPS
Web/API MUST собираться для Node target и запускаться под systemd за HTTPS reverse proxy. Agent worker, media processor и document processor MUST использовать тот же PostgreSQL и private loopback/internal TLS endpoints; request lifecycle MUST NOT удерживать long-running candidate workflow.

#### Scenario: VPS перезапускается
- **WHEN** PostgreSQL, web и workers последовательно стартуют после reboot
- **THEN** migrations/preflight завершаются до effectful traffic, незавершённые tasks восстанавливаются из PostgreSQL и checkpoints сохраняются

### Requirement: Backup, restore и rollback проверяются
Production MUST иметь зашифрованный ежедневный PostgreSQL backup, проверку restore на отдельной database и документированный retention. Release MUST применять backward-compatible migration до переключения build; rollback MUST отключать новые goals/effects и возвращать предыдущий build без удаления новых данных.

#### Scenario: Проверяется восстановление
- **WHEN** оператор разворачивает последний backup в изолированной database
- **THEN** schema validation, row/blob checksum sample и read-only application smoke проходят без production credentials в evidence

#### Scenario: Новый build откатывается
- **WHEN** post-deploy gate не проходит
- **THEN** effectful routing выключается, workers прекращают новые claims, предыдущий build запускается на совместимой schema и durable state не теряется
