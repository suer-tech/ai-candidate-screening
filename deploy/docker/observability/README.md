# HR observability rollout

Контур запускается автоматически вместе с VPS override. Prometheus, Loki,
Alertmanager и exporters доступны только внутри compose network. Grafana
публикуется на `127.0.0.1:3002`; внешний read-only gateway доступен только по
`https://<HH_DOMAIN>/api/ops/v1/*`, с IP OCR VPS и bearer token одновременно.

## Однократная подготовка HR VPS

1. Создайте отдельный пароль Grafana вне application credential allowlist:

   ```bash
   install -d -m 0700 -o root -g root /etc/hh-observability
   umask 077
   openssl rand -base64 36 > /etc/hh-observability/grafana-admin-password
   chmod 0600 /etc/hh-observability/grafana-admin-password
   ```

2. В `deploy/docker/.env` задайте публичный IPv4 OCR VPS:

   ```dotenv
   HH_OPS_ALLOWED_IP=203.0.113.10
   HH_GRAFANA_PORT=3002
   HH_GRAFANA_ADMIN_PASSWORD_FILE=/etc/hh-observability/grafana-admin-password
   ```

3. Добавьте operations token без ротации существующих service tokens:

   ```bash
   docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.vps.yml \
     run --rm --no-deps -v /etc/hh-agent:/config:rw ops-gateway npm run ensure:ops-read-token
   ```

4. Скопируйте значение `OPS_READ_INTERNAL_TOKEN` из
   `/etc/hh-agent/credentials/internal-service-tokens.json` в защищённый `.env`
   OCR проекта как `OPS_HR_READ_TOKEN`. Не отправляйте значение в чат или Git.
   В OCR `.env` также задайте `OPS_HR_BASE_URL=https://<HH_DOMAIN>/api/ops`.

5. Пересоздайте HR stack:

   ```bash
   docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.vps.yml up -d --build
   docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.vps.yml ps
   ```

## Просмотр Grafana

С рабочего компьютера:

```bash
ssh -L 13003:127.0.0.1:3002 <deploy-user>@<HR_VPS_IP>
```

Откройте `http://127.0.0.1:13003`. Пользователь по умолчанию `admin`, пароль
лежит только в `/etc/hh-observability/grafana-admin-password` на HR VPS.

## Smoke после rollout

С OCR VPS проверьте gateway:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $OPS_HR_READ_TOKEN" \
  "https://<HH_DOMAIN>/api/ops/v1/overview"
```

В Telegram проверьте `/hrhealth`, `/hrtoday` и вопрос «сравни сегодняшнюю
нагрузку OCR и HR с предыдущими днями». До этих production-like проверок change
не считается полностью принятым.

## Rollback

Monitoring не изменяет product schema. Для временного rollback остановите только
`grafana prometheus alertmanager loki alloy node-exporter cadvisor blackbox-exporter ops-gateway`.
Product web/workers/PostgreSQL/RabbitMQ продолжат работу. Не удаляйте volumes,
если нужна retained history.
