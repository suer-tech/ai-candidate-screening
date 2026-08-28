# Архитектура проекта

## Назначение и фактический runtime

Сервис автоматизирует найм: HR вручную задаёт название вакансии, RouterAI генерирует редактируемый профиль, а автономный durable runtime обнаруживает материалы кандидата в личном Google My Drive, транскрибирует интервью, строит доказательную оценку, публикует один цельный PDF и отправляет Telegram-уведомление. Старые пары PDF сохраняются только для чтения ранее завершённых запусков.

Production-контур не использует Cloudflare, D1, R2, Shared Drive или service account. Его состав: Node.js/Nitro web, постоянный agent worker, локальные media/document processors и PostgreSQL 16. На Windows PostgreSQL работает в Docker Compose; на Ubuntu — как loopback-only системная служба.

## Точки запуска

- `web/scripts/run-runtime-process.ts` — единая точка процессов `web`, `worker`, `media`, `document` и `controller`.
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
  -> PDF/DOCX extraction + один источник интервью
     -> запись: FFmpeg + AssemblyAI EU
     -> готовая TXT/Markdown/SRT/VTT стенограмма: локальный deterministic parser без media/STT
     -> готовая DOCX стенограмма: Mammoth document extraction -> тот же deterministic parser без media/STT
  -> protected LLM traces и evidence graph
  -> при matrix routing: shared claim одной матрицы на profileVersion
  -> LLM compile компактного coverage manifest -> один fail-soft critic-editor проверяет fidelity/coverage/over-splitting/stop-factor origin -> immutable checksum publish; при сбое критика публикуется технически валидный compiler draft с warning
  -> decision-safe нормализованная стенограмма разбивается на перекрывающиеся окна по полному токенному бюджету provider-запроса без суммаризации
  -> каждый batch возвращает extraction coverage по всем criterion IDs; deterministic harness делает missing-only retry, merge/dedup и один gap-search
  -> claims объединяются -> fail-soft global conflicts -> каждая matrix row получает одно из трёх состояний -> узкая fail-soft проверка stop/material-rejection строк
  -> balanced STRENGTH/CONCERN/QUESTION observations -> holistic LLM recommendation; подтверждённый явный stop factor остаётся единственным deterministic override
  -> eval gate; retry, repair, replan либо WAITING_FOR_HUMAN
  -> versioned assessment -> `compose-candidate-report/v2` без raw resume/transcript; decision/evidence validation и deterministic fallback
  -> один versioned candidate-report PDF с кликабельными Google Drive/Docs ссылками на использованные материалы
  -> outbox/reconcile: My Drive + Telegram
  -> READY=100%

