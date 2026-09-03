## Context

Текущий runtime уже хранит в PostgreSQL durable task graph, зависимости, состояния, попытки, leases/fencing, checkpoints и outbox, но один `AgentRuntimeConsumer` получает одну задачу через PostgreSQL claim loop и ждёт её полного выполнения. Внутри крупных задач документы, интервью, evidence batches, строки матрицы и critical verification в основном перебираются последовательно. Поэтому долгий provider call или один зависший кандидат занимает процесс и увеличивает latency всей очереди.

RabbitMQ в этом change не становится workflow engine или источником состояния. Он решает только доставку готовой технической работы конкурентным worker pools. PostgreSQL продолжает определять, существует ли задача, готова ли она, кому принадлежит lease, завершена ли попытка и какие downstream dependencies можно открыть.

## Goals / Non-Goals

**Goals:**

- Параллельно обрабатывать разных кандидатов и пять согласованных внутренних видов работы.
- Сохранить selective recovery, checkpoints, fencing и идемпотентность существующего durable runtime.
- Не терять runnable-задачи при сбое publisher, broker или consumer и не повторять завершённые внешние эффекты.
- Ограничивать конкуренцию по pool, provider и candidate run, чтобы fan-out не превратился в неконтролируемый всплеск запросов.
- Сделать fan-out/join наблюдаемым и выдавать пользователю понятный этап ошибки вместо остановки всей обработки.
- Не помещать кандидатские материалы и секреты в RabbitMQ.

**Non-Goals:**

- Переносить каноническое состояние workflow из PostgreSQL в RabbitMQ.
- Создавать отдельную очередь на каждый критерий, кандидата или документ.
- Менять смысл матрицы, правила HR-оценки, формат итогового отчёта или список AI-провайдеров.
- Гарантировать exactly-once delivery со стороны broker; гарантия результата достигается at-least-once delivery и идемпотентным commit.
- Добавлять неограниченный параллелизм или обход provider quotas.
- Решать существующий нормативный конфликт Shared Drive/service account в рамках этого change.

## Decisions

### 1. PostgreSQL — control plane, RabbitMQ — delivery plane

RabbitMQ message сообщает только, что конкретную версию задачи можно попытаться забрать. Получив delivery, consumer выполняет атомарный claim-by-ID в PostgreSQL и проверяет run version, task state, dependencies, `available_at`, lease и cancellation. Только PostgreSQL-claim даёт право на выполнение.

Это сохраняет существующие recovery semantics и позволяет восстановить очереди из БД. Альтернатива с хранением workflow state в RabbitMQ отклонена: она создаёт второй источник истины, усложняет joins и делает выборочный повтор зависимым от истории сообщений.

### 2. Transactional dispatch outbox закрывает dual-write gap

Любая операция, делающая задачу `RUNNABLE`, в той же PostgreSQL-транзакции вставляет запись `agent_task_dispatch_outbox` с уникальным ключом `(task_id, task_version, dispatch_generation)`. Отдельный publisher читает неподтверждённые записи, публикует persistent message и после publisher confirm отмечает запись доставленной.

Повторная публикация допустима. Уникальность и claim-by-ID не дают повторному delivery создать вторую попытку после terminal commit. Периодический reconciler создаёт отсутствующую outbox-запись для любой runnable-задачи без активной доставки и тем самым восстанавливает transport после сбоя или потери очереди.

### 3. Ack выполняется только после durable commit

Consumer получает delivery с manual ack и bounded prefetch. После успешного commit terminal/retry state он отправляет ack. При transient failure consumer сохраняет attempt и рассчитанный `available_at`; новая dispatch-запись создаётся только при наступлении времени повтора. При падении до commit RabbitMQ redelivery приводит к новой допустимой попытке после истечения lease. При падении после commit, но до ack, повторный claim видит terminal state и завершает delivery без повторного вызова.

RabbitMQ delivery counters не заменяют доменные attempt budgets. Невалидный envelope и повторно неразбираемое сообщение направляются в DLQ, а техническая задача получает безопасный typed error, если её можно однозначно идентифицировать.

### 4. Малое число очередей соответствует классам ресурсов

Используется durable direct exchange `candidate.tasks` и routing classes:

- `control` — promotion, joins и короткая orchestration;
- `documents` — PDF/DOCX/OCR extraction;
- `media` — media probe/extraction и подготовка STT;
- `transcription` — submit/collect provider jobs;
- `llm` — matrix/evidence/rows/ABC/critical/recommendation задачи;
- `reports` — сборка и проверка документов;
- `drive` — snapshot, чтение и публикация;
- `notifications` — пользовательские уведомления.

