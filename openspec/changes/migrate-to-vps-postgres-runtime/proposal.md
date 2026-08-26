## Why

Текущая реализация зависит от Cloudflare D1/R2 и Worker bindings, хотя production должен работать автономно на принадлежащем оператору Ubuntu VPS. Кроме того, проект пока не имеет защищённого воспроизводимого benchmark на согласованном реальном кандидате, а интерфейс утратил наблюдаемую полосу прогресса, присутствовавшую в исходном прототипе.

## What Changes

- **BREAKING** Удалить production-зависимость от Cloudflare Workers, D1, R2, Wrangler и Sites bindings; web/API, durable runtime, очередь, OAuth state, audit, артефакты и protected traces размещать на одном Ubuntu VPS.
- **BREAKING** Сделать PostgreSQL единственным production-хранилищем и локальным integration/E2E-хранилищем; SQLite оставить только для быстрых hermetic unit/schema tests через общий storage contract.
- Хранить app-owned structured data и ограниченные по размеру immutable blobs в PostgreSQL; Google Drive остаётся внешним входом кандидата и местом публикации двух итоговых PDF, но не control-plane database.
- Добавить миграцию существующей D1-схемы и repository contracts на PostgreSQL с транзакционными claims, `FOR UPDATE SKIP LOCKED`, fencing, idempotency, outbox, retention и backup/restore.
- Перевести vinext web/API на Node/Nitro target и добавить systemd/nginx/PostgreSQL deployment на Ubuntu VPS; локальный launcher поднимает PostgreSQL и те же Node-процессы без Cloudflare emulator.
- Добавить приватный benchmark-контур для локальной папки `candidate`: входные материалы подаются в обычный pipeline, а заранее сформированные ABC/итоговый документы никогда не попадают во вход приложения или LLM и используются только локальным offline oracle.
- Benchmark MUST использовать одну неизменяемую LLM-сгенерированную и явно утверждённую HR версию профиля вакансии; oracle pack привязывается к её checksum, а reference-derived content запрещено использовать для генерации профиля или передавать provider/runtime.
- Benchmark сравнивает структуру, обязательные факты с evidence, рекомендацию, ABC-классы, риски/противоречия и PDF-разделы по версионируемым порогам; критическое расхождение блокирует release и требует исправления с повторным прогоном.
- Четыре обязательных local canonical E2E должны исполняться через собранные Node web/worker процессы и PostgreSQL на одном build/config/fixture identity; in-memory pipeline либо SQLite fixture controller остаётся только hermetic conformance и не закрывает local gate.
- Упростить конфигурацию до одного non-secret runtime env и одного каталога secret files; удалить service-account/Shared Drive/Cloudflare параметры, несовместимые с согласованным personal Google Drive OAuth.
- Вернуть server-derived progress percentage и полосу прогресса в каждой карточке активного кандидата на dashboard и в общем списке; terminal состояния показывают 100%, ожидание человека/ошибка — последний доказанный этап без фиктивного роста.

## Capabilities

### New Capabilities

- `vps-postgres-runtime`: PostgreSQL storage contract, Node/VPS deployment, migration, backup/restore и отсутствие Cloudflare runtime dependency.
- `private-candidate-benchmark`: защищённая классификация benchmark fixtures, offline oracle, пороги расхождений, evidence и cleanup для согласованного реального кандидата.

### Modified Capabilities

- `candidate-workflow`: серверная модель фактического прогресса и одинаковая полоса прогресса во всех карточках активного кандидата.
- `integrations-and-operations`: Node/PostgreSQL execution topology вместо Cloudflare Worker/D1/R2, локальный/VPS rollout и personal My Drive OAuth без Shared Drive/service account.
- `data-and-security`: PostgreSQL/blob retention, локальная обработка benchmark-эталонов, единая модель secret files, backup security и удаление устаревших corporate Google credentials.
- `quality-gates`: обязательный PostgreSQL contour, приватный real-candidate benchmark, пороги критического расхождения и production-like VPS evidence.

## Impact

- Затронуты все D1 repositories, migrations и типы, R2 artifact/protected-trace adapters, runtime bindings, route handlers, readiness, local/VPS launchers, vinext/Vite target, deployment runbooks и CI/E2E.
- Появятся PostgreSQL driver/pool и PostgreSQL Drizzle schema/migrations; Cloudflare Vite plugin, Wrangler state/config и hosting bindings будут удалены из runtime path.
- Локальная разработка потребует PostgreSQL 16+ (предпочтительно Docker Compose либо установленный сервис); SQLite не будет допустимым доказательством integration/E2E parity.
- Папка `candidate` и производные benchmark evidence остаются ignored/private; публичные tests используют только обезличенный manifest и агрегированные oracle-метрики.
- Change зависит от согласованного personal Google Drive OAuth и заменяет оставшиеся main/active требования Shared Drive/service account и D1/R2.