Повторная обработка сначала переводит кандидата в `WAITING_FOR_STABILITY`; новый run разрешён только после свежего post-command чтения live Drive-папки. Manifest identity учитывает `fileId`, provider version и material metadata, поэтому изменённый при прежнем размере файл создаёт новую immutable `inputVersion`, а добавление/удаление файла отключает reuse. После terminal `FAILED` точное совпадение свежего manifest, `inputVersion`, `profileVersion`, goal type, `workflowVersion` и `policyVersion` создаёт новый run с `recovery_source_run_id`. В `matrix-v3` переиспользуется только непрерывный префикс задач `SUCCEEDED`, для каждой из которых найден immutable artifact с ожидаемыми provenance и schema version. Эти задачи фиксируются через `reused_from_task_id`, первая failed/отсутствующая/несовместимая стадия становится `RUNNABLE`, все следующие остаются `PENDING`. После `SUCCEEDED`, смены входов/профиля/политики/workflow или разрыва artifact chain создаётся полный либо частичный свежий план без доверия к неподтверждённым этапам.
После создания run `candidate.drive-snapshot/v1` воспроизводит только pinned `candidate_input_versions.manifest_json` и не перечитывает live-состав папки. Поэтому добавление файла даже до исполнения первой задачи не меняет и не останавливает текущий run; discovery worker фиксирует изменение отдельно как следующую input version.
Dashboard projection также проходит по recovery lineage: опубликованный successor использует assessment/evidence/transcript исходного run и во всех представлениях возвращает единое `READY / 100% / Результат опубликован`.
```

## Границы модулей

- `web/server/configuration/` — fail-closed загрузка одного `runtime.env`, точного credential allowlist и server dependency container.
- `web/server/storage/` и `web/drizzle-postgres/` — PostgreSQL pool, migrations, `bytea` blob store и приватные временные каталоги.
- `web/server/product/` — вакансии, кандидаты, lifecycle, dashboard и LLM-генерация вакансии.
- `web/server/google-drive-oauth/` — personal OAuth PKCE, AES-256-GCM token envelope, optimistic refresh, My Drive registry и descendant/tool-grant checks.
- `web/server/agent-runtime/` — goal graph, durable queue, leases/fencing, checkpoints, grants, budgets, memory, eval/repair/replan, escalation/resume и outbox/compensation.
- `web/server/candidate-pipeline/` — discovery, material classification, document/media/transcription tools, facts/evidence, assessment, reports, notifications и progress projection.
- `web/server/candidate-pipeline/core.ts` различает interview source `recording` и `ready-transcript`. `transcription.ts` преобразует TXT/Markdown/SRT/VTT либо извлечённый из transcript-like DOCX текст в тот же `transcript-bundle/v1`: явные speaker labels и таймкоды сохраняются, а текст без времени получает line locator. DOCX рекомендаций и характеристик остаётся supported additional document. Production runtime на ready-transcript path не вызывает media processor и AssemblyAI; DOCX использует document processor/Mammoth, downstream и selective recovery используют прежний transcription artifact contract.
- `web/server/candidate-pipeline/matrix-driven.ts`, `matrix-compilation.ts`, `matrix-coverage.ts`, `transcript-claim-batching.ts`, `matrix-postgres-repository.ts` — compact canonical matrix contract, single-pass fail-soft compiler/critic-editor, exact batch/evaluation coverage, targeted retry, gap-search, holistic recommendation со stop-factor override и shared PostgreSQL persistence. Резюме и ответы кандидата являются допустимыми HR-источниками; отсутствие внешнего подтверждения само по себе не понижает строку. Отдельного requirements UI/write-поля нет; `VacancyRecord.requirements` читается только для совместимости старых записей.
- Итоговая matrix row содержит HR-вывод и evidence references с точными `claimId/sourceRef/quote/relation`. Перед приёмкой runtime сверяет их с объединённым claim graph: положительное или отрицательное решение без доказательства, придуманная цитата либо locator получают targeted retry. `Недостаточно данных` без evidence допустимо только с явными missing data и вопросом HR.
- `web/server/product/postgres-repository.ts` разрешает `matrix-evidence.claimsRef` в отдельный `matrix-claims` artifact и строит публичную HR-проекцию всех строк. Внутренние claim/criterion/artifact IDs и verifier remarks остаются в audit; веб показывает название пункта, вывод, цитату и понятное место источника. `Резюме для принятия решения` детерминированно собирается из уже доказанных положительных выводов, затем зон внимания и дополнительного контекста; оно не вызывает LLM, не пересчитывает рекомендацию и не подменяет сохранённое основание итога. Та же HR-safe политика применяется при формировании PDF через `reports.ts`.
- `web/server/candidate-pipeline/reports.ts` и `web/server/document-processor/server.ts` формируют единый компактный `candidate-report` из 11 последовательных HR-разделов по принятому образцу: кандидат/вакансия, исходные материалы, организационные моменты, ревью, ключевые доказательства, ABC по направлениям, технический чек, мотивация/соответствие, риски, решение и финальное HR-резюме. `compose-candidate-report/v2` получает только итоговые решения и компактный evidence catalog, группирует применимые темы технического чека и не может менять recommendation/ABC/row states; invalid/timeout response даёт deterministic fallback. `projectReportSourceMaterials` берёт только supported non-results entries immutable manifest, строит человекочитаемые подписи и allowlisted Google Drive/Docs HTTPS цели; renderer показывает их синими подчёркнутыми PDF `/Link` annotations. Полная матрица остаётся в model/web/audit, но не рендерится отдельным приложением PDF. Endpoint `/v1/render-candidate-report` возвращает один PDF/checksum; endpoint парных отчётов удалён.
- `web/server/media-processor/`, `web/server/document-processor/` — loopback-only тяжёлые обработчики с отдельными bearer tokens.
- PDF processor fail-closed проверяет структуру, readability budgets, обязательные model sections и checksum. Text-extraction content oracle является диагностическим: его false negative сохраняется в `validation_json` как warning с безопасным fingerprint, но не останавливает публикацию структурно валидного отчёта.
- `web/server/llm/` — RouterAI/OpenAI-compatible gateway, strict Structured Outputs через отдельный `response_format.json_schema`, рекурсивная fail-closed проверка response artifacts, capability routing, budgets и защищённые трассы без секретов в событиях. JSON Schema не дублируется в prompt messages; выбранная RouterAI-модель обязана явно поддерживать Structured Outputs.

## Персистентность и эффекты

PostgreSQL хранит product state, OAuth state, goal/run/task/event projections, checkpoints, recovery lineage, grants/budgets, evidence/assessment/report metadata, outbox и bounded binary artifacts. Queue claim использует `FOR UPDATE SKIP LOCKED`; lease token является fencing token. Новые матрицы компилируются только с identity `matrix-v3`; исторические `matrix-v2` не переиспользуются и доступны только как неизменяемые записи. `agent_runs.recovery_source_run_id` и `agent_tasks.reused_from_task_id` сохраняют provenance выборочного восстановления без изменения предшествующего запуска. Внешняя запись проходит через intent/outbox, а неизвестный исход сверяется перед повтором.

Candidate-scoped matrix claims, conflicts и rows защищены от обычного `UPDATE/DELETE`, но используют cleanup-aware immutable guard: repository устанавливает transaction-local `hh.cleanup_run_ids` перед подтверждённым lifecycle delete, и только строки с входящим в scope `run_id` допускаются к каскадному удалению. Shared vacancy matrices остаются безусловно неизменяемыми и не удаляются вместе с кандидатом.

Единственный workflow `matrix-v3` использует coverage-first policy `ASM-050/coverage-first-v1`. Каждый критерий оценивается ровно один раз как `Соответствует`, `Не соответствует` или `Недостаточно данных`; положительные строки и дополнительные `STRENGTH` питают сильные стороны и компетенции, отрицательные строки и `CONCERN` — ограничения, неизвестные строки и `QUESTION` — вопросы. Итоговую категорию синтезирует LLM по всем строкам и наблюдениям. Только подтверждённый явный стоп-фактор безусловно задаёт `Не рекомендовать`.

ABC не выводится из criterion IDs основной матрицы. `abc_matrix_assessment` вызывается для заданных vacancy directions и сохраняет значения по `directionId`; если описания A/B/C пусты, LLM строит рабочую шкалу по названию направления и контексту роли. «ABC-профиль не настроен» показывается только при отсутствии самих направлений.

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

Нормативный источник согласованных требований — `openspec/specs/`. Active changes не заменяют main specs до явной синхронизации.
