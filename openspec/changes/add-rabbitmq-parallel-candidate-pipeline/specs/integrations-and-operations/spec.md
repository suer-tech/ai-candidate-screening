## MODIFIED Requirements

### Requirement: OPS-003 [CONFIRMED] Тайм-ауты и повторы
Каждый этап MUST иметь конфигурационный тайм-аут, ограниченные повторные попытки и отдельный код ошибки. Стартовая конфигурация MUST задавать: Google Drive и короткие внешние запросы — 60 секунд и не более 3 попыток всего; FFmpeg — 20 минут и не более 1 повтора; ожидание результата задания AssemblyAI — 60 минут, а отдельные сетевые запросы к нему — 60 секунд и не более 3 попыток всего; OCR RouterAI — 3 минуты на страницу и не более 2 повторов; анализ RouterAI — 10 минут и не более 2 повторов; валидация и сохранение — 2 минуты и не более 3 попыток всего. Между доступными повторами MUST применяться задержки 5, 15 и 45 секунд в указанном порядке. Изменение этих значений по фактическим метрикам MUST выполняться конфигурацией и MUST NOT требовать изменения бизнес-логики.

Автоматический повтор MUST применяться только к сетевой ошибке, timeout, HTTP 429, HTTP 5xx или явно подтверждённому провайдером обрыву LLM-ответа по лимиту длины. Для обрыва по длине MUST быть не более двух повторов всего с задержками 5 и 15 секунд; слои provider и durable task MUST NOT умножать этот предел. Невалидный JSON сам по себе MUST NOT считаться доказательством обрыва по длине. Повреждённый либо неподдерживаемый обязательный файл, HTTP 4xx кроме 429, невалидные входные или выходные данные, отказ или content-filter провайдера MUST завершать этап без автоматического повтора. После исчерпания разрешённых попыток временной ошибки либо немедленно при постоянной ошибке обработка кандидата MUST перейти в `FAILED` и сохранить файл при применимости, этап, код причины, число попыток и последнюю безопасно очищенную техническую ошибку. Частичный отчёт и уведомление об успехе MUST NOT публиковаться. Ручной повтор MUST начинаться со сбойного этапа и переиспользовать результаты уже завершённых дорогих этапов при неизменных входных версиях; замена необрабатываемого обязательного файла MUST создавать новую версию входного комплекта по WF-014.

#### Scenario: Этап завис
- **WHEN** внешний запрос завершился сетевой ошибкой, timeout, HTTP 429 или HTTP 5xx
- **THEN** система применяет ограниченные повторы по конфигурационной политике и backoff
- **AND** после исчерпания попыток сохраняет безопасный код и переводит обработку в FAILED

#### Scenario: Подтверждённый обрыв по длине
- **WHEN** провайдер явно указывает, что ответ оборван по лимиту длины
- **THEN** система сохраняет отдельный безопасный код `output_length_exceeded`
- **AND** выполняет не более двух повторов с задержками 5 и 15 секунд без повторного вычисления успешных upstream задач
- **AND** неполный ответ не используется как успешный результат

#### Scenario: Невалидный ответ или блокировка
- **WHEN** ответ не соответствует схеме, отсутствует, generically incomplete либо отклонён провайдером или content-filter
- **THEN** этап завершается без автоматического повтора с отдельной безопасной причиной
- **AND** частичный результат и уведомление об успехе не публикуются

#### Scenario: Входной файл повреждён
- **WHEN** обязательный входной файл повреждён
- **THEN** кандидат получает `FAILED` без автоматического повтора и частичной публикации
- **AND** HR видит требование заменить файл и запустить обработку новой стабильной версии

#### Scenario: Настройка уточнена по метрикам
- **WHEN** IT изменяет тайм-аут или число попыток в допустимой конфигурации
- **THEN** новая политика применяется без изменения бизнес-логики

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

#### Scenario: Evidence planning shares the web process with control requests
- **WHEN** a long transcript requires repeated token-budget calculations
- **THEN** planning yields between calculations so pending control HTTP requests and timers can progress before the full plan completes
- **AND** batch contents, identifiers, source coverage and token limits remain unchanged

#### Scenario: A media shard fails with a nested infrastructure error
- **WHEN** download, processor request, response read or artifact storage throws
- **THEN** technical diagnostics identify the phase and run/task/attempt with an allowlisted cause code and elapsed time
- **AND** raw error text, stack, filenames, URLs and material content are not logged
- **AND** diagnostic recording does not replace the original error or alter retry policy

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
