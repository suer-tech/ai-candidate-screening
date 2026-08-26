## Context

См. `proposal.md` — Why и delta specs этого change. Сейчас route handlers импортируют `env` из `cloudflare:workers`, repositories принимают `D1Database`, protected traces/candidate artifacts используют `R2Bucket`, а local dev поднимает Miniflare через Cloudflare Vite plugin. Ubuntu package содержит workers/processors, но не web/API и PostgreSQL. Durable protocol и доменная схема уже существуют, поэтому меняется persistence/runtime substrate, а не semantics goal graph, grants, budgets, leases, gates, escalation и outbox.

В приватной `candidate` папке обнаружен пригодный набор из девяти файлов примерно 203 МБ: четыре PDF, два media container, два JSON и TXT. Один крупный media input не должен копироваться в PostgreSQL: source-of-record остаётся Google Drive, processing использует защищённый временный файл. Reference PDF отделяются checksum manifest до любого network call.

## Goals / Non-Goals

**Goals:**

- Один production topology: Node web/API + PostgreSQL + постоянные workers на Ubuntu VPS.
- Локальная parity через PostgreSQL 16 и те же entrypoints/migrations.
- Сохранение durable runtime invariants при конкурентных workers и restart.
- Полное удаление Cloudflare runtime/bindings/config из active path.
- Приватная повторяемая оценка качества на реальном кандидате без benchmark leakage.
- Одна понятная конфигурация и server-derived progress во всех candidate cards.

**Non-Goals:**

- Не заменять Google Drive как согласованный source/publish interface.
- Не хранить исходные 100+ MB media files постоянно в PostgreSQL.
- Не считать reference reports абсолютной истиной и не требовать дословного совпадения текста.
- Не добавлять multi-tenant/RBAC, Kubernetes, Temporal, S3/MinIO либо managed PostgreSQL.
- Не использовать SQLite для production-like доказательств.

## Decisions

### 1. PostgreSQL schema и native repositories вместо D1 compatibility shim

Drizzle schema переводится с `sqlite-core` на `pg-core`; runtime использует PostgreSQL driver pool и явный transaction context. Repository interfaces сохраняют доменные операции, но реализации переписываются под PostgreSQL SQL. Эмулировать D1 `prepare/bind/batch` поверх PostgreSQL не будем: такой shim скрывает различия `last_insert_rowid`, JSON functions, triggers, affected rows и locking и оставляет vendor vocabulary в production.

Claims выполняются одной транзакцией через `SELECT ... FOR UPDATE SKIP LOCKED`, затем atomic update lease owner/token/expiry и attempt insert. Revision/fencing условия остаются в `WHERE`; zero affected rows — conflict. Per-run event sequence блокируется row lock соответствующего run. Migrations получают PostgreSQL advisory lock, чтобы web и worker не мигрировали одновременно.

Альтернатива — Prisma либо новый ORM. Отклонена: Drizzle уже описывает схему и позволяет сохранить типизированные boundaries при меньшем rewrite.

### 2. PostgreSQL хранит app-owned blobs, source media остаётся в Drive

Добавляется `artifact_blobs`: opaque id, candidate/run scope, kind, MIME, checksum, byte size, retention class, protected flag, bytes `bytea`, timestamps. Metadata/domain rows ссылаются на blob id. Insert сверяет declared/actual size и checksum до commit; bytes неизменяемы trigger/policy. Стартовые hard limits задаются конфигурацией по artifact kind, общий ceiling — 32 MiB. Transcript JSON, raw/normalized LLM responses и два PDF укладываются в него; если реальная метрика докажет обратное, limit меняется конфигурацией после storage review.

Google Drive input PDF/media не дублируются надолго: worker скачивает exact version во временный каталог с `0700`, проверяет checksum, обрабатывает и гарантированно удаляет. AssemblyAI remote upload удаляется после локального сохранения результата. Reference benchmark reports никогда не входят в blob store.

Альтернативы — VPS filesystem blobs или MinIO. Отклонены сейчас: они добавляют отдельную consistency/backup/permission систему, тогда как текущий объём MVP допустим для PostgreSQL. Blob API остаётся портом, чтобы вынести storage позже без изменения pipeline.

### 3. Vinext собирается через Nitro Node preset

Удаляются Cloudflare Vite plugin, `cloudflare:workers` imports, Wrangler config/state и Sites hosting binding. Vinext остаётся UI/router слоем, а production build создаётся Nitro preset `node`; systemd запускает `.output/server/index.mjs`. Runtime env читается server-only configuration module из `process.env`, а database/artifact repositories создаются обычным Node dependency container.

Альтернатива — миграция на Next.js либо отдельный Express API. Отклонена как лишний одновременный framework rewrite. Если Nitro conformance выявит несовместимый route/RSC behavior, это blocker change, а не основание вернуть Cloudflare.

