## ADDED Requirements

### Requirement: SEC-011 [CONFIRMED] Минимальный envelope RabbitMQ

RabbitMQ message MUST содержать только schema version, task ID, run ID, task version, routing class, attempt hint, trace/correlation IDs и created timestamp. Message MUST NOT содержать имя кандидата, email, телефон, raw-файлы, извлечённый текст, стенограммы, evidence, prompts, ответы модели, OAuth/provider credentials, access tokens или signed URLs.

#### Scenario: Проверка сообщения broker
- **WHEN** тест перехватывает опубликованный envelope
- **THEN** все поля входят в явный allowlist технических метаданных
- **AND** содержимое задачи загружается worker только из авторизованного PostgreSQL/object/Drive boundary

### Requirement: SEC-012 [CONFIRMED] Защита RabbitMQ и его диагностики

RabbitMQ credentials MUST храниться только в runtime credentials boundary и MUST различаться между средами. Broker и management endpoint MUST быть доступны только во внутренней сети deployment, если оператор явно не настроил отдельный защищённый административный контур. Логи publisher/consumer/DLQ MUST соблюдать безопасную минимизацию.

#### Scenario: Диагностика dead-letter сообщения
- **WHEN** сообщение направлено в dead-letter routing
- **THEN** журнал содержит технический task ID, безопасный error code и счётчик доставок
- **AND** не содержит payload материалов кандидата, секретов или временных ссылок

### Requirement: SEC-013 [CONFIRMED] Ограниченное хранение broker-данных

Очереди и dead-letter queues MUST иметь документированные retention/size limits, достаточные для восстановления, но не использоваться как архив. Удаление или архивирование кандидата MUST опираться на PostgreSQL и хранилища данных; техническое сообщение, доставленное после удаления, MUST быть признано устаревшим и подтверждено без восстановления удалённых данных.

#### Scenario: Сообщение приходит после удаления запуска
- **WHEN** consumer не находит разрешённую активную задачу и запуск в PostgreSQL
- **THEN** сообщение подтверждается как stale
- **AND** никакие данные кандидата не создаются заново
