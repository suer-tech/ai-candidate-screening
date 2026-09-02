## Context

В `candidate-report` добавляется отдельная `sourceMaterials` проекция из immutable input manifest. Она не смешивается с evidence catalog: evidence указывает точные страницы/таймкоды, а source materials даёт HR кликабельный переход к самому файлу. Renderer создаёт PDF URI annotation только для валидной HTTPS-цели с разрешённым Google host/path; иначе имя остаётся обычным текстом. Целевой URL не включается в видимый body отчёта.

См. proposal.md. Matrix-v2 уже реализует shared compilation, token-based transcript batching, claims, conflicts, row evaluation, verification и reports, но фактический результат показывает системный перекос: положительные сведения обесцениваются без независимого источника, verification переписывает строки в `Недостаточно данных`, open pass ориентирован на риски, а report projection оставляет competencies/ABC/access пустыми. Новая ревизия сохраняет durable artifacts, batching и provenance, но возвращает матрице первоначальную роль coverage-чеклиста.

## Goals / Non-Goals

**Goals:**

- Гарантировать технически наблюдаемый обход каждого пункта матрицы на extraction и evaluation stages.
- Считать резюме и ответы кандидата нормальными HR-источниками с явной provenance.
- Назначать один итоговый статус каждому критерию только после объединения всех частей материалов.
- Сохранить полезные проверки, не позволяя им блокировать кандидата или стирать содержательный вывод из-за отсутствия внешнего подтверждения.
- Всегда формировать отчёт, явно отмечая технический fallback, если отдельную строку получить не удалось.

**Non-Goals:**

- Внешняя проверка биографии кандидата.
- Доказательство истинности каждого самоописания.
- Числовой рейтинг кандидатов.
- Свободный агентский loop или неограниченные retries.
- Ручное редактирование опубликованного машинного результата.

## Decisions

### Decision: веб-резюме решения собирается без отдельного LLM-вызова

`Резюме для принятия решения` является детерминированной HR-проекцией уже сохранённых evidence-backed strengths/competencies, risks/negative rows и unknown rows. Оно не участвует в расчёте рекомендации и не меняет результат анализа: `Итог AI` и recommendation reason читаются из validated assessment. Проекция сохраняет доступную положительную сторону даже при отрицательном результате, добавляет существенную зону внимания и исключает дословный повтор recommendation reason, который показывается отдельно под итогом.

### Decision: candidate-scoped matrix history использует cleanup-aware immutable guard

`candidate_source_claims`, `candidate_evidence_conflicts` и `candidate_matrix_rows` используют тот же transaction-local `hh.cleanup_run_ids`, что и остальная append-only история runtime. Guard разрешает только `DELETE`, только если `OLD.run_id` входит в точный scope; любые `UPDATE`, прямые удаления и удаления с чужим scope остаются запрещены. Shared `vacancy_matrices` сохраняет безусловную неизменяемость и не удаляется вместе с кандидатом.

### 0. Пользовательский PDF повторяет компактную HR-логику образца

Единый `candidate-report` является последовательным одноколоночным HR-документом, а не выгрузкой внутренних assessment artifacts. Его стабильный порядок: шапка кандидата/вакансии; исходные материалы; организационные моменты; ревью; ключевые доказательства; ABC по направлениям; технический чек; мотивация и соответствие роли; риски; решение; финальное HR-резюме.

Recommendation показывается только в разделе `Решение`, ближе к концу документа. Отдельный верхний recommendation callout для `candidate-report` не рисуется. `Критерии вакансии`, `Матрица оценки`, `Стоп-факторы`, `Вопросы для уточнения` и `Сильные стороны` не создаются как самостоятельные карточки: их релевантное содержание синтезируется в ревью, ключевые доказательства, риски и решение. Полные строки и provenance остаются в веб-представлении и audit model, поэтому компактность PDF не удаляет исходный структурированный результат.

Технический чек группируется по понятным HR-подтемам, которые реально присутствуют в evidence (например, таск-трекеры, календарь/встречи, документы/таблицы, AI-инструменты, формат работы), без пустых шаблонных подразделов. Финальное HR-резюме обязательно и не повторяет дословно предложения из ревью или решения.

### 1. Матрица является компактным coverage manifest

Canonical row сохраняет `criterionId`, `section`, точные `sourceRefs/sourceText`, нейтральную `interpretation`, stop-factor marker и исходный порядок. Сложные operators/children MAY сохраняться для совместимости existing artifacts, но новые prompts не должны создавать дерево без явной структуры источника. Одна смысловая bullet/формулировка становится одной строкой; примеры и expected evidence остаются контекстом строки.

