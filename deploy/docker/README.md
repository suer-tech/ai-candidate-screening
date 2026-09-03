# HH AI-screener — docker compose (локально и на VPS)

Приложение целиком поднимается docker compose: PostgreSQL, RabbitMQ, web/API,
discovery, dispatch publisher, отдельные worker pools, media и document processors. Один образ (`web/Dockerfile`) обслуживает прикладные сервисы,
команда выбирается в compose. PowerShell-лаунчер и systemd-юниты не требуются.

## Структура

- `docker-compose.yml` — базовые сервисы (`postgres`, `rabbitmq`, `web`, `worker`, `dispatch-publisher`, `worker-*`, `media-processor`,
  `document-processor`, `migrate`, опциональный `fixture-controller` профилем `e2e`).
- `docker-compose.local.yml` — локальный override: bind-монтирование `web/.runtime`,
  публикация портов на `127.0.0.1`.
- `docker-compose.vps.yml` — VPS override: bind-монтирование `/etc/hh-agent`,
  nginx reverse proxy + certbot (HTTPS).
- `.env.example` — переменные compose (копируется в `.env`, игнорируется git).
- `nginx.conf.template` — nginx-конфиг, `${HH_DOMAIN}` подставляется entrypoint'ом.

## Конфигурация

Единый config root (`HH_RUNTIME_CONFIG_ROOT`) монтируется read-only в `/config`:

- локально: `web/.runtime` (содержит `runtime.env` и `credentials/`);
- VPS: `/etc/hh-agent` (тот же формат).

Сетевые значения внутри compose-сети переопределяются через `environment` и
подхватываются `environmentProjection` (`server/configuration/runtime.ts`):

- `DATABASE_URL` → `postgres:5432`;
- `INTERNAL_APP_ORIGIN` → `http://web:3000` (worker/media обращаются к web по имени сервиса);
- `MEDIA_PROCESSOR_URL/HOST/PORT`, `DOCUMENT_PROCESSOR_URL/HOST/PORT` → имена сервисов;
- `HOST=0.0.0.0` — web/процессоры слушают все интерфейсы;
- `HH_DOCKER_NETWORK=1` — разрешает имена сервисов вместо loopback для internal
  tool endpoints и processor checks (только в compose).

Пароль RabbitMQ хранится отдельным credential-файлом `credentials/rabbitmq-password`; в `runtime.env`, compose `.env`, argv и логи он не попадает. RabbitMQ доступен только из приватной compose-сети (локальный management port публикуется лишь на `127.0.0.1`).

## Локальный запуск

Из корня репозитория:

```bash
cp deploy/docker/.env.example deploy/docker/.env
# заполните HH_POSTGRES_PASSWORD в deploy/docker/.env

docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.local.yml up -d --build
```

- web: http://localhost:3000
- postgres: 127.0.0.1:54329
- media-processor: 127.0.0.1:4311
- document-processor: 127.0.0.1:4312
- RabbitMQ management: 127.0.0.1:15672

Остановка: `docker compose ... down` (данные БД в именованном volume `postgres-data`).

Перед запуском убедитесь, что локальные PowerShell-процессы и старый postgres-контейнер
(`web-postgres-1`) остановлены: `npm run local:stop` из `web/`.

## VPS запуск

На VPS должны быть готовы `/etc/hh-agent/runtime.env` и `/etc/hh-agent/credentials/`
(формат — как в `deploy/ubuntu/runtime.env.example`). После migration создайте первого HR через
`npm run auth:create -- <корпоративный-email> "Алсу Салямова"`. В `.env` задать
`HH_DOMAIN=your.domain`, `HH_POSTGRES_PASSWORD`, `E2E_FIXTURE_CONTROL_TOKEN`.

```bash
cp deploy/docker/.env.example deploy/docker/.env   # на VPS
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.vps.yml up -d --build
```

Первый запуск certbot: получите сертификат, пока nginx ещё без TLS, либо выполните
`docker compose -f ... exec certbot certonly --webroot -w /var/www/certbot -d $HH_DOMAIN`.
После получения сертификата перезапустите nginx.

Итог: HTTPS на `https://$HH_DOMAIN` с серверной email/password session-аутентификацией.
Nginx очищает любые присланные клиентом identity headers.

## E2E fixture-controller (опционально)

Локальный контрольный контур для canonical E2E включается профилем `e2e`:

```bash
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.local.yml --profile e2e up -d
```

## Очереди, readiness и масштабирование

RabbitMQ имеет очереди `candidate.tasks.<class>` для `control`, `documents`, `media`, `transcription`, `llm`, `reports`, `drive`, `notifications` и отдельные DLQ. Broker переносит только технический envelope; материалы кандидата и результаты остаются в PostgreSQL/artifact store.

Каждая запись интервью проходит по независимой PostgreSQL-цепочке `transcript-media-shard → transcript-submit-shard → transcript-collect-shard`; готовые текстовые стенограммы обрабатывает `transcript-normalize-shard`. Незавершённый collect возвращается в очередь только после `available_at`, поэтому ожидание AssemblyAI не удерживает worker slot или unacked delivery.

`GET /api/health/processing` возвращает broker status, consumer count по каждому обязательному пулу, queue depth и dispatch lag. Его `503` означает недоступность обработки, но не блокирует read-only web и обычный `/api/health`.

Пулы масштабируются независимо, например:

```bash
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.vps.yml up -d \
  --scale worker-documents=3 --scale worker-transcription=3 --scale worker-llm=4
```

`RABBITMQ_PREFETCH` ограничивает unacked deliveries одного процесса, а `RABBITMQ_MAX_PER_RUN` не даёт одному кандидату занять весь пул. `RABBITMQ_REPUBLISH_AFTER_MS` повторно ставит в очередь давно подтверждённую, но всё ещё `RUNNABLE` задачу: это восстанавливает работу после потери или пересоздания durable queue, а PostgreSQL claim делает повторную доставку безопасной. Worker identity формируется из роли, hostname, PID и runtime instance ID, поэтому replicas не делят lease owner.

Если RabbitMQ недоступен, новые runnable задачи остаются в transactional dispatch outbox. После восстановления publisher делает reconcile и переиздаёт недоставленные поколения; consumer всегда проверяет task version в PostgreSQL, поэтому stale/duplicate delivery безопасно ack-ается без повторного результата. Смотрите `rabbit-dispatch-publisher-error`, `rabbit-worker-delivery-error`, `rabbit-worker-dead-letter` и `/api/health/processing`; содержимое сообщений в логи не выводится.

Для временного rollback транспорта установите `CANDIDATE_DISPATCH_TRANSPORT=postgres`, остановите `dispatch-publisher` и Rabbit-сервисы `worker-control`, `worker-documents`, `worker-media`, `worker-transcription`, `worker-llm`, `worker-reports`, `worker-drive`, `worker-notifications`, затем запустите прежний consumer командой `docker compose --profile postgres-transport up -d worker-postgres`. Он использует тот же executor, PostgreSQL claim/commit и продолжает новый graph последовательно. Не очищайте Rabbit queues, `agent_task_dispatch_outbox`, `agent_fanout_*` или `agent_tasks`.

## Резервное копирование

`pg_dump` через postgres-контейнер:

```bash
docker compose -f deploy/docker/docker-compose.yml exec postgres pg_dump -U hh_agent hh_agent > backup.sql
```

Для VPS используйте существующий `deploy/ubuntu/postgres-backup.sh` либо cron с `pg_dump`
внутри контейнера. Именованный volume `postgres-data` изолирован от хоста.
