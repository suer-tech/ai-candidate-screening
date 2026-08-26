# Аудит готовности к durable и agentic runtime

Статус: рабочий explore-черновик, не нормативная спецификация.

Дата аудита: 2026-08-20.

## 1. Область и метод

Проверены:

- 202 требования из восьми main specifications в `openspec/specs/`;
- семь active changes и их незакрытые задачи;
- production-код `web/app`, `web/server`, `web/worker`, D1 schema и runtime bindings;
- локальные unit, rendered, acceptance, transcription, LLM и E2E-harness tests;
- production-like Playwright harness и GitHub Actions workflow.

Статусы покрытия:

- `IMPLEMENTED` — поведение существует в production-коде и проверено локально;
- `PARTIAL` — реализована только часть нормативного сценария;
- `TEST_ONLY` — проверка или внешний контракт есть, production runtime отсутствует;
- `DEMO_ONLY` — значение или представление существует только в UI/локальной модели;
- `MISSING` — исполняемой реализации нет;
- `ENV_BLOCKED` — код/тест требуют непредоставленного production-like окружения;
- `SPEC_CONFLICT` — main spec и active change задают разное ожидаемое поведение;
- `NEW_SPEC` — требуемое agentic-поведение ещё не нормировано.

## 2. Ключевой вывод

Репозиторий содержит качественные отдельные границы, но не содержит исполняемого candidate-processing runtime от Drive discovery до Telegram. Локальный `npm test` полностью проходит, однако он подтверждает только существующие фрагменты. Четыре обязательных production E2E существуют как Playwright-контракт, но не запускались на полном provisioned окружении и не могут пройти без отсутствующих workflow, Drive scanner, RouterAI/OCR/assessment, PDF publication, Telegram и external E2E control plane.

Текущая экранная очередь — вычисляемое dashboard-представление. Persistent task queue, workflow events, attempts, leases, provider-job checkpoints и outbox в D1 schema отсутствуют.

## 3. Конфликт источника требований, который нужно разрешить первым

`revise-vacancy-creation-flow` реализован в коде и локально принят как ручное создание вакансии без LLM, preview и activation lifecycle. Его delta:

- удаляет `VAC-021`, `VAC-031`–`VAC-033`, `VAC-037`–`VAC-039`;
- изменяет `VAC-014`, `VAC-015`, `VAC-019`, `VAC-020`, `VAC-030`, `VAC-034`;
- добавляет `VAC-040`, `VAC-041`, `INT-040`, `TST-086`–`TST-088`.

Main `vacancy-profile/spec.md` пока продолжает требовать LLM-генерацию, preview и явное утверждение профиля. До sync/archive active change код и main specs имеют `SPEC_CONFLICT`. Новые proposals нельзя строить на невыбранном контракте вакансии.

Решение Google Drive уже согласовано в main specs; Яндекс Диск не входит в целевой runtime.

## 4. Матрица покрытия main capabilities

### 4.1 Product scope — 10 требований

| Требования | Статус | Фактическое покрытие | Основной пробел |
|---|---|---|---|
| PRD-002, PRD-010 | `PARTIAL` | API требует authenticated user header; UI использует recommendation, но не кадровое решение | Нет полного runtime и формальной HR-role policy во всех будущих сервисах |
| PRD-011 | `PARTIAL` | Есть редактор и создание вакансии | Не вся полная структура профиля сохраняется серверно |
| PRD-021 | `PARTIAL` | Часть post-MVP demo controls удалена | Граница зависит от несинхронизированных active changes |
| PRD-032 | `PARTIAL` | Канонические статусы и ошибки показываются в UI | Статусы не управляются автоматическим workflow |
| PRD-001, PRD-003, PRD-020, PRD-030, PRD-031 | `MISSING` | Нет автоматического сквозного анализа и фактических duration metrics | Нужен весь processing runtime |

### 4.2 Vacancy profile — 25 требований

