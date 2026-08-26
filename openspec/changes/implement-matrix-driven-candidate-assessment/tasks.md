## 1. Independent RED acceptance contour

- [x] 1.1 Поручить независимому субагенту, не участвующему в production-реализации, создать synthetic acceptance harness и fixtures для TST-120–TST-122.
- [x] 1.2 Добавить ожидаемо падающие тесты lazy shared compilation, конкурентного claim, lease recovery, единственного publish checksum и immutable reuse по `profileVersion`.
- [x] 1.3 Добавить ожидаемо падающие тесты compiler/critic isolation, sourceRef gates, best-effort qualitative interpretation, запрета invented thresholds/stop factors и bounded obstacle fingerprint loop.
- [x] 1.4 Добавить ожидаемо падающие тесты claims vs facts, полного context retrieval, speaker attribution, global cross-batch conflicts и unmapped informational signals.
- [x] 1.5 Добавить ожидаемо падающие тесты полного покрытия matrix rows, ABC sufficiency, critical verification, `hardRequired` и deterministic recommendation priority.
- [x] 1.6 Добавить ожидаемо падающие security-тесты prompt injection, sensitive decision-context exclusion и cross-candidate evidence isolation.
- [x] 1.7 Добавить ожидаемо падающие rollout/reporting-тесты shadow side-effect suppression, fixed workflowVersion, legacy immutability и двухфайлового отчётного контракта.
- [x] 1.8 Запустить RED-набор до production-изменений и сохранить машинный, читаемый и timeline evidence с объяснением ожидаемых failures.

## 2. Profile and matrix contracts

- [x] 2.1 Удалить отдельное редактирование `requirements`/`hardRequired` из vacancy UI/API write contract, сохранив совместимое чтение прежних profile versions.
- [x] 2.2 Добавить versioned matrix draft, critic violation, published matrix, candidate claim, conflict, row и verification schemas с неизвестной-major fail-closed политикой.
- [x] 2.3 Реализовать canonical matrix validation: enum/ID/tree invariants, exact sourceRef resolution, сохранение profile order, stable runtime IDs и deterministic checksum.
- [x] 2.4 Добавить unit/property tests schema migrations, canonicalization, sourceRef rejection, order preservation и запрета второго matrix artifact для одной `profileVersion`.

## 3. PostgreSQL persistence and shared compilation

- [x] 3.1 Добавить forward-only PostgreSQL migration для compilation attempts, vacancy matrices, source claims, evidence conflicts и candidate matrix rows с необходимыми immutable/unique constraints.
- [x] 3.2 Реализовать repositories для atomic compilation claim, lease/fencing recovery, waiter dependency, terminal shared error и idempotent matrix publish.
- [x] 3.3 Реализовать immutable repositories и candidate/run/input/profile scopes для matrix, claims, conflicts, rows и protected provenance refs.
- [x] 3.4 Добавить PostgreSQL integration tests concurrent claims, stale-owner publish denial, retry before publish, immutable published matrix и cross-candidate isolation.

## 4. Versioned LLM skills and protected gateway

- [x] 4.1 Зарегистрировать instruction/response artifacts и capability configurations `compile-vacancy-matrix/v1`, `critique-vacancy-matrix/v1`, `repair-vacancy-matrix/v1`.
- [x] 4.2 Зарегистрировать artifacts `extract-claims-for-criteria/v1`, `discover-unmapped-signals/v1`, `consolidate-evidence/v1` и `detect-global-conflicts/v1`.
- [x] 4.3 Зарегистрировать artifacts `fill-matrix-rows/v1`, `assess-abc-direction/v1`, `verify-critical-row/v1` и `repair-invalid-rows/v1`.
- [x] 4.4 Добавить runtime configuration validation отдельных compiler/critic routes, 10-minute call ceiling, schema versions, token/cost limits и безопасной same-model provenance отметки.
- [x] 4.5 Добавить prompt-contract tests чистого critic context, отсутствия compiler reasoning, untrusted candidate-data envelope, tool allowlist и protected traces без секретов.

