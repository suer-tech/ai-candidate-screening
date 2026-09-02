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
- [x] 13.5 Выполнить связанный acceptance/regression контур и обновить архитектурное описание фактического workflow.

## 14. Coverage-first HR assessment revision

- [x] 14.1 Поручить независимому acceptance-субагенту зафиксировать RED для компактной матрицы без over-splitting/invented requirements, допустимого candidate/resume self-report и непустых strengths/competencies из положительных строк.
- [x] 14.2 Добавить RED для transcript/document batch coverage ledger: exact requested/returned criterion IDs, `FOUND|NOT_FOUND_IN_BATCH`, overlap dedupe, targeted missing-ID retry и один gap-search по нулевым критериям.
- [x] 14.3 Упростить compiler и fail-soft critic-editor prompts/contracts до coverage/fidelity/over-splitting/stop-factor-origin; при недоступном критике публиковать технически пригодный compiler draft с warning.
- [x] 14.4 Обновить claim extraction schema/prompt: batch не принимает решение, возвращает coverage entry по каждому ID и evidence relations `SUPPORTS|CONTRADICTS|CONTEXT`; self-report допустим как HR-сведение.
- [x] 14.5 Реализовать deterministic extraction coverage harness, targeted retry, global aggregation/dedup и bounded gap-search без блокировки кандидата.
- [x] 14.6 Заменить risk-only open pass сбалансированными `STRENGTH|CONCERN|QUESTION` observations и убрать обязательный assess/verify-critical-risk cascade из новых runs.
- [x] 14.7 Обновить conflict prompt/aggregation: прямые несовместимые утверждения сохраняются, а дополнение, детализация, разные периоды, omission и явная коррекция не считаются конфликтом автоматически.
- [x] 14.8 Перевести row evaluator на ровно три состояния `Соответствует|Не соответствует|Недостаточно данных`, exact evaluation coverage, targeted retry и технический fail-soft fallback для отсутствующей строки.
- [x] 14.9 Ограничить semantic verifier сработавшими стоп-факторами и существенно отказными выводами, передавать точные цитаты и сохранять исходную строку при omitted/timeout/schema failure.
- [x] 14.10 Заменить deterministic required/critical-unmapped-risk formula на versioned holistic recommendation synthesis с единственным deterministic stop-factor override.
- [x] 14.11 Исправить assessment/report projection: положительные строки заполняют strengths, competencies, confirmed results, ABC/access sections; отрицательные — limitations/risks; неизвестные — questions; balanced observations отображаются симметрично.
- [x] 14.12 Добавить operational coverage counters/warnings и подтвердить, что auxiliary critic/open/gap/conflict/verifier failure не препятствует созданию структурированного результата и PDF.
- [ ] 14.13 Провести focused GREEN, связанный regression, PostgreSQL integration и обязательные `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` на одном immutable build/config/fixture identity.
- [x] 14.14 Обновить `docs/ARCHITECTURE.md`, `docs/index.json`, выполнить `openspec validate --strict` и `git diff --check`.

## 15. Version-safe selective recovery

- [x] 15.1 Поручить независимому acceptance-субагенту зафиксировать RED: `matrix-v2` не переиспользуется в `matrix-v3`, старая матрица той же profileVersion не блокирует compact compilation, missing/wrong-schema artifact обрывает reusable prefix.
- [x] 15.2 Ввести `matrix-v3` workflow identity и forward-only storage migration для immutable shared matrices по `(profileVersion, workflowIdentity)` с чтением прежних `matrix-v2`.
- [x] 15.3 Ограничить manual recovery совпадением input/profile/goal/workflow/policy и валидным непрерывным artifact prefix; начинать с первой failed/отсутствующей/несовместимой стадии.
- [x] 15.4 Выполнить focused acceptance/build/regression, обновить архитектурную документацию и проверить OpenSpec strict/diff-check.

## 16. Evidence-complete HR presentation