| Требования | Статус | Фактическое покрытие | Основной пробел |
|---|---|---|---|
| VAC-015–VAC-017 | `PARTIAL` | Клиентский ABC editor и чистый validator реализованы и протестированы | Серверная версия профиля упрощена, нет полного version lifecycle |
| VAC-030, VAC-034 | `PARTIAL` / `SPEC_CONFLICT` | Ручной двухшаговый UI, D1 reservation, idempotent Drive folder provisioning и active v1 vacancy | Main spec всё ещё требует LLM generation/preview/approval |
| VAC-001, VAC-002, VAC-010, VAC-014, VAC-018–VAC-020, VAC-035 | `PARTIAL` | Есть базовые типы, UI и `recordJson` persistence | Нет нормализованной полной схемы, immutable profile versions, activation и server audit |
| VAC-011–VAC-013, VAC-021–VAC-022, VAC-031–VAC-033, VAC-036–VAC-038 | `MISSING` либо `SPEC_CONFLICT` | Полного server flow нет | Сначала выбрать active delta или текущий main contract |
| VAC-039 | `TBD` / candidate for removal | Модель и endpoint не выбраны | Active change удаляет LLM generation целиком |

### 4.3 Candidate workflow — 19 требований

| Требования | Статус | Фактическое покрытие | Основной пробел |
|---|---|---|---|
| WF-020 | `PARTIAL` | Девять status names, UI guards и lifecycle controls существуют | Нет event-driven state transitions и transition audit |
| WF-031, WF-032 | `PARTIAL` | Есть manual reprocess helpers, dashboard list и result version types | Новый run не создаётся/исполняется серверным worker; очередь не executable |
| WF-001–WF-018 | `MISSING` | Drive UI проверяет только health | Нет discovery, snapshots, stability counter, material roles, input versions и auto-start |
| WF-021–WF-023, WF-030 | `MISSING` / small helpers only | Есть optimistic revision и `selectReusableStages` helper | Нет attempts, checkpoints, retries, transition history и orchestration |

Active `WF-033`–`WF-035` имеют локально зелёные acceptance tests, но остаются `PARTIAL`, пока manual reprocess не запускает реальный durable run.

### 4.4 Assessment and evidence — 34 требования

| Требования | Статус | Фактическое покрытие | Основной пробел |
|---|---|---|---|
| ASM-001, ASM-003, ASM-005, ASM-007, ASM-008 | `PARTIAL` | ABC directions и A/B/C descriptions присутствуют в UI | Нет зафиксированного полного server profile contract |
| ASM-004, ASM-010–ASM-024, ASM-030–ASM-034, ASM-040–ASM-054 | `MISSING` | Есть только prompt artifact и recommendation enum | Нет extraction, evidence graph, conflict engine, stop-factor logic, competence/result assessment и formula implementation |
| ASM-060, ASM-061 | `DEMO_ONLY` / `MISSING` | UI содержит comparison presentation | Нет server comparability guard и evidence-backed comparison runtime |

### 4.5 Reporting and notifications — 14 требований

| Требования | Статус | Фактическое покрытие | Основной пробел |
|---|---|---|---|
| REP-004, REP-005, REP-008, REP-009 | `PARTIAL` | D1 хранит descriptors; `publishResultPair` требует два типа одной версии; preview проверяет PDF magic bytes | Нет PDF generator, checksums, required-section validation, immutable Drive publication и version conflict handling |
| REP-001–REP-003, REP-006, REP-007 | `MISSING` | UI показывает краткий summary | Нет нормативного содержимого двух PDF и source locators |
| REP-010–REP-014 | `MISSING` | Telegram connector/outbox отсутствует | Нужны logical events, per-recipient delivery state, retry и safe templates |

Active `REP-015`, `REP-016`, `TST-077`, `TST-078` локально реализованы для preview/export, но зависят от ещё отсутствующей реальной публикации PDF.

### 4.6 Integrations and operations — 28 требований

| Требования | Статус | Фактическое покрытие | Основной пробел |
|---|---|---|---|
| INT-001–INT-009 | `MISSING` | Есть health probe, vacancy-folder adapter и read-result-PDF adapter | Нет official Drive scanner/download/version/snapshot implementation |
| INT-013, INT-015–INT-017 | `IMPLEMENTED` локально | FFmpeg extraction, AssemblyAI EU `universal-2`, diarization params, raw/normalized/TXT artifacts | Не подключено к candidate workflow и Drive |
| INT-010–INT-012, INT-014, INT-018, INT-019 | `PARTIAL` | Хранятся raw speaker labels/words/confidence; временный audio удаляется | Нет role mapping, low-confidence aggregation, media probe contract, durable remote-cleanup status |
| INT-020–INT-022 | `PARTIAL` | Есть logical LLM config, prompt/schema registry, attempt gateway, protected R2 traces | Нет real RouterAI adapter, OCR, assessment, schema validator/migrators и repair workflow |
| OPS-001–OPS-005 | `MISSING` / `PARTIAL` | UI может показать elapsed/ETA fields; config хранит отдельные LLM timeouts/retry policy | Нет run-level metrics, actual retry controller, monotonic duration ledger, operational notifications |
| OPS-006 | `PARTIAL` | FFmpeg/AssemblyAI находятся в Node module вне Worker request lifecycle | Нет постоянно работающего background service и dispatch boundary |

