# Архитектура проекта

## Назначение и фактический runtime

Сервис автоматизирует найм: HR вручную задаёт название вакансии, RouterAI генерирует редактируемый профиль, а автономный durable runtime обнаруживает материалы кандидата в личном Google My Drive, транскрибирует интервью, строит доказательную оценку, публикует два PDF и отправляет Telegram-уведомление.

Production-контур не использует Cloudflare, D1, R2, Shared Drive или service account. Его состав: Node.js/Nitro web, постоянный agent worker, локальные media/document processors и PostgreSQL 16. На Windows PostgreSQL работает в Docker Compose; на Ubuntu — как loopback-only системная служба.

## Точки запуска

- `web/scripts/run-runtime-process.ts` — единая точка процессов `web`, `worker`, `media`, `document`, `controller` и приватного `benchmark`.
- `web/app/api/` — публичные product/OAuth/health routes и закрытые internal runtime/tool routes Nitro.
- `deploy/local/local.ps1` — Windows-команды `bootstrap`, `check`, `start`, `stop`.
- `deploy/ubuntu/install.sh` — immutable release, PostgreSQL 16, systemd, nginx Basic Auth/TLS, firewall и backup timers на Ubuntu.
- `web/scripts/postgres-migrate.ts` — forward-only PostgreSQL migrations под advisory lock.

## Основной поток данных

```text
HR: название вакансии
  -> RouterAI: структурированный профиль (до 4 попыток)
  -> preview и подтверждение HR
  -> папка вакансии в личном My Drive

My Drive: папка кандидата
  -> discovery каждые 15 секунд
  -> три последовательных минутных снимка без изменений
  -> immutable input version и durable goal/plan/tasks в PostgreSQL
  -> PDF/DOCX extraction + FFmpeg + AssemblyAI EU
  -> protected LLM traces и evidence graph
  -> при matrix routing: shared claim одной матрицы на profileVersion
  -> LLM compile (semantic required; hardRequired только для stop-factor sourceRef) -> один clean critic-editor возвращает окончательную матрицу -> immutable checksum publish
  -> decision-safe нормализованная стенограмма разбивается на перекрывающиеся окна по полному токенному бюджету provider-запроса без суммаризации
  -> claims извлекаются из каждого окна и объединяются -> global conflicts по всем пакетам -> все matrix rows -> critical row verification
  -> unmapped INFORMATIONAL signals -> assess-unmapped-risk -> independent verify-critical-risk
  -> eval gate; retry, repair, replan либо WAITING_FOR_HUMAN
  -> versioned assessment и два PDF
  -> outbox/reconcile: My Drive + Telegram
  -> READY=100%
```

## Границы модулей

- `web/server/configuration/` — fail-closed загрузка одного `runtime.env`, точного credential allowlist и server dependency container.
- `web/server/storage/` и `web/drizzle-postgres/` — PostgreSQL pool, migrations, `bytea` blob store и приватные временные каталоги.
- `web/server/product/` — вакансии, кандидаты, lifecycle, dashboard и LLM-генерация вакансии.
- `web/server/google-drive-oauth/` — personal OAuth PKCE, AES-256-GCM token envelope, optimistic refresh, My Drive registry и descendant/tool-grant checks.
- `web/server/agent-runtime/` — goal graph, durable queue, leases/fencing, checkpoints, grants, budgets, memory, eval/repair/replan, escalation/resume и outbox/compensation.
- `web/server/candidate-pipeline/` — discovery, material classification, document/media/transcription tools, facts/evidence, assessment, reports, notifications и progress projection.
- `web/server/candidate-pipeline/matrix-driven.ts`, `matrix-compilation.ts`, `matrix-postgres-repository.ts` — canonical matrix contract, LLM-requiredness с техническим `hardRequired ↔ stop-factor sourceRef` gate, single-pass compiler/critic-editor coordinator, deterministic formula и shared PostgreSQL persistence. Критик один раз возвращает полный окончательный successor; отдельные repair/re-critique не блокируют кандидата. Отдельного requirements UI/write-поля нет; `VacancyRecord.requirements` читается только для совместимости старых записей.
- `web/server/media-processor/`, `web/server/document-processor/` — loopback-only тяжёлые обработчики с отдельными bearer tokens.
- `web/server/llm/` — RouterAI/OpenAI-compatible gateway, strict Structured Outputs через отдельный `response_format.json_schema`, рекурсивная fail-closed проверка response artifacts, capability routing, budgets и защищённые трассы без секретов в событиях. JSON Schema не дублируется в prompt messages; выбранная RouterAI-модель обязана явно поддерживать Structured Outputs.

