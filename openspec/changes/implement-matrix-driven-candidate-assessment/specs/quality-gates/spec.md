## ADDED Requirements

### Requirement: TST-120 Независимый ATDD matrix-driven workflow
До изменения production-кода независимый субагент MUST создать ожидаемо падающие acceptance tests для компактной shared-компиляции, fail-soft critic fallback, batch coverage ledger, exact requested/returned criterion IDs, точечного retry, gap-search, допустимости самоописания, полного однократного заполнения строк, сбалансированных дополнительных наблюдений, мягкой проверки и всегда формируемого результата.

#### Scenario: Реализация ещё отсутствует
- **WHEN** новый acceptance-набор впервые запускается против текущего runtime
- **THEN** ожидаемые failures и evidence фиксируются до production-изменений

### Requirement: TST-121 Shadow quality gate
Production routing MUST NOT включаться, пока acceptance-набор не подтверждает: каждый самостоятельный пункт профиля представлен ровно одной строкой; не добавлены требования и стоп-факторы; каждый source batch имеет полный coverage ledger; каждый matrix ID получил ровно одну итоговую строку; candidate/resume self-report допускается как HR-сведение; дополнительные сильные стороны не теряются; реальный конфликт содержит обе стороны; подтверждённый стоп-фактор всегда ведёт к отказу; отсутствие ответа вспомогательного критика или verifier не блокирует отчёт.

#### Scenario: Компилятор придумал стоп-фактор
- **WHEN** хотя бы один shadow result содержит не происходящий из профиля стоп-фактор
- **THEN** production routing остаётся выключенным

#### Scenario: Batch пропустил criterion ID
- **WHEN** structured output не содержит один requested criterionId
- **THEN** harness выполняет точечный retry и не принимает неполный batch как завершённый

#### Scenario: Вспомогательная проверка недоступна
- **WHEN** critic или verifier не вернул пригодный ответ
- **THEN** кандидат всё равно доходит до структурированного результата и отчёта

### Requirement: TST-122 Обязательная регрессия перед cutover
После изменений моделей, prompts, schemas, policies или matrix-driven code MUST проходить связанный acceptance-набор и полный `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`.

#### Scenario: Matrix compiler изменён
- **WHEN** изменение готовится к production
- **THEN** все обязательные E2E и matrix-driven acceptance tests имеют GREEN результат

### Requirement: TST-123 Независимая проверка version-safe recovery
Независимый acceptance-контур MUST подтвердить, что `matrix-v2` не является recovery или shared-matrix source для `matrix-v3`; compatible failed `matrix-v3` возобновляется с первой незавершённой стадией; missing/wrong-schema artifact обрывает reusable prefix; successful predecessor и изменённые input/profile/policy запускают полный workflow.

#### Scenario: Старые checkpoints формально успешны
- **WHEN** predecessor содержит `SUCCEEDED` tasks, но его workflow/policy identity отличается
- **THEN** successor не помечает эти задачи reused и не читает их candidate-scoped artifacts

### Requirement: TST-124 Независимая проверка evidence-complete HR projection
До production-изменений независимый acceptance-контур MUST зафиксировать RED для точного evidence-контракта строки, запрета придуманных sourceRef/цитат, разрешения отдельного claims artifact, отсутствия технических идентификаторов в веб/PDF и корректного состояния ненастроенного ABC-профиля.

#### Scenario: Вывод не содержит доказательства
- **WHEN** evaluator возвращает положительное или отрицательное решение без evidence
- **THEN** acceptance test отклоняет строку как непригодную

#### Scenario: Публикуется HR-представление
- **WHEN** результат содержит внутренние IDs и locator URI
- **THEN** acceptance test требует сохранить их в audit, но исключить из видимого веб/PDF текста

### Requirement: TST-125 Независимая проверка единого отчёта
До production-изменений независимый acceptance-контур MUST зафиксировать RED для одного публикуемого PDF, полного набора разделов, точного сохранения recommendation/ABC/row states, валидных evidence references, отсутствия повторов и fail-soft deterministic fallback.

#### Scenario: Composer возвращает непригодный результат
- **WHEN** response меняет decision field, содержит неизвестный evidence ID или не проходит schema
- **THEN** acceptance test требует один валидный fallback PDF и успешное завершение reports stage без второй пользовательской публикации

### Requirement: TST-126 Независимая проверка компактного HR-отчёта
До production-изменений независимый acceptance-контур MUST зафиксировать RED для нормативного порядка одиннадцати HR-разделов, отсутствия отдельных matrix/criteria/stop-factor/question приложений, единственного расположения recommendation в решении, доказательных подразделов технического чека, недублирующего финального резюме и сохранения полной матрицы вне PDF.

#### Scenario: Расширенный системный отчёт ещё используется
- **WHEN** renderer получает новый `candidate-report`
- **THEN** acceptance test отклоняет прежние шестнадцать карточек и верхний recommendation callout
- **AND** требует компактный последовательный документ по HR-образцу

### Requirement: TST-127 Независимая проверка ссылок на материалы
До production-изменений независимый acceptance-контур MUST зафиксировать RED для кликабельных Google Drive/Docs ссылок на каждый использованный материал, видимых HR-имён, отсутствия internal IDs/URI и отказа от invented/unsafe URL.

#### Scenario: PDF пока содержит только текст
- **WHEN** renderer получает source materials с валидными Drive/Docs identities
- **THEN** acceptance test ожидаемо RED, пока PDF не содержит правильные `/Link` annotations для всех этих материалов