Каждый pool имеет отдельные concurrency, prefetch, timeout и provider limit. Очередь на каждую мелкую операцию отклонена из-за operational overhead; одна общая очередь отклонена, потому что долгие media deliveries снова блокировали бы короткие control-задачи.

### 5. Envelope содержит только технические ссылки

Versioned envelope содержит `schemaVersion`, `taskId`, `runId`, `taskVersion`, `routingClass`, `attemptHint`, `correlationId`, `traceId`, `createdAt`. Он не содержит candidate name, source names, тексты, prompts, evidence, credentials или URLs. Worker загружает разрешённый task input через существующие PostgreSQL/Drive/object boundaries после claim.

RabbitMQ credentials поступают из runtime credential file/secret boundary. Management endpoint не публикуется наружу по умолчанию. Logs, metrics и DLQ показывают только технические IDs и safe error codes.

### 6. Fan-out создаётся детерминированно, join является отдельной задачей

Coordinator фиксирует immutable group descriptor: workflow version, input/profile/config fingerprints, shard kind и отсортированный список shard identities. Shard task key вычисляется детерминированно из group ID и source/batch/row ID. Повторное планирование с тем же descriptor выполняет upsert и не создаёт дубликаты.

Join — обычная durable task, зависящая от всех shards группы. Он проверяет точное множество результатов, версии и terminal states, формирует канонически упорядоченный aggregate checkpoint и только затем открывает downstream. При terminal failure обязательного shard join завершается typed failure; успешные shards остаются checkpoints и переиспользуются при selective retry.

### 7. Документы и интервью fan-out по immutable source ID

После `drive-snapshot` manifest замораживается для запуска:

- каждый поддерживаемый документ получает собственную extraction shard;
- каждая запись интервью получает собственную media/transcription ветвь;
- каждая уже готовая текстовая стенограмма получает короткую normalization shard;
- document join и transcript join сохраняют результаты по source ID и проверяют полное покрытие manifest.

Новые файлы, добавленные после snapshot, не попадают в текущий запуск. Повторная обработка создаёт новый manifest/version и новый набор shard identities.

### 8. Provider transcription разделяется на submit и collect

Transcription submit сохраняет provider job ID, source fingerprint и provider idempotency reference до ack. Collect является короткой повторяемой задачей: если результат ещё не готов, она фиксирует следующее `available_at`, освобождает delivery и worker slot. Готовность нескольких интервью проверяется независимо; transcript join ждёт их все.

Долгое polling внутри одного unacked consumer отклонено: оно расходует worker capacity, усложняет graceful shutdown и повышает вероятность redelivery больших задач.

### 9. Evidence batches имеют frozen plan и exact coverage

После готовности matrix и нормализованных источников planner строит token-based batch plan с устойчивыми batch IDs. Descriptor явно перечисляет criteria IDs и source ranges каждого batch. Shards выполняются параллельно с per-run limit. Evidence join:

- требует результат каждого batch ID;
- проверяет coverage всех criteria assignments;
- валидирует locators относительно source/version;
- удаляет точные дубликаты по evidence identity;
- сохраняет противоречащие факты раздельно;
- сортирует результат независимо от порядка завершения.

Таким образом параллелизм не превращает «последний ответ победил» и не позволяет одному batch незаметно пропустить критерий.

### 10. ABC и строки матрицы — sibling branches

После evidence join создаются две независимые ветви:

- ABC analysis, при необходимости разделённый по направлениям;
- первичная row assessment, разделённая на bounded row groups с exact row coverage.

Обе используют одну frozen matrix/evidence version. `assessment-join` ждёт `abc-join` и `row-join`. Recommendation не вычисляется ни одним shard и запускается только после общего join.

### 11. Critical verification fan-out следует результатам строк

После row join deterministic selector сохраняет список critical row IDs. Для каждого ID создаётся verification shard, а critical join применяет максимум один результат к строке и сохраняет исходную оценку для аудита. Пустой список создаёт немедленно завершаемый no-op join без LLM-вызова. Ошибка одного critical shard видима и не переписывает другие строки.

### 12. Concurrency ограничивается на трёх уровнях