## Персистентность и эффекты

PostgreSQL хранит product state, OAuth state, goal/run/task/event projections, checkpoints, grants/budgets, evidence/assessment/report metadata, outbox и bounded binary artifacts. Queue claim использует `FOR UPDATE SKIP LOCKED`; lease token является fencing token. Matrix migration добавляет immutable vacancy matrix на точную `profileVersion`, fenced compilation lease и candidate/run/input-scoped claims, conflicts и rows. `agent_runs.workflow_version` фиксируется при создании и не меняется после переключения routing. Внешняя запись проходит через intent/outbox, а неизвестный исход сверяется перед повтором. Неустранимые препятствия дают типизированную эскалацию с причиной, evidence и допустимыми действиями человека.

Новая семантика фиксируется как `matrix-v2`. Формула отклоняет кандидата при подтверждённом срабатывании стоп-фактора, доказанном несоответствии LLM-классифицированному `required` или independently verified `criticalUnmappedRisk`. Open pass сам не принимает решение: критический риск является candidate-scoped artifact с отдельными assessment/verification traces, evidence locators и не изменяет shared vacancy matrix. Непроверенный сигнал остаётся INFORMATIONAL, подтверждённый некритичный риск — оговоркой.

Google доступ — только к явно выбранному корню личного My Drive и зарегистрированным потомкам. OAuth refresh token зашифрован; браузер получает только безопасную проекцию подключения. Provider secrets читаются из отдельных файлов и не передаются в CLI или логи.

## Конфигурация и эксплуатация

- Локально: `web/.runtime/runtime.env` и ровно восемь файлов в `web/.runtime/credentials/`; каталог игнорируется Git.
- VPS: `/etc/hh-agent/runtime.env` и `/etc/hh-agent/credentials/`; web доступен через nginx HTTPS + Basic Auth, который перезаписывает доверенный principal, PostgreSQL и processors слушают только loopback.
- `cd web && npm run build:id` — детерминированный immutable build ID из delivery-файлов без чтения ignored credentials/candidate.
- Runtime preflight сверяет точный URL/host/port/route media и document processors, чтобы задача не стартовала при рассинхронизации loopback endpoint.
- `npm run preflight:runtime` проверяет migrations, OAuth/runtime/provider configuration и запрещённые legacy settings.
- `npm run security:sentinel` ищет реальные значения credentials в source, logs, evidence и текстовых/JSON полях PostgreSQL, не печатая сами значения.
- Daily `pg_dump` шифруется `age`; отдельный timer проверяет восстановление в изолированную временную БД. Rollback только forward-compatible, без destructive down migration.

## Проверки

- `cd web && npm run local:bootstrap|local:check|local:start|local:stop` — локальный lifecycle.
- `cd web && npm test` — build и основной unit/rendered/acceptance regression.
- `cd web && npm run test:postgres-integration` — реальные PostgreSQL/OAuth/temp invariants.
- `cd web && npm run test:vps-postgres` — migration/runtime/VPS acceptance.
- `cd web && node --test tests/matrix-driven-assessment.acceptance.test.mjs` — независимый synthetic matrix-driven acceptance-контур.
- `cd web && npm run local:status` — безопасная сводка web/worker/processors/PostgreSQL без PID, credentials и provider IDs.
- `cd web && npm run e2e:required` — обязательные `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` в provisioned среде.
- `cd web && npm run benchmark:preflight -- --record-consent` и `npm run benchmark:run` — ignored локальный benchmark; reference-файлы служат только offline oracle и запрещены на Drive/provider/blob boundaries.

Нормативный источник согласованных требований — `openspec/specs/`. Active changes не заменяют main specs до явной синхронизации.
