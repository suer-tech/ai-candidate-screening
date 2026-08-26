# HH AI-screener — docker compose (локально и на VPS)

Приложение целиком поднимается docker compose: PostgreSQL, web/API, durable worker,
media и document processors. Один образ (`web/Dockerfile`) обслуживает все сервисы,
команда выбирается в compose. PowerShell-лаунчер и systemd-юниты не требуются.

## Структура

- `docker-compose.yml` — базовые сервисы (`postgres`, `web`, `worker`, `media-processor`,
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

Allowlist credentials, preflight и секреты не меняются.

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

## Масштабирование worker

Worker горизонтально масштабируется: `docker compose ... up -d --scale worker=2`
(имена worker уникальны благодаря `AGENT_RUNTIME_WORKER_ID: docker-worker-1`; при scale
добавьте уникальность, например через композерную переменную).

## Резервное копирование

`pg_dump` через postgres-контейнер:

```bash
docker compose -f deploy/docker/docker-compose.yml exec postgres pg_dump -U hh_agent hh_agent > backup.sql
```

Для VPS используйте существующий `deploy/ubuntu/postgres-backup.sh` либо cron с `pg_dump`
внутри контейнера. Именованный volume `postgres-data` изолирован от хоста.