Альтернатива «атомарный узел на каждый признак» отклонена: она увеличивает матрицу, создаёт скрытые требования и усиливает отрицательный вес отдельных слов.

### 2. Critic — один fail-soft editor, а не gate

Compiler делает self-check. Critic получает профиль, sourceFragments и draft, проверяет только coverage/fidelity/over-splitting/stop-factor origin и возвращает полный successor один раз. При timeout, пустом или непригодном ответе runtime канонизирует технически валидный compiler draft и пишет warning provenance. Отдельного semantic repair loop нет.

### 3. Transcript batching строит coverage grid

Транскрипт делится по полному provider token budget без разрыва utterance; overlap сохраняет вопрос/ответ и соседние реплики. Каждый extraction request содержит компактные matrix rows и `requestedCriterionIds`. Output содержит ровно одну entry на каждый requested ID:

```text
criterionId
scanResult: FOUND | NOT_FOUND_IN_BATCH
evidence[]: relation, quote, locator, utteranceIds, speaker, sourceType
```

Batch extractor не возвращает состояние кандидата. Deterministic harness сравнивает множества requested/returned IDs, запрещает duplicate/unknown IDs и повторяет только missing IDs. Overlap duplicates удаляются по `(criterionId, locator/utteranceId, relation)`.

Для очень большой матрицы harness MAY разбивать её на criterion groups, но каждый source-batch × criterion-group остаётся явной ячейкой coverage grid.

### 4. Gap-search повышает recall без второй оценки

После первичного merge выбираются критерии с нулём `FOUND` во всех материалах. Один bounded gap-search повторно сканирует только их. Он возвращает те же evidence entries и не назначает status. Отсутствие результата gap-search не блокирует дальнейшую оценку.

### 5. Claims описывают источник, а не уровень доверия

Candidate answer, resume statement и provided document являются decision-admissible HR-сведениями при корректной атрибуции и релевантности. `sourceType` и формулировка «со слов кандидата» сохраняются, но independent source count не является gate. Interviewer question остаётся context; unknown speaker не приписывается кандидату.

### 6. Conflict detection выполняется после глобального merge

Consolidator группирует claims без смыслового verdict. Conflict pass видит claims из всех transcript batches и документов. Prompt отличает прямую несовместимость об одном периоде/условии от дополнения, разной детализации, разных периодов, отсутствия упоминания и явной коррекции. Conflict хранится как evidence для конкретной строки; отдельного глобального блокирующего состояния нет.

### 7. Каждый criterion оценивается ровно один раз

После merge критерии распределяются по evaluation batches по 5–10 rows. Один criterionId принадлежит ровно одному evaluation batch. Evaluator видит весь evidence bundle конкретных IDs и возвращает только:

```text
Соответствует | Не соответствует | Недостаточно данных
```

`Соответствует` допускает caveat в reason. `Не соответствует` требует прямого существенного отрицательного основания. `Недостаточно данных` используется при отсутствии содержательной информации или неразрешимом существенном конфликте, но не из-за отсутствия внешней проверки.

Evaluation harness проверяет exact ID coverage. Missing IDs получают один targeted retry; после неудачи runtime создаёт явно техническую `Недостаточно данных` row и продолжает.

Каждая нормальная строка evaluator возвращает не только состояние и объяснение, но и `evidence[]` с `claimId`, точным разрешённым `sourceRef`, дословной короткой цитатой, отношением `SUPPORTS|CONTRADICTS|CONTEXT` и объяснением связи с критерием. Runtime сверяет эти поля с объединённым claim graph: модель не может придумать locator или цитату. Для `Соответствует` и `Не соответствует` требуется хотя бы одно содержательное evidence; для `Недостаточно данных` пустой evidence допустим только с явными `missingData` и `followUpQuestion`.

### 8. Проверка decision-driving выводов становится узкой и fail-soft

Verifier вызывается только для сработавшего stop factor и существенно отказного non-stop вывода. Request включает criterion source text, final row и полные цитаты/locators, а не только claim IDs. Verifier возвращает окончательную исправленную row один раз. Omitted result, timeout или schema failure означает preserve original row. Никакое отсутствие независимого источника не разрешает понижение.

### 9. Open pass сбалансирован и не имеет собственного risk cascade

В extraction output вместе с criterion evidence возвращаются candidate-scoped `additionalObservations` типов `STRENGTH`, `CONCERN`, `QUESTION`. Они дедуплицируются глобально и передаются final synthesis. Отдельные `assess-unmapped-risk` и `verify-critical-risk` больше не определяют recommendation. Existing artifacts могут читаться для backward compatibility, но новые runs их не требуют.

