## ADDED Requirements

### Requirement: INT-023 [CONFIRMED] Асинхронный жизненный цикл транскрибации

Долгая внешняя транскрибация MUST быть разделена как минимум на submit и collect. После успешного submit provider job ID MUST быть сохранён в checkpoint до ack задачи. Ожидание готовности MUST выполняться через последующие доступные задачи или provider callback и MUST NOT удерживать unacked RabbitMQ delivery или worker slot непрерывным polling.

#### Scenario: Провайдер обрабатывает запись десять минут
- **WHEN** submit вернул provider job ID
- **THEN** worker сохраняет ID и освобождает delivery
- **AND** collect запускается повторно не раньше рассчитанного времени
- **AND** другие интервью могут занимать освободившийся worker slot

### Requirement: OPS-007 [CONFIRMED] Наблюдаемость RabbitMQ pipeline

Система MUST публиковать безопасные метрики по queue depth, oldest message age, publish lag, unacked count, redelivery, dead-letter count, runnable-without-delivery, active workers, task duration и fan-out/join progress. Worker identity MUST быть уникальной для процесса и контейнера и MUST присутствовать в lease и диагностике.

#### Scenario: Кандидат долго не продвигается
- **WHEN** оператор открывает диагностику запуска
- **THEN** он видит ожидающий join, число total/succeeded/running/failed shards и соответствующий pool
- **AND** диагностика не раскрывает материалы кандидата или секреты

### Requirement: OPS-008 [CONFIRMED] Управляемая конкуренция и справедливость

Concurrency MUST настраиваться раздельно по worker pool и ограничиваться одновременно глобально, по provider и по одному candidate run. Планировщик MUST предотвращать монополизацию LLM или transcription pool одним большим кандидатом при наличии runnable-задач других кандидатов.

#### Scenario: Один кандидат породил много evidence batches
- **WHEN** у него готово больше shards, чем разрешённый per-run limit
- **AND** в очереди есть shards другого кандидата
- **THEN** первый запуск занимает не более своего лимита
- **AND** второй кандидат получает доступный worker slot

### Requirement: OPS-009 [CONFIRMED] Безопасное завершение workers

При остановке worker MUST прекратить получение новых deliveries, дать выполняемым задачам ограниченное время на commit и ack и вернуть незавершённые deliveries broker. Истёкший lease MUST позволять другому worker безопасно продолжить задачу с новым fencing token.

#### Scenario: Контейнер перезапускается во время задачи
- **WHEN** graceful timeout истекает до завершения попытки
- **THEN** delivery остаётся или становится доступным для redelivery
- **AND** старый worker после потери lease не может записать результат поверх новой попытки

### Requirement: OPS-010 [CONFIRMED] Production topology и readiness

Production deployment MUST поднимать RabbitMQ как приватную runtime-зависимость с healthcheck, persistent storage, durable exchanges/queues и dead-letter routing. Web readiness MUST NOT считаться полной готовностью candidate processing, если dispatch publisher или обязательные worker pools не могут подключиться к PostgreSQL и RabbitMQ.

#### Scenario: Web доступен, но RabbitMQ недоступен
- **WHEN** HTTP-интерфейс отвечает, а broker connection отсутствует
- **THEN** пользователь может просматривать сохранённые данные
- **AND** processing readiness показывает деградацию
- **AND** новый запуск сохраняется без потери и ожидает восстановление dispatch