## 5. Lazy matrix compilation DAG

- [x] 5.1 Добавить registered matrix tools для profile read/source read, draft submit, schema/source validation, critic result, repair policy, interpretation notes и immutable persist.
- [x] 5.2 Реализовать deterministic task template `claim → compile → validate → critique → bounded repair/re-critique → canonicalize → publish` поверх существующего durable runtime.
- [x] 5.3 Реализовать budgets: максимум два repair-цикла, шесть LLM-вызовов, один повтор одинакового obstacle fingerprint без checksum change и terminal safe error без partial publish.
- [x] 5.4 Подключить first-candidate dependency к shared compilation и переиспользование published checksum всеми subsequent runs той же `profileVersion`.
- [x] 5.5 Добавить controlled-provider tests PASS, REPAIR_REQUIRED→PASS, repeated obstacle, provider unavailable, invalid sourceRef и concurrent waiter continuation.

## 6. Decision-safe material and claims pipeline

- [x] 6.1 Реализовать decision-safe material projection с masking запрещённых чувствительных признаков и сохранением scoped raw locator identity для аудита.
- [x] 6.2 Переработать transcript/document windows так, чтобы вопрос, ответ, соседние реплики и перекрывающийся полный контекст оставались доступными без 240-символьной обрезки decision evidence.
- [x] 6.3 Реализовать speaker-role gate: unknown/low-confidence роль не может быть единственным decision-driving основанием, а вопрос интервьюера не атрибутируется кандидату.
- [x] 6.4 Реализовать criterion-directed claim extraction и open informational pass с автором, ролью, directness, source class, locator, criterion links и provenance.
- [x] 6.5 Добавить tests sensitive masking, prompt injection, full-context retrieval, question/answer adjacency, source-claim semantics и запрета dynamic stop/hard-required creation.

## 7. Global evidence graph

- [x] 7.1 Реализовать консолидацию claims без потери различия повторного самоописания и независимого подтверждения.
- [x] 7.2 Реализовать глобальный конфликтный проход по всем пакетам и материалам с сохранением обеих сторон, confidence semantics и follow-up question.
- [x] 7.3 Зарегистрировать read-only search/context tools и bounded claim/conflict submit tools с grants, schemas, checkpoints и scope validation.
- [x] 7.4 Добавить tests cross-batch/cross-material conflicts, low-confidence caveat, duplicate self-description и invalid locator/claim rejection.

## 8. Matrix row evaluation and recommendation

- [x] 8.1 Реализовать grouped row evaluation с обязательной отдельной записью для каждого `criterionId` и точечным repair отсутствующих/невалидных строк.
- [x] 8.2 Реализовать вложенную ABC-матрицу, где допустимый фрагмент необходим, но состояние A/B/C требует покрытия всех определяющих условий уровня.
- [x] 8.3 Реализовать независимую проверку всех stop factors, `hardRequired`, required, conflicts и строк, способных изменить предварительную рекомендацию.
- [x] 8.4 Расширить deterministic formula: срабатывание stop/`hardRequired`, доказанный required mismatch или independently verified `criticalUnmappedRisk` → отказ; обязательная неопределённость/conflict → недостаточность; некритичный risk/limitation/partial → оговорки; ABC и непроверенный unmapped signal не влияют автоматически.
- [x] 8.5 Сохранить immutable assessment snapshot с matrix/workflow/skill/model/schema/policy versions, formula inputs, verification refs и successful provenance chain.
- [x] 8.6 Добавить unit/acceptance tests coverage gate, evidence sufficiency, state polarity, conflict sides, critical repair и каждой ветви formula priority.

## 9. Reports and operational projection

