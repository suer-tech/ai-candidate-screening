## Context

См. [proposal.md](proposal.md) для мотивации и `specs/` для поведенческих контрактов. Production candidate pipeline уже работает поверх PostgreSQL, protected LLM gateway и durable runtime с task DAG, tool registry, grants, budgets, checkpoints, obstacle fingerprints, repair/replan и outbox. Текущий assessment path, однако, сохраняет плоские facts, обрезает итоговый контекст и вызывает одну assessment capability без shared vacancy-matrix artifact.

Рабочее дерево содержит несколько незавершённых OpenSpec changes и пользовательские изменения. Реализация должна расширять существующие PostgreSQL/runtime boundaries, не создавать параллельную платформу и не изменять несвязанные файлы.

## Goals / Non-Goals

**Goals:**

- Встроить матричный workflow в существующий durable DAG и protected tracing.
- Получить одну аудируемую матрицу на `profileVersion`, независимо от порядка и числа кандидатов.
- Сохранить полный provenance от профиля и материалов до строки оценки и рекомендации.
- Сделать семантические стадии LLM-управляемыми, но bounded, schema-constrained и воспроизводимыми.
- Обеспечить shadow rollout и безопасное сосуществование с legacy workflow.

**Non-Goals:**

- Свободный ReAct-loop или возможность модели создавать tools, SQL и кадровые правила.
- Автоматическая регенерация опубликованной матрицы после обновления модели или prompt.
- Ручное редактирование матрицы либо результата анализа HR.
- Автоматический пересчёт существующих результатов.
- Общий числовой score, рейтинг или выбор лучшего кандидата.

## Decisions

### 1. Matrix artifact является shared immutable domain artifact

Добавляются сущности:

- `vacancy_matrix_compilations`: одна активная compilation identity на `profile_version`, состояние, owner/lease, attempt, budget и terminal error;
- `vacancy_matrices`: опубликованный artifact, schema/policy/skill/model versions, canonical payload, checksum и protected trace refs;
- `candidate_source_claims`: candidate/run/input scoped утверждения с ролью, locator, evidence class и criterion links;
- `candidate_evidence_conflicts`: обе стороны конфликта и global-pass provenance;
- `candidate_matrix_rows`: отдельная строка результата с evidence links и verification state.

Уникальный publish key — `profileVersion`. Compiler metadata включается в provenance и checksum, но не позволяет создать вторую действующую матрицу для той же версии. Альтернатива с ключом `(profileVersion, compilerPolicyVersion)` отклонена: она нарушает сопоставимость кандидатов одной версии.

### 2. Shared compilation использует durable claim, а не candidate-local lock

Первый run создаёт или claims compilation record. Остальные runs фиксируют dependency на этот record и ожидают published artifact. Lease можно восстановить после падения worker; fencing token запрещает прежнему владельцу публиковать после потери lease. Terminal failure распространяется ожидающим runs как одна safe error identity. Новый ручной запуск может создать successor attempt только пока матрица не опубликована.

### 3. Skills — типизированные LLM artifacts внутри продукта

Skill состоит из instruction artifact, response schema, capability configuration и allowlist tools. Начальный набор:

- `compile-vacancy-matrix/v1`, `critique-vacancy-matrix/v2`;
- `extract-claims-for-criteria/v1`, `discover-unmapped-signals/v1`;
- `consolidate-evidence/v1`, `detect-global-conflicts/v1`;
- `fill-matrix-rows/v1`, `assess-abc-direction/v1`;
- `assess-unmapped-risk/v1`, `verify-critical-risk/v1`;
- `verify-critical-row/v1`, `repair-invalid-rows/v1`.

Каждый вызов — отдельная task attempt существующего durable runtime. Модель не управляет plan graph и не пишет напрямую в итоговые таблицы. Альтернатива с Codex `SKILL.md` отклонена: эти навыки являются production LLM contracts, а не инструкциями разработчика.

### 4. Compiler и critic разделены контекстом и capability

Compiler получает полный canonical profile JSON без материалов кандидата. Critic получает профиль, предложенную матрицу, schema и policy, но не reasoning компилятора. Для critic конфигурируется отдельная capability; другая модель предпочтительна, но одинаковая модель допускается с отдельным чистым вызовом и явной provenance отметкой.

Critic вызывается ровно один раз и всегда возвращает окончательный полный successor draft. При отсутствии замечаний он возвращает draft без смысловых изменений со статусом `PASS`; при наличии замечаний сам вносит их в successor и возвращает `CORRECTED` вместе с audit-списком изменений. Отдельный repair skill и повторный critic call не используются. Семантическое несогласие критика не может исчерпать цикл и остановить обработку кандидата: после одного critic-editor call runtime канонизирует полученный successor и продолжает workflow.

### 5. Canonical matrix schema хранит дерево, UI получает проекцию

Matrix root содержит версии и упорядоченные criterion groups. Узел содержит стабильный runtime-assigned `criterionId`, `sourceRefs`, `sourceText`, `interpretation`, `category`, LLM-определённый `required`, `hardRequired`, `operator`, children, `evaluationRule`, `expectedEvidence`, `allowedStates`, `decisionEffect`, `missingDataQuestion` и interpretation notes. Отдельный пользовательский список обязательных требований не создаётся. `hardRequired` является машинной проекцией принадлежности sourceRef разделу стоп-факторов, а не самостоятельным положительным требованием.

LLM создаёт semantic draft с temporary IDs. После единственного critic-editor call runtime проверяет итоговый successor, назначает стабильные IDs и вычисляет checksum. Порядок, явно заданный профилем, сохраняется; canonicalization не сортирует пользовательские списки по алфавиту.

### 6. Best-effort не отменяет запрет усиления смысла