### 10. Recommendation — один целостный LLM synthesis

Confirmed explicit stop factor остаётся deterministic override `Не рекомендовать`. Для остальных случаев final synthesis получает все rows, categories, evidence-backed strengths/concerns/questions и объясняет выбранную категорию. Флаг `required` MAY быть context, но не самостоятельная формула отказа. Существенный отрицательный эпизод вне матрицы может привести к отказу только через явное объяснение role impact в итоговом synthesis.

### 11. Report projection выводится из строк

`competencies`, `strengths`, `accessToKe`, ABC/result sections больше не hard-code пустые массивы. Projection группирует rows по исходному section/category:

- `Соответствует` → strengths/competencies/confirmed results;
- `Не соответствует` → limitations/risks;
- `Недостаточно данных` → questions;
- balanced observations дополняют соответствующие разделы.

Единый HR presentation adapter разрешает claim IDs в цитаты и человекочитаемые места (`Резюме, стр. N`, `Интервью, реплика/таймкод`, название документа). Внутренние `claim-*`, `criterion-*`, artifact URI, имена schema/policy и формулировки critic/verifier не попадают в веб или PDF. Все производные утверждения — strengths, competencies, risks, recommendation basis — строятся только из строк или дополнительных наблюдений, для которых сохранено evidence.

ABC является отдельной проекцией направлений вакансии, а не переименованием matrix criteria. Capability получает только направления с заполненными описаниями A, B и C и возвращает их `directionId`. Если такого профиля нет, capability не вызывается, а HR видит состояние «ABC-профиль не настроен для вакансии» без технического списка критериев.

### 12. Fail-soft завершение является продуктовым инвариантом

Compiler должен вернуть технически валидную матрицу; после этого ошибки critic, gap-search, balanced open pass, conflict helper или verifier становятся warnings. Core row evaluator имеет targeted fallback. Candidate run достигает report generation даже при partial auxiliary degradation; отчёт явно показывает coverage warning и technical fallback count.

### 13. Recovery ограничен полной compatibility identity

Coverage-first revision фиксируется как `matrix-v3`, а shared matrix key состоит из `profileVersion + workflowVersion`. Поэтому уже опубликованная `matrix-v2` той же версии вакансии остаётся immutable, но не препятствует созданию отдельной compact `matrix-v3`.

Manual recovery MAY переиспользовать только непрерывный префикс успешных задач failed run при точном совпадении input version, profile version, goal type, workflow version и policy version. Перед пометкой задачи reused runtime MUST убедиться, что её domain artifact существует в lineage и соответствует ожидаемой schema family текущего workflow. При любом несовпадении recovery начинается с первой несовместимой задачи; старые `matrix-v2` claims/rows/validation никогда не подмешиваются в `matrix-v3`.

### 14. Один цельный отчёт собирается поверх завершённой оценки

Новые runs создают один versioned `candidate-report` вместо пары `abc-test` + `candidate-results`. Это самостоятельная HR-проекция, а не склейка прежних документов. Она содержит фиксированную последовательность: идентификация и источники; организационные условия; рекомендация и executive summary; ABC-направления; ключевые кейсы; критерии вакансии; техническая проверка; мотивация; сильные стороны; риски; стоп-факторы; вопросы; следующий шаг; компактное приложение с матрицей.

После validation вызывается один versioned report-composer. На вход передаются только компактные итоговые artifacts: неизменяемая рекомендация и её основание, ABC states, matrix rows, дополнительные наблюдения и HR-safe evidence catalog. Полные резюме и стенограмма повторно не передаются. Composer MAY сокращать, группировать и устранять повторы, но MUST NOT менять recommendation, ABC grade или row state, придумывать факты/locators и оставлять содержательное утверждение без `evidenceIds`.

Runtime проверяет ссылки composer против переданного каталога и точное сохранение decision fields. Timeout, invalid schema, неизвестная ссылка либо искажение решения не останавливают reports stage: deterministic fallback строит тот же единый report model напрямую из validated HR projection. Audit хранит composer trace/warning, пользовательский PDF не показывает технические идентификаторы.

Document processor получает singular endpoint и возвращает один PDF/checksum. Repository, Drive и notification outbox публикуют одну immutable report version/file. Legacy pair endpoint и чтение старых report types сохраняются только для уже существующих результатов и совместимости, но новые runs их не вызывают.

### 15. Готовая стенограмма является альтернативным входом той же transcription stage

