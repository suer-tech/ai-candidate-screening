## 1. Приёмочный RED и контракты

- [x] 1.1 Передать независимому автору тестов требования TST-086–TST-091 и получить synthetic real-Rabbit acceptance, который падает по отсутствующему dispatch и пяти видам параллелизма, а не по неподготовленной инфраструктуре.
- [x] 1.2 Зафиксировать versioned Rabbit envelope schema и allowlist полей с negative fixtures для PII, документов, transcript, prompts, secrets и signed URLs.
- [x] 1.3 Зафиксировать routing-class registry, task-to-pool mapping и проверку, запрещающую неизвестные task/routing combinations.
- [x] 1.4 Добавить тестовый timeline collector, который наблюдает task start/finish, worker identity, group/shard/join IDs и доказывает реальное перекрытие интервалов.

## 2. PostgreSQL dispatch и fan-out schema

- [x] 2.1 Добавить forward-only migration для transactional task dispatch outbox с уникальным generation key, publish state, confirm metadata и retry timestamps.
- [x] 2.2 Добавить forward-only migration для fan-out groups и shard membership с immutable descriptor fingerprint, expected count и aggregate state.
- [x] 2.3 Расширить storage contracts атомарной операцией promotion-to-runnable плюс dispatch outbox insert в одной транзакции.
- [x] 2.4 Реализовать атомарный claim-by-task-ID/version с проверкой dependencies, `available_at`, cancellation, lease и fencing token.
- [x] 2.5 Реализовать terminal/retry commit contracts, которые создают downstream/retry dispatch records в той же транзакции.
- [x] 2.6 Добавить runnable reconciler, восстанавливающий отсутствующие dispatch records без дублирования уже подтверждённых terminal задач.
- [x] 2.7 Добавить repository-level tests транзакционных границ, конкурентного claim, stale generation, lease expiry и повторного promotion.

## 3. RabbitMQ transport

- [x] 3.1 Добавить поддерживаемый AMQP client и модуль конфигурации RabbitMQ без передачи credentials через CLI, логи или env вне разрешённого runtime boundary.
- [x] 3.2 Реализовать idempotent topology initializer для durable exchange, resource-class queues, dead-letter exchange/queues, bindings и retention limits.
- [x] 3.3 Реализовать dispatch publisher с persistent messages, publisher confirms, reconnect/backoff и commit publish outcome в PostgreSQL.
- [x] 3.4 Реализовать Rabbit consumer adapter с manual ack, bounded prefetch, envelope validation и PostgreSQL claim-by-ID.
- [x] 3.5 Реализовать ack-after-commit, safe stale ack, redelivery handling и dead-letter flow для невалидных/poison envelopes.
- [x] 3.6 Добавить graceful drain: stop consuming, bounded task completion, nack/requeue незавершённых deliveries и закрытие connections.
- [x] 3.7 Сохранить PostgreSQL transport adapter как временный rollback path, использующий тот же executor и claim/commit contract.

## 4. Worker pools и эксплуатация

- [x] 4.1 Добавить process role/entrypoint для dispatch publisher и Rabbit worker с явным набором routing classes.
- [x] 4.2 Формировать уникальный worker identity из hostname, process ID и runtime instance ID и использовать его в leases, attempts и metrics.
- [x] 4.3 Добавить конфигурацию concurrency, prefetch, graceful timeout, per-run и provider limits отдельно для control, documents, media, transcription, LLM, reports, Drive и notifications.
- [x] 4.4 Реализовать справедливое ограничение активных shards одного run, чтобы один кандидат не занимал весь LLM/transcription pool.
- [x] 4.5 Добавить RabbitMQ, persistent volume, healthcheck, private network и worker pool services в local и VPS Docker Compose.
- [x] 4.6 Добавить processing readiness для broker, publisher lag и обязательных pools, не блокируя read-only web при деградации обработки.
- [ ] 4.7 Добавить безопасные метрики и structured logs для queue age/depth, unacked, redelivery, DLQ, publish lag, runnable-without-delivery и active workers.
- [x] 4.8 Обновить deployment credentials templates, preflight и operator runbook без включения реальных credentials.

## 5. Generic deterministic fan-out/join

- [x] 5.1 Реализовать создание immutable fan-out descriptor и deterministic group/shard task keys из workflow/input/profile/config fingerprints.
- [x] 5.2 Реализовать idempotent group/shard upsert, не создающий новые shards при повторном планировании того же descriptor.
- [x] 5.3 Реализовать join executor с exact membership, version/state validation и канонической сортировкой результатов.
- [x] 5.4 Реализовать no-op join для пустого набора и typed failure для отсутствующего либо terminal-failed обязательного shard.
- [x] 5.5 Сохранять успешные shard checkpoints при ошибке join и переиспользовать их при selective retry совместимой версии.
- [x] 5.6 Добавить агрегированный group progress в runtime read model и безопасное отображение stage/error в UI/API.
- [ ] 5.7 Покрыть primitives тестами порядка завершения, duplicate delivery, partial failure, stale descriptor и selective recovery.

## 6. Параллельная обработка документов

- [x] 6.1 Заменить монолитную document-extraction задачу в новой workflow version на document fan-out coordinator, shard per immutable source ID и document join.
- [x] 6.2 Перенести существующие PDF/DOCX/OCR extractors в shard executor без изменения формата source locators.
- [x] 6.3 Проверять в document join полное покрытие поддерживаемых документов frozen manifest и отсутствие duplicate source results.
- [ ] 6.4 Добавить fixtures и acceptance для параллельной обработки минимум трёх документов с разной длительностью.