Для каждого pool задаются global worker concurrency и prefetch. Дополнительно semaphore/claim policy ограничивает число активных provider calls и shards одного candidate run. Consumer выбирает доступную работу справедливо между запусками; большой evidence plan не занимает весь LLM pool. Начальные значения являются конфигурацией и калибруются нагрузочными synthetic fixtures, а не зашиваются в требования.

### 13. Новая версия graph и переключаемый transport обеспечивают миграцию

Новые candidate runs получают новую workflow version с shard/join task keys. Запуски старой версии продолжают использовать сохранённый graph и checkpoints. Transport выбирается release configuration `postgres` или `rabbit`; оба adapters вызывают один task executor и один PostgreSQL claim/commit contract. В production после приёмки используется `rabbit`, а `postgres` остаётся временным rollback path до завершения миграционного окна.

Нельзя одновременно исполнять одну и ту же задачу обоими transports без общего claim; общий claim contract делает случайную двойную доставку безопасной.

### 14. Ошибка локализуется до shard и кандидата

UI/API получает агрегированный fan-out progress (`total`, `queued`, `running`, `succeeded`, `retrying`, `failed`) и человекочитаемый stage. Внутренние routing keys, payload и stack trace пользователю не показываются. Terminal shard failure блокирует только соответствующий join/run; worker process не завершается, а другие кандидаты продолжаются.

## Risks / Trade-offs

- [Dual-write между БД и broker теряет задачу] → transactional dispatch outbox, publisher confirms и runnable reconciler.
- [At-least-once повторяет дорогой LLM/provider call] → checkpoint до ack, provider idempotency reference, terminal deduplication и fencing. Там, где provider не поддерживает idempotency, результат повторного вызова не может заменить уже committed terminal result.
- [Fan-out создаёт слишком много задач] → bounded batch/row grouping, global/per-run/provider limits и конфигурируемый prefetch.
- [Один большой кандидат монополизирует pool] → per-run active shard limit и справедливый claim/routing policy.
- [Shards завершаются в разном порядке и дают нестабильный итог] → immutable group descriptors, stable IDs и детерминированная сортировка join.
- [Broker недоступен или потерял volume] → PostgreSQL остаётся источником истины, outbox накапливается и reconciler восстанавливает deliveries.
- [RabbitMQ становится новой точкой эксплуатации] → health/readiness, persistent volume, DLQ, metrics, runbook и rollback transport.
- [Несколько transcription collect создают polling storm] → `available_at` backoff, jitter и provider concurrency limit.
- [PII попадает в broker через удобный payload] → строгая runtime schema/allowlist и acceptance inspection published/unacked/DLQ messages.
- [Старые checkpoints несовместимы с новым graph] → workflow version pinning; существующие runs не перепланируются автоматически.
- [Single-node VPS не даёт RabbitMQ HA] → durability защищает обычный restart, а полное восстановление очередей выполняется из PostgreSQL; кластеризация остаётся отдельным infrastructure change.

## Migration Plan

1. После отдельного запроса на применение независимый автор добавляет acceptance tests по TST-086–TST-091 и фиксирует содержательный RED на synthetic fixtures.
2. Добавить forward-only schema для dispatch outbox и fan-out group/shard metadata без изменения существующих запусков.
3. Добавить RabbitMQ dependency, topology initializer, secure credentials, health/readiness, metrics и Docker/VPS wiring.
4. Реализовать publisher confirms, runnable reconciler и Rabbit consumer adapter поверх общего PostgreSQL claim-by-ID/lease/fencing contract.
5. Включить Rabbit transport сначала для существующих монолитных task keys и доказать crash/redelivery semantics.
6. Добавить новую workflow version и generic deterministic fan-out/join primitives.
7. Поэтапно включить document shards, multi-interview submit/collect, evidence batches, parallel ABC/rows и critical-row shards.
8. Добавить агрегированный progress и безопасные пользовательские ошибки.
9. Выполнить focused tests, real Rabbit integration, concurrency acceptance и четыре production-like E2E на одном immutable identity; существующий Drive oracle conflict оставить явным `RED/BLOCKED` до отдельной синхронизации specs.
10. Переключить production transport на RabbitMQ после GREEN относящихся к change проверок и наблюдать queue age, redelivery, DLQ и per-stage latency.

Rollback переключает новые dispatch на PostgreSQL transport и останавливает Rabbit consumers после drain. PostgreSQL state, checkpoints и artifacts не удаляются; queued Rabbit messages становятся stale и не имеют права исполнения без успешного PostgreSQL claim. Новые graph-version runs продолжаются тем же executor через rollback transport.