Качественный текст компилируется в наблюдаемое правило без числового порога. LLM-компилятор определяет requiredness из полной структуры и семантики зафиксированного профиля, объясняет классификацию и не использует материалы кандидата. `hardRequired: true` допустим только для sourceRef из раздела стоп-факторов; технический gate проверяет это соответствие, а critic — requiredness, полноту и семантическое искажение.

### 7. Evidence pipeline работает через claims и context retrieval

Нормализованные документы и transcript segments остаются первичными locators. Criterion-directed retrieval выбирает перекрывающиеся смысловые окна, сохраняя вопрос/ответ и соседние реплики. Claim extraction сохраняет утверждение источника, а не объявляет его истинным фактом. Open pass создаёт informational signals и не принимает отказное решение. Отдельный `assess-unmapped-risk/v1` может предложить candidate-scoped `criticalUnmappedRisk`, после чего `verify-critical-risk/v1` в чистом контексте независимо проверяет evidence, существенность для роли и допустимость признаков.

После batch extraction отдельные стадии консолидации и global conflict detection читают весь набор claims. Дедупликация сохраняет distinction между повтором самоописания и независимым источником. Decision-driving evaluator может через read-context tool получить полный исходный фрагмент; 240-символьная обрезка не является его доказательным входом.

### 8. Sensitive-context filter применяется до semantic decision stages

Нормализатор создаёт decision-safe projection, маскируя запрещённые признаки и изображения, но сохраняет locator identity для аудита доступа. Разрешённые профильные параметры локации, графика, командировок, права на работу и профессиональных допусков сохраняются. Prompt envelope явно объявляет candidate materials untrusted data и запрещает исполнять содержащиеся в них инструкции.

### 9. Row evaluation и critical verification разделены

Связанные criterion IDs можно обрабатывать одним вызовом, но output обязан содержать отдельную запись для каждой строки. Deterministic gate проверяет coverage, ID, state, evidence locator, conflict sides и successful provenance. Invalid/missing rows передаются точечному repair skill.

Отдельно в чистом контексте проверяются все stop factors/`hardRequired`, обязательные строки, conflicts и строки, способные изменить предварительную рекомендацию. Candidate-scoped critical unmapped risk проверяется отдельным skill и не добавляет критерий в shared vacancy matrix. Verification подтверждает строку/риск либо возвращает violation для bounded repair.

### 10. Recommendation остаётся детерминированной

Formula adapter получает только validated row states, matrix decision effects и independently verified candidate-scoped risks. Приоритет: подтверждённое срабатывание stop factor/`hardRequired`, доказанный `required` mismatch либо подтверждённый `criticalUnmappedRisk` → отказ; затем обязательная неопределённость/conflict → недостаточно данных; затем некритичный risk, limitation или partial match → оговорки; затем положительный результат. ABC и непроверенные unmapped informational signals не меняют категорию автоматически. Formula inputs и выбранная ветвь сохраняются в snapshot.

### 11. Budgets конфигурируются поверх жёстких верхних границ

На compilation attempt допускаются один compiler call и ровно один critic-editor call, не считая инфраструктурного schema/provider retry самого gateway. Один provider call имеет timeout до 10 минут. Отдельные repair calls, повторная критика и obstacle-fingerprint loop отсутствуют. 30 минут остаются метрикой, не wall-time failure.

Candidate-stage budgets задаются существующим runtime ledger отдельно по calls, tokens/cost, attempts и wall time. Превышение hard budget прекращает новые calls и приводит к типизированной terminal error без частичной публикации.

### 12. Rollout фиксирует workflowVersion на старте run

Routing имеет режимы `disabled`, `shadow`, `production`. В shadow новый DAG читает те же immutable inputs, но пишет отдельные artifact kinds и не получает grants на Drive publication/Telegram. Сравнение выполняется offline по structural и semantic gates. После production cutover новые runs фиксируют новую workflowVersion; уже начатые legacy runs не переключаются. Rollback меняет routing только для новых runs.

## Risks / Trade-offs

- [LLM-компилятор стабильно искажает сложный профиль] → независимый critic, exact source refs, bounded repair, shadow benchmark и запрет публикации при unresolved severe violation.
- [Первая обработка вакансии становится дольше] → shared artifact, один раз на `profileVersion`, отдельные метрики и отсутствие искусственного 30-минутного hard stop.
- [Shared compilation блокирует несколько кандидатов] → durable lease/fencing, один recoverable attempt и единая наблюдаемая dependency вместо конкурирующих вызовов.
- [Большая матрица увеличивает токены] → группировка связанных строк, context retrieval и точечный repair без пропуска criterion IDs.
- [Sensitive-data masking ухудшает читаемость локатора] → разделить immutable raw locator и decision-safe projection, ограничить доступ к raw context.
- [Одинаковая модель compiler/critic коррелирует ошибки] → отдельные capability/context и provenance; возможность настроить другой model route без изменения бизнес-логики.
- [Новый workflow расходится с legacy PDF projection] → один validated snapshot как источник обоих PDF и shadow comparison до side-effect grants.

## Migration Plan

1. Добавить forward-only PostgreSQL migration и repositories без изменения legacy reads.
2. Зарегистрировать schemas, skills, capabilities, tool grants и synthetic fixtures.
3. Подключить shared matrix compilation в `shadow`, сохраняя отдельные artifacts.
4. Подключить claims/evidence/row evaluation и отчётную проекцию без visible side effects.
5. Пройти независимый acceptance-набор, четыре обязательных E2E и shadow quality gate.
6. Включить `production` только для новых runs; наблюдать failures, latency, repair и semantic violations.
7. При rollback перевести новые runs в `disabled`/legacy; существующие runs завершить по зафиксированной workflowVersion.