- [x] 16.1 Поручить независимому acceptance-субагенту зафиксировать RED для evidence каждой положительной/отрицательной строки, запрета invented sourceRef/quote, разрешения отдельного claims artifact, HR-safe веб/PDF и состояния ненастроенного ABC.
- [x] 16.2 Расширить versioned row-evaluation prompt/schema полями conclusion и evidence (`claimId`, `sourceRef`, `quote`, `relation`, `explanation`) и добавить точечную проверку против объединённого claim graph.
- [x] 16.3 Реализовать единый HR presentation adapter: человекочитаемые источники, полные строки матрицы и evidence без технических IDs, URI и сообщений critic/verifier; использовать его в веб и PDF.
- [x] 16.4 Исправить dashboard projection: разрешать `claimsRef`, отображать все criterion rows и формировать strengths/competencies/risks/recommendation basis только из evidence-backed выводов.
- [x] 16.5 Отделить ABC directions от matrix criteria, не вызывать ABC при незаполненных A/B/C и показывать состояние «ABC-профиль не настроен для вакансии».
- [x] 16.6 Выполнить focused acceptance/regression, проверить текущий HR-интерфейс на реальном сохранённом результате без изменения исходных artifacts, обновить docs и пересобрать сервис.

## 17. Unified grounded candidate report

- [x] 17.1 Поручить независимому acceptance-субагенту зафиксировать RED для единственного `candidate-report`, полного набора HR-разделов, неизменности recommendation/ABC/row states, evidence references, отсутствия дублей, fail-soft fallback и ровно одной публикации.
- [x] 17.2 Зарегистрировать versioned `compose-candidate-report/v1` instruction/schema/capability с компактным validated input и без raw resume/transcript или tools.
- [x] 17.3 Реализовать validation composer output и deterministic fallback, который всегда создаёт единый grounded report model без изменения кадровых решений.
- [x] 17.4 Добавить `candidate-report` model и singular document-processor endpoint, сохранив legacy pair read/render compatibility только для старых runs.
- [x] 17.5 Перевести production reports checkpoint, immutable storage, Drive/outbox/Telegram и dashboard projection на один публикуемый файл.
- [x] 17.6 Выполнить focused acceptance/regression, визуальную PDF-проверку, обновить architecture/index/operator docs и пересобрать сервис.

## 18. Compact sample-aligned HR report

- [x] 18.1 Поручить независимому acceptance-субагенту зафиксировать RED для одиннадцати HR-разделов в порядке образца, отсутствия отдельных matrix/criteria/stop-factor/question секций и единственного расположения recommendation в решении.
- [x] 18.2 Зарегистрировать `compose-candidate-report/v2` instruction/schema с ревью, ключевыми доказательствами, группированным техническим чеком, мотивацией/соответствием, рисками, решением и недублирующим финальным HR-резюме.
- [x] 18.3 Перевести `candidate-report` model и production projection на компактные разделы, сохранив полную матрицу только в web/audit artifacts и legacy read compatibility.
- [x] 18.4 Убрать верхний recommendation callout и карточную перегрузку для `candidate-report`, сохранив последовательный одноколоночный HR-формат и человекочитаемые evidence references.
- [x] 18.5 Выполнить focused acceptance/regression и визуальную PDF-проверку на synthetic evidence без provider/Drive/Telegram effects.
- [x] 18.6 Обновить architecture/index, выполнить OpenSpec strict/diff-check, пересобрать контейнеры и проверить startup logs.

## 19. Clickable source-material links

- [x] 19.1 Поручить независимому acceptance-субагенту зафиксировать RED: immutable manifest проектируется в HR-safe список, PDF содержит кликабельную `/Link` annotation на каждый разрешённый Drive/Docs resource, unsafe URL отбрасывается.
- [x] 19.2 Добавить в `candidate-report` model отдельную HR-safe проекцию исходных материалов из immutable input manifest без results/unsupported файлов и технических IDs в видимом тексте.
- [x] 19.3 Реализовать в PDF renderer видимые имена материалов и URI link annotations только для allowlisted Google Drive/Docs HTTPS targets; пройти fail-soft обычным текстом без invented URL.
- [x] 19.4 Выполнить independent focused GREEN, report regression, PDF structural/visual QA, обновить architecture/index, OpenSpec strict/diff-check и пересобрать сервис.

## 20. Balanced web decision summary without a new LLM call