### 4.7 Data and security — 10 требований

| Требования | Статус | Фактическое покрытие | Основной пробел |
|---|---|---|---|
| SEC-002, SEC-003, SEC-006 | `PARTIAL` | API auth headers, runtime secrets, protected trace isolation и metadata-only incidents реализованы | Не проверена end-to-end роль и secret boundary будущих workers/connectors |
| SEC-005 | `PARTIAL` | Lifecycle/export audit существует | Нет workflow transitions, material changes, profile-version and analysis-run audit |
| SEC-007 | `PARTIAL` | Archive/delete guards, candidate row deletion и tombstone table есть | Tombstone хранит internal numeric ID, а не Drive Folder ID; нет cascade OCR/transcripts/AI/PDF/temp/provider cleanup |
| SEC-001, SEC-004, SEC-008–SEC-010 | `TEST_ONLY` / `ENV_BLOCKED` | Контракты заданы, preflight проверяет окружение | Нужны real providers, Shared Drive service account и deployment evidence |

Active `add-protected-llm-tracing` локально реализован наиболее полно, но его final production E2E ещё заблокирован.

### 4.8 Quality gates — 62 требования

| Требования | Статус | Фактическое покрытие | Основной пробел |
|---|---|---|---|
| Локальные acceptance TST-077–TST-103 | `IMPLEMENTED` для своих changes | `npm test` проходит полностью | Не заменяет mandatory production acceptance |
| TST-010–TST-076 | `TEST_ONLY` / `ENV_BLOCKED` | `required.spec.mjs`, preflight, control-client и GitHub Actions workflow существуют | Нет deployed candidate runtime, external control plane, real Drive/RouterAI/AssemblyAI/Telegram fixtures и cleanup |
| TST-001–TST-007, TST-080–TST-085 | `PARTIAL` | В changes есть independent acceptance evidence и RED/GREEN discipline для отдельных функций | Полный набор не имеет PASSED evidence на одной сборке |

## 5. Состояние active changes

| Change | Локальный код/тесты | Незакрытая причина | Действие |
|---|---|---|---|
| revise-vacancy-creation-flow | GREEN | Полный mandatory E2E; конфликт с main vacancy spec | Сначала принять решение и sync delta |
| validate-vacancy-abc-profile | GREEN | Полный mandatory E2E | Не архивировать до production evidence |
| add-candidate-lifecycle-controls | GREEN | Полный mandatory E2E | Оставить active; runtime должен реализовать реальные runs |
| add-in-app-report-preview | GREEN | E2E-RESULT и полный набор | Оставить active до реальной публикации PDF |
| add-operational-dashboard | GREEN | Provisioned production-like E2E | Оставить active до появления реальных metrics/workflow data |
| add-protected-llm-tracing | GREEN | Full E2E with trace assertions | Использовать как основу нового runtime |
| persist-theme-preference | GREEN | Mandatory production E2E | Функционально независимо, но формально не завершено |

## 6. Implementation backlog, уже покрытый main specs

Эти задачи не требуют нового продуктового поведения, но требуют implementation change/design/tasks и независимой RED-приёмки:

1. Server-side Google Drive discovery и material registry.
2. Folder/File identity, input snapshots, stability counter и idempotent detection.
3. Persistent CandidateRun, workflow transitions и transition audit.
4. Executable durable tasks, attempts, retries/backoff и stage reuse.
5. Drive download и document extraction для PDF/DOCX.
6. Per-page OCR RouterAI и OCR confidence/locators.
7. Durable FFmpeg + AssemblyAI dispatch, provider job identity и resume polling.
8. Low-confidence aggregation и speaker-role mapping.
9. RouterAI adapter для assessment и validation/repair.
10. Versioned structured analysis schema, validators и deterministic recommendation formula.
11. Evidence graph с документными и transcript locators.
12. Два PDF, content verification, checksums и immutable Drive publication.
13. Telegram outbox, per-recipient attempts и idempotency.
14. Stage/run metrics, SLA observation и ETA history.
15. Cascade deletion across app data, derived artifacts, providers и tombstone by Drive Folder ID.
16. External E2E control plane, synthetic fixtures, real smoke and full cleanup.