## 7. Параллельная обработка нескольких интервью

- [x] 7.1 Заменить монолитную transcription задачу в новой workflow version на independent branch per recording/transcript source и transcript join.
- [x] 7.2 Выделить media probe/extraction shard для каждой записи и normalization shard для каждой готовой текстовой стенограммы.
- [x] 7.3 Разделить provider transcription на submit и collect tasks с durable provider job checkpoint до ack.
- [x] 7.4 Планировать collect через PostgreSQL `available_at` с backoff/jitter без удержания unacked delivery и worker slot.
- [x] 7.5 Сохранить source-specific speaker/timestamp identity и исключить смешивание таймкодов нескольких интервью в transcript join.
- [ ] 7.6 Добавить fixtures и acceptance для двух записей плюс готовой стенограммы, включая медленный provider result и selective retry одного source.

## 8. Параллельный поиск доказательств

- [x] 8.1 Выделить deterministic evidence planner, фиксирующий token batches, assigned criteria IDs, source ranges и batch fingerprints.
- [x] 8.2 Заменить последовательный evidence loop shard-задачами по batch plan с per-run/provider concurrency limits.
- [x] 8.3 Реализовать evidence join с exact batch/criterion coverage, locator validation, stable deduplication и сохранением противоречащих фактов.
- [x] 8.4 Сделать output evidence join независимым от порядка завершения shards и совместимым с текущим downstream evidence schema.
- [ ] 8.5 Добавить acceptance, где batches завершаются в обратном порядке, но каждый критерий покрыт и итог идентичен canonical order.

## 9. Параллельные ABC и строки матрицы

- [x] 9.1 Изменить новую workflow version так, чтобы после evidence join ABC branch и row-assessment branch становились runnable одновременно.
- [x] 9.2 Разделить primary row assessment на deterministic bounded row groups с exact row coverage и общим frozen matrix/evidence fingerprint.
- [x] 9.3 При необходимости разделить ABC по направлениям и добавить deterministic ABC join без изменения HR-семантики уровней A/B/C.
- [x] 9.4 Добавить assessment join, ожидающий полный ABC join и row join перед critical selection/recommendation.
- [ ] 9.5 Добавить acceptance реального временного перекрытия ABC и минимум двух row shards и запрета раннего recommendation.

## 10. Параллельная проверка критических строк

- [x] 10.1 Добавить deterministic critical selector checkpoint со списком row IDs и причиной включения каждой строки.
- [x] 10.2 Создать independent critical verification shard per selected row и no-op branch при пустом списке.
- [x] 10.3 Реализовать critical join, применяющий максимум один результат на строку и сохраняющий исходную оценку для аудита.
- [x] 10.4 Заблокировать recommendation до terminal critical join и отобразить typed failure конкретного shard без остановки других кандидатов.
- [ ] 10.5 Добавить acceptance параллельной проверки минимум трёх critical rows, включая ошибку и selective retry одной строки.

## 11. Canonical graph, совместимость и публикация

- [x] 11.1 Зарегистрировать новую workflow version с полными document, transcript, evidence, ABC/rows и critical fan-out/join dependencies.
- [x] 11.2 Сохранить выполнение уже созданных запусков старой workflow version без автоматического изменения их task graph и checkpoints.
- [x] 11.3 Проверить, что новые файлы после frozen snapshot не входят в текущие shards, а ручной повтор создаёт новый manifest/version и новый descriptor.
- [x] 11.4 Проверить, что recommendation, validation, report, Drive publication и notification запускаются только после всех обязательных joins одной версии.
- [ ] 11.5 Сохранить существующие idempotency keys публикации/уведомлений и доказать отсутствие двойных PDF/Drive/notification эффектов при redelivery.

## 12. Интеграционная и сквозная проверка

- [ ] 12.1 Довести TST-086 до GREEN на реальных PostgreSQL и RabbitMQ для crash-before-commit и crash-after-commit-before-ack.
- [ ] 12.2 Довести TST-087 до GREEN с наблюдаемым перекрытием всех пяти видов внутренних операций.
- [ ] 12.3 Довести TST-088 до GREEN: terminal failure одного кандидата не блокирует два независимых запуска и worker pools.
- [ ] 12.4 Довести TST-089 до GREEN при broker outage, restart, queue rehydration и отсутствии lost/duplicate results.
- [x] 12.5 Довести TST-090 до GREEN инспекцией published, unacked и DLQ envelopes на отсутствие PII, материалов и секретов.
- [ ] 12.6 Выполнить focused unit/integration regression, `npm test`, PostgreSQL/VPS tests и RabbitMQ acceptance на immutable build/config/fixture identity.
- [ ] 12.7 Выполнить четыре обязательных production-like E2E на том же identity и явно сохранить существующий Drive requirements conflict как `RED/BLOCKED`, пока он не решён отдельным change.
- [x] 12.8 Обновить `docs/ARCHITECTURE.md`, `docs/index.json` и операционную инструкцию фактическими процессами, очередями, recovery и rollback.
- [ ] 12.9 Провести staged rollout с Rabbit transport feature flag, проверить queue age/redelivery/DLQ/provider limits и только затем сделать Rabbit production default.
