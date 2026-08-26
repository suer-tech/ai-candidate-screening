## 1. Независимый ATDD RED

- [x] 1.1 Передать независимому субагенту specs/design и получить synthetic acceptance matrix для PostgreSQL topology, Node runtime, benchmark isolation и progress UI.
- [x] 1.2 Добавить RED contract test, запрещающий `cloudflare:workers`, D1/R2/Miniflare/Wrangler/Sites в production dependency graph и readiness.
- [x] 1.3 Добавить RED PostgreSQL clean/upgrade schema, transaction, concurrent claim, fencing, outbox/reconcile и blob invariants tests.
- [x] 1.4 Добавить RED Node/Nitro production build и authenticated route smoke без Cloudflare bindings.
- [x] 1.5 Добавить RED config/secret allowlist tests для единого env/credential directory и отказа от service-account/Shared Drive/Cloudflare settings.
- [x] 1.6 Добавить RED private benchmark harness на synthetic filenames/checksums с consent, role isolation, deny-set network audit, oracle thresholds и cleanup.
- [x] 1.7 Добавить RED rendered UI tests для одинакового `progressPercent=55`, milestone и accessible progress bar в dashboard/list cards.
- [x] 1.8 Сохранить JUnit/JSON/timeline RED evidence без PII/secrets и подтвердить, что failures содержательные, а не import/fixture errors.
- [x] 1.9 Независимо добавить RED acceptance для frozen HR-approved profile checksum, запрета reference-derived profile, private PDF review/retention/deletion и local canonical E2E через Node/PostgreSQL вместо in-memory/SQLite controller.
- [x] 1.10 Сохранить для новых scenarios JUnit/JSON/timeline RED evidence без PII/secrets и подтвердить точные product gaps.

## 2. PostgreSQL foundation

- [x] 2.1 Добавить PostgreSQL driver, Drizzle PostgreSQL config и общий server-only pool/transaction lifecycle с bounded connections/timeouts.
- [x] 2.2 Перенести полную schema с `sqlite-core` на `pg-core`, сохранив таблицы, IDs, FK, unique/check constraints, indexes, UTC timestamps и JSON validation.
- [x] 2.3 Реализовать PostgreSQL migrations для product, OAuth, durable runtime, domain artifacts, reports, notifications, metrics и cleanup/tombstones.
- [x] 2.4 Перенести append-only/immutability/pair/READY triggers и one-time Drive attachment semantics на PostgreSQL.
- [x] 2.5 Добавить migration advisory lock, schema version preflight и fail-closed startup при pending/failed migration.
- [x] 2.6 Добавить `artifact_blobs` metadata/`bytea`, checksum, MIME, scope, retention/protected flags, immutable trigger и per-kind/global size limits.
- [x] 2.7 Реализовать PostgreSQL blob store с atomic insert/get/delete-by-scope, streaming-safe bounds и запретом bytes в logs/events.
- [x] 2.8 Добавить clean schema tests на реальном PostgreSQL 16 и оставить SQLite только для hermetic contract/unit fixtures.

## 3. Product и Google OAuth repositories

- [x] 3.1 Выделить database/repository contracts без D1 types и vendor-specific method names.
- [x] 3.2 Реализовать PostgreSQL product repository для vacancies, candidates, revisions, audit, lifecycle, results и dashboard projections.
- [x] 3.3 Реализовать PostgreSQL Google OAuth repository для PKCE operations, encrypted connection, optimistic refresh, audit и object registry.
- [x] 3.4 Сохранить AES-256-GCM envelope/AAD/key version и добавить decrypt/refresh probe без token output.
- [x] 3.5 Перенести personal My Drive descendant/operation identity queries на recursive PostgreSQL CTE и exact tool grants.
- [x] 3.6 Удалить service-account backend, Shared Drive flags/parameters и corporate Google runtime paths.
- [x] 3.7 Переподключить vacancy creation, Drive health/status/connect/callback/disconnect/smoke routes к Node dependency container и PostgreSQL.
- [x] 3.8 Получить GREEN product/OAuth repository, security, reconnect/account-mismatch и UI tests на PostgreSQL.

## 4. Durable agent runtime и candidate pipeline

- [x] 4.1 Реализовать PostgreSQL goal/run/plan/task/event repository с atomic sequence/revision protocol.
- [x] 4.2 Реализовать `FOR UPDATE SKIP LOCKED` claim, lease heartbeat/fencing, attempt/checkpoint и startup recovery для нескольких workers.
- [x] 4.3 Перенести grants, hard budgets, memory/artifact refs, eval/repair/replan, escalation/resume и supersede на PostgreSQL transactions.
- [x] 4.4 Перенести durable outbox, unknown outcome, reconcile, compensation и terminal run/goal projection.
- [x] 4.5 Перенести discovery/stability/input versions, domain artifacts/evidence/assessment, reports, notifications, metrics и cleanup repositories.
- [x] 4.6 Заменить R2 candidate artifact store и protected LLM trace persistence на PostgreSQL blob store с прежними retention/access boundaries.
- [x] 4.7 Гарантировать, что Drive/media source bytes живут только в bounded private temp directory и удаляются при success/failure/restart recovery.
- [x] 4.8 Подключить production tool executor, provider adapters, PDF publication и Telegram к PostgreSQL checkpoints/outbox/blob refs.
- [x] 4.9 Добавить concurrent worker, lost lease, restart, timeout-after-effect, invalid_grant, pair failure, Telegram unknown и cleanup integration tests.
- [x] 4.10 Получить GREEN focused agent-runtime/canonical-pipeline/production-executor acceptance на PostgreSQL без D1/R2 fallback.

