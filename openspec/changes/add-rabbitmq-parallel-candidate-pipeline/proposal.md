## Why

Один синхронный worker последовательно удерживает долгие media, transcription и LLM-задачи, поэтому один большой или зависший кандидат увеличивает очередь для всех остальных. Нужен надёжный task-level dispatch и контролируемый fan-out/join, позволяющий независимо масштабировать тяжёлые этапы без потери существующих checkpoint и recovery-гарантий.

## What Changes

- Добавляется RabbitMQ как durable transport только для готовых к выполнению технических задач; PostgreSQL остаётся источником истины для кандидатов, DAG, состояний, попыток, checkpoints, артефактов и outbox.
- Добавляется transactional dispatch outbox, исключающий dual-write разрыв между переводом задачи в `RUNNABLE` и публикацией сообщения.
- Добавляются отдельные worker pools и routing keys для control, documents, media/transcription, LLM, reports, Drive и notifications с bounded prefetch, retry и dead-letter routing.
- Обработка документов и интервью переводится на fan-out по каждому immutable source с последующим fail-closed join без молчаливой потери источников.
- Поиск доказательств переводится на параллельный fan-out по token batches с детерминированным join, deduplication и exact criterion coverage.
- Первичная оценка строк и ABC-анализ выполняются параллельно после готовности evidence; критические строки проверяются отдельными параллельными shard-задачами с последующим join.
- Сообщения RabbitMQ содержат только непривилегированные технические идентификаторы и версии; raw-файлы, стенограммы, PII, OAuth/provider secrets и signed URLs в broker не помещаются.
- Текущий PostgreSQL claim loop заменяется Rabbit consumer dispatch для production candidate tasks; selective recovery и идемпотентность сохраняются.

## Capabilities

### New Capabilities

- `rabbitmq-task-dispatch`: durable RabbitMQ topology, transactional dispatch, acknowledgements, retries, dead-letter handling, worker pools and secure message envelope.

### Modified Capabilities

- `candidate-workflow`: task DAG получает fan-out/join для документов, интервью, evidence batches, ABC/rows и critical verification с параллельной обработкой кандидатов.
- `integrations-and-operations`: production runtime получает RabbitMQ transport, наблюдаемость очередей, concurrency controls и отказоустойчивую эксплуатацию.
- `data-and-security`: broker payload ограничивается техническими ссылками без кандидатских материалов, секретов и временных ссылок.
- `quality-gates`: обязательная приёмка проверяет реальный broker, redelivery, crash recovery, отсутствие двойных эффектов и фактический параллелизм пяти согласованных операций.

## Impact

- Новая production-зависимость: RabbitMQ и Node.js AMQP client.
- Изменяются Docker/VPS deployment, runtime configuration, preflight, health/readiness и operational runbooks.
- Изменяются `agent-runtime` dispatch/promotion boundaries и canonical candidate task graph; PostgreSQL schema потребует forward-only таблицы dispatch outbox/inbox либо эквивалентного состояния доставки.
- Потребуются отдельные process entrypoints или единый worker с routing-role, уникальные worker identities и настройки concurrency/prefetch.
- Обязательны synthetic integration и production-like E2E без помещения PII или секретов в сообщения/evidence.