Material manifest различает `recording` и `ready-transcript`, сохраняя общую роль `interview`. Поддерживаемый текстовый файл или DOCX с явным transcript-like именем закрывает обязательный источник интервью. DOCX стенограммы извлекается через document processor до детерминированного transcript parsing; DOCX рекомендаций/характеристик остаётся поддерживаемым дополнительным документом. Резюме и дополнительные документы не должны становиться стенограммой только из-за MIME-типа.

В `candidate.transcription/v1` recording path остаётся прежним: Drive download → media processor/FFmpeg → AssemblyAI → `transcript-bundle`. Ready-transcript path выполняет Drive download → UTF-8 decode → deterministic parsing → тот же `transcript-bundle`; media processor и AssemblyAI не создаются и не вызываются. Поэтому fact extraction, batching, matrix rows, report и selective recovery используют прежнюю artifact family и не получают отдельной ветки.

Явные таймкоды и speaker labels сохраняются как входные сведения. Для строк без таймкода сохраняется line locator; техническая монотонная координата может использоваться только внутри совместимого normalized transport и должна быть явно помечена как derived, чтобы HR presentation не показывала её как время интервью.

Несколько записей и готовых стенограмм не образуют неоднозначность. Transcription stage создаёт или восстанавливает отдельную provider job/parsed source для каждого элемента immutable manifest, затем публикует один составной `transcript-bundle`. Реплики сохраняют исходную speaker label и локальные координаты, а также `sourceFileId`, `sourceFileVersion` и `sourceFileName`; поэтому совпадающие speaker labels и таймкоды разных файлов остаются разными доказательствами. Downstream batching проходит по объединённому набору и не отбрасывает ни один источник.

### 16. Drive snapshot задачи воспроизводят pinned input, а не перечитывают live-папку

Discovery фиксирует stable snapshot и manifest до создания goal. Поэтому `candidate.drive-snapshot/v1` читает их из `candidate_input_versions`; повторный `listChildren` после начала run создавал бы race и нарушал immutable input boundary. Live Drive продолжает сканироваться discovery worker отдельно: изменения становятся новой input version и не влияют на уже начатые extraction/transcription/matrix/report стадии.

### 17. Ручной повтор начинается с нового live discovery cycle

Команда reprocess не должна немедленно создавать run на последней сохранённой версии входов. Она переводит кандидата в `WAITING_FOR_STABILITY`; discovery заново читает папку и получает полный стабильный snapshot с `capturedAtUtc`, не предшествующим самой команде. Непрерывно наблюдаемая неизменная папка может подтвердить стабильность ближайшим post-command observation; при изменении fingerprint действует обычное окно из четырёх наблюдений. Материальная идентичность включает `fileId` и provider version вместе с метаданными manifest, поэтому замена содержимого без изменения размера не считается прежним входом.

Если свежий manifest совпал с failed predecessor, его immutable `inputVersion` переиспользуется: это сохраняет selective recovery и не означает использование устаревшего списка, поскольку совпадение установлено новым live scan. Любое добавление, удаление либо изменение provider version создаёт новую `inputVersion` и отключает reuse upstream checkpoints. После создания goal snapshot снова становится pinned по правилу раздела 16.

## Risks / Trade-offs

- [Самоописание может быть неточным] → показывать provenance «со слов кандидата», точные цитаты и вопросы HR, не выдавая это за background check.
- [Coverage ledger увеличивает output] → компактная entry schema, criterion grouping и targeted retry вместо полного повторного вызова.
- [Модель может вернуть NOT_FOUND при существующем фрагменте] → один targeted gap-search по нулевым критериям.
- [Fail-soft скрывает деградацию provider] → observable warning, coverage counters и technicalFallbackCount в protected operational projection.
- [Holistic recommendation менее детерминирована] → pinned versioned prompt/schema, обязательное explanation и deterministic stop-factor override.

## Migration Plan

1. Зафиксировать независимый acceptance RED новой coverage-first семантики.
2. Добавить новые versioned prompt/schema identities и coverage harness, сохранив чтение existing matrix-v2 artifacts.
3. Переключить новые candidate runs на coverage extraction, gap-search, single row evaluation и holistic synthesis.
4. Исправить report projection из строк и balanced observations.
5. Выполнить focused acceptance/regression и обязательные production-like E2E на immutable build/config/fixture identity.
6. Старые опубликованные результаты не пересчитывать; rollback routing влияет только на новые runs.
7. Failed `matrix-v3` run возобновлять с первой незавершённой либо несовместимой стадии; failed `matrix-v2` запуск после обновления начинает новый `matrix-v3` workflow без reuse candidate-scoped artifacts.
8. Переключить reports checkpoint на единый `candidate-report`; failed run с совместимыми upstream artifacts возобновлять непосредственно с его composition/render/publish.