- [x] 20.1 Поручить независимому acceptance-субагенту зафиксировать RED: HR-резюме использует только существующую projection, показывает положительную и отрицательную стороны, не меняет recommendation и не повторяет recommendation reason.
- [x] 20.2 Реализовать детерминированную сборку сбалансированного `Резюме для принятия решения` без изменений LLM prompts/schemas/runtime calls и без нового provider-вызова.
- [x] 20.3 Выполнить focused acceptance и связанную UI/projection regression; подтвердить сохранение существующего `Итог AI` для отрицательной и положительной рекомендации.
- [x] 20.4 Обновить architecture/index при изменении публичной projection boundary, выполнить OpenSpec strict, build и diff-check.

## 21. Cleanup-aware matrix immutability

- [x] 21.1 Поручить независимому acceptance-субагенту зафиксировать PostgreSQL RED: прямой UPDATE/DELETE и чужой cleanup scope запрещены, а штатное удаление архивного кандидата должно каскадно удалять candidate-scoped matrix history.
- [x] 21.2 Добавить forward-only migration, переводящую immutable triggers `candidate_source_claims`, `candidate_evidence_conflicts`, `candidate_matrix_rows` на cleanup-aware guard без ослабления `vacancy_matrices`.
- [x] 21.3 Выполнить migration/PostgreSQL integration и независимый GREEN, проверить lifecycle API/repository boundary на synthetic candidate без внешних эффектов.
- [x] 21.4 Обновить architecture/index, выполнить OpenSpec strict, build/diff-check, пересобрать контейнеры и проверить health/logs.

## 22. Ready text transcript input

- [x] 22.1 Поручить независимому acceptance-субагенту зафиксировать RED: резюме + одна готовая текстовая стенограмма образуют полный комплект, создают обычный transcript-bundle и не вызывают media processor/AssemblyAI.
- [x] 22.2 Добавить явный тип источника интервью в immutable material manifest и поддержку текстовых форматов стенограммы без ошибочной классификации как резюме/дополнительного файла.
- [x] 22.3 Реализовать детерминированный разбор готового текста с сохранением исходных speaker labels, явных таймкодов либо line locators и production bypass FFmpeg/AssemblyAI.
- [x] 22.4 Подтвердить downstream/recovery совместимость, типизированные ошибки пустого текста, focused acceptance/regression/build, обновить architecture/index и OpenSpec strict/diff-check.

## 23. Immutable run input boundary

- [x] 23.1 Поручить независимому acceptance-субагенту зафиксировать RED для race: новый Drive-файл после создания run не попадает в текущий snapshot и не роняет текущий run.
- [x] 23.2 Перевести production drive-snapshot task на чтение pinned `candidate_input_versions.manifest_json` без повторного live-list при существующей inputVersion.
- [x] 23.3 Подтвердить, что downstream использует только pinned IDs/versions, а discovery создаёт следующую input version для новых файлов; выполнить focused regression/build/strict/diff-check и пересобрать сервис.

## 24. Fresh manifest for every manual reprocess

- [x] 24.1 Поручить независимому acceptance-субагенту зафиксировать RED: reprocess ждёт свежий стабильный live snapshot, видит добавленный или version-changed файл и сохраняет reuse failed predecessor только при полном совпадении manifest.
- [x] 24.2 Усилить fingerprint и matching immutable входов provider version и полным material identity; исключить совпадение только по `fileId + size`.
- [x] 24.3 Исправить manual discovery orchestration: каждый revision reprocess подтверждается свежим post-command live observation, новая готовая версия создаёт ровно один goal/run, неизменная версия остаётся совместимой с selective recovery.
- [x] 24.4 Выполнить focused acceptance/regression/build/OpenSpec strict/diff-check, обновить architecture/index и пересобрать сервис.

## 25. Несколько интервью и стенограмм

- [x] 25.1 Изменить material completeness: резюме и один или несколько поддерживаемых interview-source являются полным комплектом; `MULTIPLE_INTERVIEWS` больше не блокирует запуск.
- [x] 25.2 Реализовать обработку всех recording/ready-transcript entries в одной transcription stage с отдельными provider checkpoints и единым совместимым transcript-bundle.
- [x] 25.3 Сохранить source file identity в каждой реплике и передавать её через token batching, чтобы claims/evidence разных интервью не смешивались.
- [x] 25.4 Выполнить focused regression/build/OpenSpec strict/diff-check и обновить архитектурную документацию.
