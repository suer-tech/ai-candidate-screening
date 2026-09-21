## Context

OCR и HR находятся на разных VPS. Telegram long polling и Codex runtime уже принадлежат OCR контуру, поэтому второй bot не нужен. HR хранит конфиденциальные персональные данные, а Prometheus/Loki query APIs позволяют произвольные запросы; прямой доступ Pulse к ним или PostgreSQL неприемлем.

## Goals / Non-Goals

**Goals:** хранить историю метрик и технических логов HR, видеть capacity/error/backlog/stall signals, получать alerts в существующем Telegram bot и задавать Pulse вопросы по обеим системам.

**Non-Goals:** давать Pulse raw SQL/PromQL/LogQL, содержимое кандидатов или shell; выполнять restart/deploy/code changes HR; публиковать Grafana в интернет; считать отсутствие данных нулём; объединять OCR documents и HR candidates в одну безымянную метрику.

## Decisions

### 1. Monitoring остаётся локальным каждому VPS

HR Prometheus и Loki хранят данные на HR VPS. Это устраняет cross-VPS remote-write dependency и сохраняет наблюдаемость при временной недоступности OCR VPS. Grafana использует только локальные datasources и публикуется на `127.0.0.1` для SSH tunnel.

### 2. Pulse использует bounded operations gateway

Отдельный `ops-gateway` process в application image предоставляет `/metrics`, `/health` и `/v1/{days,metrics,logs,overview,alerts}`. Public nginx проксирует только `/api/ops/` после source-IP allowlist. Gateway дополнительно проверяет constant-time bearer token из `internal-service-tokens.json`.

Имена query и диапазоны allowlisted. Gateway сам выполняет заранее определённые SQL/PromQL/LogQL запросы с timeout, row/point/result limits и возвращает только агрегаты. Upstream error text не возвращается.

### 3. HR business metrics строятся из канонического PostgreSQL state

Завершённые runs считаются по terminal `agent_runs.state` и `last_progress_at`; unique candidates дедуплицируются внутри окна. Duration считается от `agent_goals.created_at` до terminal timestamp, stage duration — из `candidate_stage_metrics`. Retry count берётся из дополнительных attempts и всегда сопровождается counting note. Удалённые по retention записи не интерпретируются как нулевой historical load.

### 4. Infrastructure metrics разделены по источникам

Prometheus scrapes operations service, RabbitMQ built-in Prometheus endpoint, node-exporter, cAdvisor, blackbox probes и собственные monitoring components. Alerts используют `for` durations и Alertmanager grouping, чтобы краткий transient spike не создавал поток сообщений.

### 5. Loki остаётся privileged local evidence, Pulse видит только allowlist

Alloy читает Docker logs локально. Grafana доступна только оператору через SSH. Remote `/logs` парсит JSON events и отдаёт только event name, allowlisted safe code, level, routing class, outcome и числовые duration/count fields. Raw line, IDs, paths, host labels и arbitrary labels отбрасываются.

### 6. Один bot доставляет alerts и диалог

OCR admin-bot периодически получает `/v1/alerts` HR gateway, дедуплицирует firing/resolved state и отправляет уведомления тем же администраторам. Недоступность HR gateway является отдельным сигналом после нескольких последовательных failures. Диалоговый Pulse выбирает OCR/HR tools по вопросу и всегда указывает систему, источник, окно и coverage.

### 7. Credentials дополняются без скрытой ротации

Fresh install generator создаёт `OPS_READ_INTERNAL_TOKEN`. Отдельная idempotent command добавляет только отсутствующий token существующей production конфигурации и сохраняет остальные значения без изменений. Token не находится в compose env, logs, Git или Telegram.

## Failure modes

- HR gateway недоступен: OCR monitoring продолжает работать, bot сообщает о потере HR visibility после debounce.
- OCR VPS недоступен: локальные HR Prometheus/Loki/Alertmanager продолжают собирать данные; Telegram доставка восстановится после OCR recovery.
- Loki/Prometheus недоступен: gateway возвращает `status=unavailable`, не пустой успешный результат.
- Source IP изменился: nginx закрывает endpoint до явного обновления allowlist.
- Token leaked: credential ротируется отдельно, без ротации product/service tokens.