### 4. Один process topology, разные profiles

Ubuntu services: `hh-web`, `hh-agent-worker`, `hh-media-processor`, `hh-document-processor`, PostgreSQL 16 и nginx. Все application services работают отдельным Unix user, используют loopback URLs и общую database через разные pool limits. Nginx публикует только web HTTPS; internal processors не слушают public interface.

Локально Docker Compose поднимает только PostgreSQL с project-local volume; PowerShell launcher выполняет migrations и запускает те же четыре Node entrypoints. SQLite tests используют отдельные adapters/schema fixtures и не запускают web.

### 5. Миграция D1 выполняется одноразовым проверяемым import

Для существующего локального состояния создаётся exporter, читающий SQLite/D1 tables read-only, и PostgreSQL importer. Import идёт в пустую schema transaction, сохраняет IDs/revisions/UTC/checksums/encrypted OAuth envelopes, нормализует SQLite JSON и проверяет table counts, FK, unique identities и sample hashes. D1/R2 state после GREEN не удаляется автоматически: каталог переносится в timestamped read-only backup до явного удаления оператором.

Для R2-local artifacts exporter читает object bytes и сверяет checksum перед blob insert. Если production Cloudflare state когда-либо появится, тот же manifest-import требует отдельного offline export; online dual-write не вводится.

### 6. Personal OAuth является единственным Google backend

Сохраняются web OAuth client, PKCE, encrypted refresh token, account/root binding, descendant registry и reconnect/resume. Service-account code, Shared Drive flags (`supportsAllDrives`, `driveId`, corpora), JSON key templates и health checks удаляются. Config audit имеет allowlist, поэтому неизвестный legacy Google/Cloudflare параметр является ошибкой вместо молчаливого игнорирования.

### 7. Конфигурация состоит из runtime env и credential directory

Локально: `web/.runtime/runtime.env` и `web/.runtime/credentials/`. VPS: `/etc/hh-agent/runtime.env` и `/etc/hh-agent/credentials/`. Env содержит только non-secret endpoints, ports, modes, model IDs, public OAuth client ID/redirect URI, limits и paths. Credentials allowlist:

- `database-url`
- `google-oauth-client-secret`
- `google-oauth-keyring.json`
- `routerai-api-key`
- `assemblyai-api-key`
- `telegram-bot-token`
- `telegram-recipients.json`
- `internal-service-tokens.json`

Launcher запрещает credential path вне directory, symlink/reparse escape, group/world-readable VPS files и unknown credential names. Generate/rotate scripts обновляют конкретный файл атомарно и не перезаписывают существующий keyring без `--rotate`.

### 8. Benchmark manifest строит жёсткую firewall boundary

Ignored `candidate/benchmark.manifest.local.json` содержит fixture id, consent proof checksum, roles/checksums всех файлов и oracle version. Отдельный ignored approval pack хранит exact LLM-generated vacancy profile snapshot, schema/version, checksum и явное HR approval metadata без данных кандидата. Он создаётся до анализа из вручную заданного названия, MAY быть отредактирован HR и после утверждения становится immutable основанием всех quality iterations. Reference content и derived anchors никогда не участвуют в генерации/редактировании этого профиля. Preflight определяет actual MIME по magic bytes, проверяет approval/profile/oracle checksum equality до чтения pipeline inputs и помещает reference checksums в deny set. Любой input manifest, HTTP request body, Drive upload, provider request или persisted application blob с deny checksum блокирует запуск.

Только `pipeline-input` загружаются в отдельную временную папку Google Drive под operation identities. Benchmark создаёт vacancy из exact approved snapshot без повторной LLM generation и затем выполняет обычные discovery/stability/runtime/provider/report stages без benchmark shortcuts. Default run остаётся shadow для Drive reports/Telegram; отдельный effectful run не нужен для каждой quality iteration, поскольку effect semantics покрываются synthetic tests.

Offline oracle после generation локально извлекает reference sections и использует ignored structured expectation pack: approved profile checksum, expected recommendation, directions/grades и normalized critical anchors. Generated structured artifacts оцениваются детерминированно; reference PDF используется для section/topology comparison. Внешний LLM-as-judge запрещён. Evidence содержит только scores/booleans/fingerprints/category codes.

После pipeline две generated PDF копируются в owner-only ignored private evidence directory с checksum, build/run/profile fingerprints и retention deadline. Product/PostgreSQL/Drive/provider/temp state очищается безусловно сразу после GREEN/RED. Human review читает только локальные generated/reference documents; после review либо deadline отдельный cleanup удаляет generated PDF и записывает агрегированное deletion evidence. Reference files не удаляются и никогда не входят в runtime cleanup scope.

### 9. Progress является projection canonical graph

