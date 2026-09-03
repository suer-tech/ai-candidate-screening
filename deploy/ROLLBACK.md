# Безопасный rollback PostgreSQL/Node

Rollback не выполняет down migration и не возвращает D1/R2. Цель — остановить новые эффекты, сохранить durable state и запустить предыдущую совместимую сборку поверх той же либо восстановленной PostgreSQL schema.

## Условия

- предыдущая immutable-сборка имеет тот же `schema compatibility range`;
- свежий зашифрованный `pg_dump` и его SHA-256 проверены restore-test;
- оператор имеет доступ к systemd и PostgreSQL, но не передаёт credentials в чат или командную строку;
- OAuth keyring не ротируется и не восстанавливается отдельно от базы.

## Порядок

1. Перевести routing в `disabled`, затем остановить HTTP triggers: `sudo systemctl stop hh-web`.
2. Остановить новые claims и side effects: в Docker Compose остановить `dispatch-publisher` и сервисы `worker-*` (для старого systemd deployment — `hh-agent-worker`). Дождаться завершения либо истечения lease; не удалять `agent_*`, checkpoints, dispatch outbox, fan-out state и Rabbit queues.
3. Остановить приватные processors: `sudo systemctl stop hh-media-processor hh-document-processor`.
4. Снять аварийный encrypted backup и сверить checksum. Не запускать `drizzle-kit drop`, SQL `DROP`, `TRUNCATE`, down migration или импорт D1/R2.
5. Если schema совместима, переключить `/opt/hh-agent/current` на предыдущую immutable-сборку. Если данные повреждены, восстановить последнюю проверенную копию в новую пустую базу и атомарно заменить только credential `database-url`.
6. Выполнить migrations только вперёд и `npm run preflight:runtime`; readiness обязан подтвердить PostgreSQL, migrations, blobs, OAuth envelope, LLM и STT.
7. Запустить PostgreSQL, processors, web и discovery. Для Rabbit transport затем запустить publisher и worker pools. Для временного совместимого отката установить `CANDIDATE_DISPATCH_TRANSPORT=postgres`, оставить Rabbit publisher/pools остановленными и в Docker Compose запустить `docker compose --profile postgres-transport up -d worker-postgres` поверх той же forward-only schema.
8. Оставить routing в `disabled`. Проверить recovery: expired leases reclaimed, unknown outbox effects reconciled до retry, duplicate visible effects отсутствуют.
9. Вернуть `effectful` только после canonical E2E, provider smoke и проверки Telegram/двух PDF. Сохранить лишь безопасные fingerprints сборки, config и evidence.

Если предыдущая сборка несовместима со schema, rollback остаётся в `disabled`: применяется исправляющая forward migration или восстанавливается проверенная база в отдельный экземпляр. Разрушительный откат schema запрещён.