## 7. Новые spec gaps для durable runtime

Следующие решения нельзя оставлять только деталями реализации:

1. Persistent event/task/attempt/checkpoint model и recovery после process restart.
2. Provider-job checkpoint immediately after remote job creation.
3. Lease, heartbeat, stale-task recovery и duplicate-worker semantics.
4. Run-level budget ledger: wall time, attempts, LLM calls, tokens/cost, external requests.
5. Tool grants с candidate/run/input-version scope, TTL и side-effect class.
6. Staged external side effects и compensation policy.
7. Explicit escalation record, human action state и resume trigger.
8. Поведение при готовых материалах и неготовом/неактивном профиле вакансии.
9. Partial publication recovery: один PDF существует, второй отсутствует.
10. Durable Telegram delivery after candidate is already `READY`.

## 8. Новые spec gaps для adaptive agent behavior

1. Goal graph и versioned plan для bounded candidate-analysis goal.
2. Material-role classification и политика двух резюме/двух интервью.
3. Detection плохого, но формально существующего PDF text layer и selective OCR fallback.
4. Detection аномально пустой transcript и policy проверки альтернативной audio stream; это изменяет текущий INT-015 first-stream contract.
5. Local repair одного отсутствующего evidence locator без полного повторного анализа.
6. Decomposition/replanning при превышении context/output limits.
7. Проверяемое объединение результатов нескольких bounded assessment tasks.
8. Repair budget и запрет бесконечных model loops.
9. Escalation payload: obstacle, completed attempts, evidence, impact и concrete human action.
10. Memory boundaries: run working memory, immutable artifact memory, event history; запрет cross-candidate semantic memory по умолчанию.

## 9. Рекомендуемые OpenSpec changes

### Сначала: разрешить vacancy contract

Завершить review `revise-vacancy-creation-flow` и либо синхронизировать его delta в main specs, либо отклонить/переработать. До этого неизвестно, должен ли runtime ожидать LLM-generated approved profile или сразу использовать manually saved active v1.

### Change A: `add-durable-candidate-runtime`

Scope:

- events/tasks/attempts/checkpoints;
- leases/heartbeat/recovery;
- budgets/tool grants;
- provider-job resume;
- outbox/compensation/escalation records;
- background Node worker boundary;
- runtime acceptance scenarios.

### Change B: `implement-canonical-candidate-pipeline`

Implementation-focused change по уже согласованным main requirements:

- Drive → extraction/OCR → STT → assessment → validation → PDF → Telegram;
- без добавления новых кадровых правил;
- на durable runtime из Change A.

### Change C: `add-adaptive-candidate-recovery`

Scope:

- obstacle detectors;
- material ambiguity;
- selective OCR/audio fallback;
- local LLM repair;
- decomposition/replanning;
- structured human escalation;
- agent-specific acceptance and safety gates.

## 10. Рекомендуемый порядок реализации

1. Разрешить и синхронизировать vacancy creation contract.
2. Независимому субагенту создать RED acceptance для durable runtime.
3. Реализовать persistent spine `event → run → task → attempt → checkpoint`.
4. Реализовать Drive discovery/stability/input versions.
5. Подключить document/OCR и durable transcription.
6. Подключить assessment/evidence/validation.
7. Подключить PDF publication и Telegram outbox.
8. Довести четыре canonical E2E до GREEN.
9. Добавить adaptive recovery по отдельному RED-набору.
10. Выполнить полный regression и закрыть зависимые active changes.

## 11. Проверки, выполненные в ходе аудита

- `npm test` — GREEN полностью;
- build, rendered routes, local acceptance, theme, ABC, product, server product, UI, transcription, LLM и E2E-harness configuration tests — GREEN;
- mandatory production-like `npm run e2e:required` не запускался без provisioned staging/preproduction и external control plane;
- application source не содержит Drive scanner, Telegram connector, real RouterAI adapter, OCR/assessment engine, PDF generator или background queue consumer;
- D1 schema содержит только vacancies, vacancy operations, candidates, result document descriptors, audit events и candidate tombstones.
