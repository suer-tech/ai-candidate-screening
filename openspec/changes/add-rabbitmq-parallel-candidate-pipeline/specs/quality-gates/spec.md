## ADDED Requirements

### Requirement: TST-086 [CONFIRMED] Реальный RabbitMQ integration contour

Приёмка dispatch MUST использовать реальный RabbitMQ и PostgreSQL, а не in-memory mock. Она MUST доказать transactional publish, publisher confirm, claim-by-ID, ack after commit, redelivery и terminal deduplication на одном build/config identity.

#### Scenario: Проверяются обе crash boundaries
- **WHEN** harness останавливает consumer до commit и отдельно после commit до ack
- **THEN** первая задача безопасно выполняется новым consumer
- **AND** вторая не повторяет вычисление или внешний эффект
- **AND** обе достигают одного канонического terminal результата

### Requirement: TST-087 [CONFIRMED] Приёмка пяти видов параллелизма

Обязательный synthetic acceptance run MUST содержать несколько документов, несколько интервью, несколько evidence token batches, ABC вместе с несколькими row shards и несколько critical-row shards. Timeline MUST доказывать фактическое перекрытие выполнения для каждого из пяти согласованных видов параллелизма при сохранении dependency joins.

#### Scenario: Параллелизм доказан наблюдаемым timeline
- **WHEN** acceptance run завершается
- **THEN** evidence содержит start/finish timestamps и worker IDs всех shards
- **AND** в каждом виде существуют минимум две независимые задачи с перекрывающимися интервалами
- **AND** итог стартует только после всех обязательных joins

### Requirement: TST-088 [CONFIRMED] Отказ одного кандидата не блокирует остальных

Acceptance MUST запустить минимум три кандидата и инжектировать повторяемую либо terminal ошибку в один shard первого кандидата. Два остальных кандидата MUST достичь ожидаемых состояний без ручного вмешательства.

#### Scenario: Poison shard изолирован
- **WHEN** shard первого кандидата исчерпывает повторы
- **THEN** только его запуск получает typed failure и dead-letter diagnostic
- **AND** второй и третий кандидаты продолжают обработку
- **AND** worker processes остаются готовы принимать задачи

### Requirement: TST-089 [CONFIRMED] Broker outage и автоматическое восстановление

Acceptance MUST останавливать broker до публикации и при наличии unacked deliveries, затем запускать его вновь. Harness MUST доказать отсутствие потерянных runnable tasks, ложных completion и двойных внешних эффектов.

#### Scenario: Broker восстановлен после простоя
- **WHEN** RabbitMQ снова готов
- **THEN** dispatch outbox автоматически переиздаёт недоставленные задачи
- **AND** redelivered задачи проходят terminal deduplication
- **AND** ручной перезапуск candidate run не требуется

### Requirement: TST-090 [CONFIRMED] Проверка конфиденциальности очередей

Acceptance MUST инспектировать published, unacked и dead-letter envelopes и fail closed при любом поле вне allowlist либо совпадении с synthetic PII, document text, transcript fragment, prompt, secret или signed URL.

#### Scenario: В envelope попал фрагмент стенограммы
- **WHEN** payload inspection обнаруживает synthetic контрольную фразу кандидата
- **THEN** security gate получает `FAILED`
- **AND** прогон не может быть объявлен production-ready

### Requirement: TST-091 [CONFIRMED] Полный production-like regression после изменения pipeline

Изменение RabbitMQ topology, dispatch, task graph, worker concurrency или fan-out rules MUST запускать существующие четыре обязательных E2E и новый RabbitMQ acceptance на одном immutable build/config/fixture identity. Существующий конфликт main specs по Shared Drive/service account MUST оставаться явным `RED/BLOCKED`, пока требования не синхронизированы, и MUST NOT скрываться результатами RabbitMQ-тестов.

#### Scenario: RabbitMQ acceptance зелёный, но integration oracle конфликтует
- **WHEN** RabbitMQ проверки завершены успешно
- **AND** стартовые условия обязательного E2E противоречат текущей Drive-конфигурации
- **THEN** release gate остаётся `RED/BLOCKED`
- **AND** evidence явно называет оба независимых результата