## 5. Node web/API runtime

- [x] 5.1 Добавить Nitro Node preset и minimal production build/route smoke до удаления Cloudflare plugin.
- [x] 5.2 Создать server configuration/dependency container для `process.env`, PostgreSQL, blobs, OAuth и provider adapters.
- [x] 5.3 Удалить все production imports `cloudflare:workers` и заменить route/service bindings на container dependencies.
- [x] 5.4 Удалить Cloudflare Vite plugin, Workers entry/bindings, `.openai/hosting.json`, Wrangler configs/scripts/dependencies и Sites build glue.
- [x] 5.5 Обновить `build/start/dev` scripts для Node output и обеспечить одинаковые route/auth semantics в dev/production.
- [x] 5.6 Добавить `/health/live`, `/health/ready` с PostgreSQL write/decrypt/blob/provider config probes без secrets.
- [x] 5.7 Проверить request lifecycle: trigger остаётся коротким, long-running tasks выполняются только background worker.
- [x] 5.8 Получить GREEN Node build, rendered HTML, authenticated API, restart и no-Cloudflare dependency tests.

## 6. D1/R2 import и rollback safety

- [x] 6.1 Реализовать read-only exporter локальной D1/SQLite schema с table counts, identities, JSON normalization и encrypted OAuth envelope.
- [x] 6.2 Реализовать local R2 object exporter с checksum/size manifest без вывода bytes или object names в logs.
- [x] 6.3 Реализовать transactional PostgreSQL importer только в пустую schema с FK/order handling и idempotent dry-run.
- [x] 6.4 Добавить verification counts, revisions, unique identities, blob hashes, decrypt/refresh probe и application read smoke.
- [x] 6.5 Выполнить локальный dry-run/import текущего state и сохранить safe aggregate evidence.
- [x] 6.6 Переместить прежний `.wrangler`/D1/R2 state в timestamped read-only backup без удаления; документировать явное последующее удаление.
- [x] 6.7 Добавить rollback runbook: pause triggers/claims/effects, previous compatible build, PostgreSQL backup и запрет destructive down migration.

## 7. Единая конфигурация и локальный PostgreSQL

- [x] 7.1 Создать Docker Compose PostgreSQL 16 с project-local ignored volume, healthcheck и loopback-only port.
- [x] 7.2 Заменить `local-services.env` и разрозненные `*_PATH` на `web/.runtime/runtime.env` и allowlisted `web/.runtime/credentials/`.
- [x] 7.3 Реализовать config loader с запретом unknown/duplicate/inline secrets, path/symlink escape и безопасным readiness projection.
- [x] 7.4 Мигрировать существующие local credentials в новые имена без печати/перезаписи/удаления исходников и проверить permissions.
- [x] 7.5 Удалить local templates/checkers для service account, Shared Drive, Cloudflare bindings и неиспользуемых smoke URLs/tokens.
- [x] 7.6 Обновить keyring/token generators на atomic create/explicit rotate внутри credential directory.
- [x] 7.7 Обновить PowerShell start/stop/preflight: PostgreSQL health/migrate, Node web, worker, media/document processors, hidden windows и единые logs/PIDs.
- [x] 7.8 Добавить одной командой local bootstrap/check/start/stop и понятный operator runbook без передачи ключей в чат.
- [x] 7.9 Пройти secret sentinel scan source/config/log/evidence/PostgreSQL и подтвердить ноль legacy active settings.

## 8. Server-derived progress и UI

- [x] 8.1 Добавить `progressPercent`/`progressMilestone` в candidate/domain/API types с валидацией диапазона.
- [x] 8.2 Реализовать server projection milestone mapping `0/5/10/25/40/55/70/80/90/100` из текущего run/checkpoints.
- [x] 8.3 Зафиксировать monotonic within run, reset on new input/run, last proven value on `WAITING_FOR_HUMAN`/failure и READY=100 независимо от Telegram.
- [x] 8.4 Создать reusable accessible `CandidateProgress` с `role=progressbar`, label, `aria-valuenow/min/max` и сохранённым визуальным стилем исходного commit.
- [x] 8.5 Вернуть полосу в каждую dashboard `processing-card` и добавить её в каждую candidate list card.
- [x] 8.6 Добавить responsive/dark/terminal/archived styles без client timer/inferred percentage.
- [x] 8.7 Получить GREEN unit/API/rendered/browser acceptance для одинакового процента во всех представлениях.