- [x] 9.1 Расширить report model и оба PDF проекцией всех matrix rows, interpretation notes, evidence, conflicts, missing data, questions и version provenance без третьего пользовательского файла.
- [x] 9.2 Обновить candidate detail/operational projection current stage, shared compilation wait, repair count, elapsed time, terminal matrix error и shadow comparison без раскрытия sensitive content.
- [x] 9.3 Добавить rendered/report consistency tests полного покрытия строк, неизменяемой пары PDF, source/interpretation distinction и formula agreement.

## 10. Shadow rollout and cutover

- [x] 10.1 Добавить `disabled|shadow|production` routing configuration и фиксацию `workflowVersion` при создании run.
- [x] 10.2 Подключить shadow DAG без Drive/Telegram/public result grants и сохранить отдельные matrix-driven artifacts/metrics.
- [x] 10.3 Реализовать shadow quality evaluator: 100% criterion coverage, обоснованный `required`, точное `hardRequired ↔ stop factor`, zero invented stop factors, valid decision locators, two-sided conflicts, verified critical rows/risks и deterministic formula match.
- [x] 10.4 Подтвердить, что переключение и rollback влияют только на новые runs, а legacy/active results не пересчитываются и не смешивают artifacts.
- [ ] 10.5 Включить production routing только после GREEN shadow gate и зафиксировать безопасную rollback-процедуру.

## 11. Verification and documentation

- [x] 11.1 Запустить независимый matrix-driven acceptance-набор и исправить production code без ослабления oracle до полного GREEN.
- [x] 11.2 Запустить unit/build, PostgreSQL integration и security sentinel; сохранить evidence без credential или candidate leakage.
- [ ] 11.3 Запустить полный `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` и сохранить обязательные артефакты.
- [x] 11.4 Обновить `docs/ARCHITECTURE.md`, `docs/index.json`, runtime/operator documentation и configuration examples по фактически реализованному workflow.
- [x] 11.5 Проверить `openspec validate --strict`, `git diff --check` и итоговое соответствие всех задач delta specs без автоматической синхронизации main specs.

## 12. Revised requiredness and critical unmapped risk

- [x] 12.1 Поручить независимому acceptance-субагенту добавить RED-сценарии LLM-requiredness, `hardRequired ↔ stop factor`, required mismatch rejection и independently verified critical unmapped risk.
- [x] 12.2 Обновить compiler/critic prompts, schemas и deterministic gates: LLM определяет `required`, а `hardRequired` разрешён только sourceRef раздела стоп-факторов.
- [x] 12.3 Зарегистрировать `assess-unmapped-risk/v1` и `verify-critical-risk/v1` с раздельным чистым контекстом, schemas, budgets, protected traces и запретом чувствительных признаков.
- [x] 12.4 Подключить candidate-scoped risk assessment/verification после `discover-unmapped-signals/v1`, не изменяя shared vacancy matrix и не создавая динамические стоп-факторы.
- [x] 12.5 Сохранить verified critical risk, evidence locators и provenance в immutable assessment snapshot и показать его основание в обоих отчётах.
- [x] 12.6 Обновить unit, prompt-contract, acceptance, shadow и formula tests до GREEN без ослабления oracle.
- [x] 12.7 Обновить архитектурную и operator-документацию по отсутствию отдельного requirements UI и новой отказной формуле.

## 13. Single-pass critic-editor

- [x] 13.1 Поручить независимому acceptance-субагенту зафиксировать RED-сценарий: один critic call возвращает полный corrected successor, отдельные repair/re-critique не вызываются, семантические замечания не останавливают кандидата.
- [x] 13.2 Добавить versioned critic-editor prompt/response artifact с `PASS|CORRECTED`, audit changes и полным successor draft.
- [x] 13.3 Перевести shared compilation на `compile → critic-editor → canonicalize → publish`, удалить вызовы matrix repair, повторную критику и terminal repair-budget path.
- [x] 13.4 Обновить runtime capability provisioning и provenance на новый critic-editor contract.
- [ ] 13.5 Выполнить связанный acceptance/regression контур и обновить архитектурное описание фактического workflow.