Progress не оценивается по ETA. Внутри active run milestone mapping: discovery/stability `0/5`, drive snapshot `10`, documents `25`, transcription `40`, evidence `55`, assessment `70`, validation `80`, report pair `90`, published READY `100`. Notification остаётся отдельным delivery state и не уменьшает READY. Projection выбирает максимум успешно checkpointed milestone текущей input/run version. `WAITING_FOR_HUMAN`/failure сохраняют максимум; новый run с новым input начинается заново.

UI возвращает существующий `.progress-track` из первоначального commit, добавляет native/ARIA progress semantics и переиспользуемый `CandidateProgress` в dashboard и list card. Browser принимает процент, label и milestone от API и ничего не вычисляет.

### 10. Acceptance делится на synthetic conformance и private evidence

Независимый субагент сначала создаёт synthetic RED, который не содержит PII и может коммититься. Реальный benchmark harness/evidence остаются ignored. Local canonical E2E запускает собранные Node web/worker процессы и PostgreSQL, создаёт synthetic run через application boundary и получает evidence из durable state; deterministic controlled provider разрешён только для стабильного oracle. Существующий in-memory pipeline/SQLite fixture controller остаётся hermetic conformance и не закрывает local gate. Local evidence всегда фиксирует `productionLikeAcceptanceClaimed=false`.

GREEN требует PostgreSQL schema tests, concurrent workers, storage/secret scan, rendered UI, four local PostgreSQL canonical E2E, real providers и benchmark oracle. Отдельный VPS Playwright contour повторяет четыре сценария с production-like control plane, HTTPS, real integrations, backup/restore и security audit. Локальный GREEN не закрывает VPS production-like tasks.

## Risks / Trade-offs

- [203 MB fixture и PostgreSQL bloat] → Source media остаётся Drive/temp, blobs ограничены по kind/size, autovacuum и database growth входят в preflight/metrics.
- [Nitro/Vinext Node несовместимость] → Сначала RED route/build smoke на minimal Node output; blocker фиксируется до repository rewrite, Cloudflare fallback не считается выполнением.
- [SQLite/PostgreSQL semantic drift] → Integration/E2E только PostgreSQL; SQLite покрывает лишь contract logic, dialect-specific tests обязательны отдельно.
- [Миграция encrypted OAuth envelope] → Сохранять ciphertext/AAD identities без decrypt/re-encrypt; после import выполнять decrypt probe и refresh smoke без token output.
- [Reference report содержит спорное экспертное мнение] → Hard oracle опирается на явно утверждённый local expectation pack; semantic deviations дополнительно сохраняются для human review, но не заменяют hard evidence rules.
- [Reference result создан по неизвестной версии вакансии] → Oracle принимается только вместе с явно утверждённым profile snapshot/checksum; несовпадение блокирует comparison до provider calls, а reference-derived content запрещено использовать для подгонки профиля.
- [Benchmark утечка через telemetry/log] → Deny checksums, no network judge, safe logger, evidence sentinel scan и cleanup gate.
- [Единственный VPS/DB — single point of failure] → Ежедневный encrypted backup, restore drill, systemd restart, disk/connection monitoring; HA не входит в MVP.
- [Секреты всё ещё разбросаны при upgrade] → Allowlist audit блокирует start при legacy/duplicate config; migration script перемещает только известные файлы, исходники не удаляет без подтверждения.

## Migration Plan

1. Зафиксировать independent RED для storage topology, benchmark isolation и progress UI.
2. Добавить PostgreSQL schema/migrations, pool/transaction/blob ports и dialect tests; поднять local PostgreSQL.
3. Перенести product, OAuth, runtime, notification, candidate pipeline, artifacts/traces и readiness repositories по вертикальным slices.
4. Перевести route bindings на Node dependency container и получить Node/Nitro build + route smoke.
5. Добавить D1/R2 local export/import, выполнить dry-run, count/hash/decrypt validation и оставить исходный state read-only.
6. Перевести launchers/config templates, удалить active Cloudflare/corporate Google settings и пройти secret audit.
7. Добавить progress projection/component и rendered acceptance.
8. Классифицировать private candidate fixtures, LLM-сгенерировать и явно утвердить frozen profile, привязать ignored oracle pack к profile checksum, прогнать shadow real-provider pipeline, провести human review и подтвердить обе фазы cleanup.
9. Прогнать полный local PostgreSQL regression и четыре Node/PostgreSQL canonical E2E, создать immutable build/config/fixture fingerprints.
10. Установить PostgreSQL/web/workers/nginx на VPS, restore test backup, выполнить production-like E2E/reconnect/restart; только затем включить effectful routing.

Rollback: до VPS switch сохранить предыдущий build и database backup. При failure выключить trigger/effect routing, остановить claims, откатить Node build на предыдущий совместимый image/checkout и не выполнять down migration/удаление столбцов. Cloudflare runtime не возвращается как штатный rollback; до полного перехода он может существовать только как read-only export source.