## 9. Приватный real-candidate benchmark

- [x] 9.1 Добавить ignore rules и safe preflight, который видит `candidate` folder, magic MIME и aggregate inventory без filenames/PII.
- [x] 9.2 Локально классифицировать девять файлов в ignored checksum manifest: inputs, consent-proof, reference ABC/result и excluded.
- [x] 9.3 Подтвердить consent-proof до чтения pipeline inputs и запретить любой provider call при отсутствующем/неоднозначном consent.
- [ ] 9.4 Создать ignored LLM-generated profile draft/approval pack, зафиксировать явное HR approval и привязать versioned oracle recommendation/ABC/anchors/sections/thresholds к exact profile checksum без reference-derived profile content.
- [x] 9.5 Реализовать deny-checksum firewall для input manifest, Drive upload, HTTP/provider requests и PostgreSQL blobs.
- [x] 9.6 Реализовать local fixture provision только pipeline inputs в временную Drive folder и обычный discovery/stability trigger без shortcuts.
- [x] 9.7 Реализовать offline deterministic oracle для structured facts/evidence, recommendation, ABC, stop-factors, report sections и PDF parse/content consistency.
- [x] 9.8 Реализовать safe evidence с build/config/model/schema/oracle fingerprints, aggregate scores/categories и нулём reference/PII/IDs/secrets.
- [x] 9.9 Реализовать unconditional PostgreSQL/Drive/provider/temp cleanup после GREEN/RED, owner-only retention ровно двух generated private PDF до review/deadline и доказуемое финальное удаление; incomplete phase сделать terminal RED.
- [ ] 9.10 Запустить полный shadow pipeline на реальном кандидате с frozen approved profile; при hard divergence исправлять extraction/prompts/schemas/assessment/reports и повторять до GREEN без новой генерации профиля.
- [ ] 9.11 Провести локальный human review агрегированных divergences и двух generated private PDF без копирования reference content в source/evidence, затем подтвердить их финальное удаление.

## 10. Локальная регрессия и release evidence

- [x] 10.1 Пройти typecheck, lint, Node build, PostgreSQL migrations clean/upgrade, unit, integration и security suites.
- [x] 10.2 Пройти все независимые acceptance tests из раздела 1, включая новые profile/retention/local-PostgreSQL-E2E scenarios, до полного GREEN и обновить JUnit/JSON/timeline evidence.
- [x] 10.3 Пройти четыре обязательных canonical E2E через собранные Node web/worker и durable PostgreSQL на одном local build/config/fixture identity; in-memory/SQLite conformance не засчитывать.
- [x] 10.4 Пройти personal OAuth reconnect/revoke/account-mismatch, worker restart/concurrency и outbox/reconcile matrix.
- [x] 10.5 Пройти RouterAI, AssemblyAI EU, personal Drive и Telegram real-provider smoke без secrets/PII/IDs в evidence.
- [ ] 10.6 Повторно пройти private real-candidate benchmark на immutable local build/profile/config identity, подтвердить application/Drive/provider/temp cleanup, private review retention и финальное удаление generated PDF.
- [x] 10.7 Обновить docs/architecture/index, локальный/VPS runbooks и удалить Cloudflare/D1/R2/corporate Google утверждения.
- [x] 10.8 Выполнить strict OpenSpec validation и оставить production readiness false до VPS gates.

## 11. Ubuntu VPS rollout

- [x] 11.1 Добавить PostgreSQL install/init role/database/pg_hba/backup directories с private permissions и без public listener.
- [x] 11.2 Добавить `hh-web.service`, обновить worker/media/document systemd units, dependencies, resource limits и credential loading.
- [x] 11.3 Добавить nginx HTTPS web config; оставить internal processors loopback-only и проверить firewall.
- [x] 11.4 Создать `/etc/hh-agent/runtime.env` и credential allowlist template без значений; добавить production preflight.
- [x] 11.5 Реализовать encrypted daily `pg_dump`, retention, checksum и isolated restore-test scripts/systemd timer.
- [ ] 11.6 Развернуть immutable build на предоставленном VPS, применить migrations и пройти Node/PostgreSQL readiness.
- [ ] 11.7 На одном build пройти четыре canonical E2E, real providers, OAuth reconnect, worker restart/reconcile, backup/restore и security audit.
- [ ] 11.8 Включить effectful routing только после полного GREEN; проверить два PDF/Telegram и выполнить test fixture cleanup.
- [ ] 11.9 Сохранить safe VPS build/config/fixture/evidence fingerprints и rollback rehearsal без credentials/PII.

## 12. Синхронизация и завершение

- [ ] 12.1 Синхронизировать delta specs с main specs только после local + VPS GREEN и устранить противоречия D1/R2/Shared Drive/service account.
- [ ] 12.2 Повторно проверить все связанные active changes против PostgreSQL/main specs и обновить либо supersede их без ложных completed tasks.
- [ ] 12.3 Архивировать change отдельным явным действием после 100% tasks, strict validation, independent acceptance и production-like evidence.
