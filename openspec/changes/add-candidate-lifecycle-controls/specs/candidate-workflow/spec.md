## MODIFIED Requirements

### Requirement: WF-020 [CONFIRMED] Минимальная машина состояний
Workflow SHALL поддерживать состояния `NEW`, `WAITING_FOR_STABILITY`, `MATERIALS_INCOMPLETE`, `MATERIALS_READY`, `TRANSCRIBING`, `ANALYZING`, `VALIDATING`, `READY` и `FAILED`. UI labels SHALL быть соответственно `Новый`, `Ожидание стабильности`, `Недостаточно материалов`, `Материалы готовы`, `Транскрибация`, `Анализ`, `Проверка результата`, `Готово`, `Ошибка`. `TRANSCRIBING` начинается при старте применимого STT stage; `ANALYZING` — при старте первого assessment call после готовности prerequisites; `VALIDATING` — после получения structured AI response и до завершения schema, evidence и result checks. `FAILED` MUST содержать stage, reason code, attempt count и exhaustion flag. Archive MUST быть отдельным lifecycle flag и MUST NOT заменять workflow state.

#### Scenario: Кандидат проходит штатную обработку
- **WHEN** полный стабильный комплект обрабатывается без ошибок
- **THEN** primary badge последовательно показывает применимые canonical states до `Готово`
- **AND** UI не смешивает status с recommendation или progress percentage

#### Scenario: Автоматические повторы исчерпаны
- **WHEN** stage исчерпал OPS-003 attempts
- **THEN** primary status становится `Ошибка`
- **AND** карточка показывает stage и понятную причину

#### Scenario: Archived candidate открыт
- **WHEN** HR открывает candidate через archive filter
- **THEN** UI показывает archive lifecycle badge и сохранённый workflow status раздельно
- **AND** archive не создаёт новое top-level workflow state

#### Scenario: Обязательный файл невозможно обработать
- **WHEN** обязательный файл остаётся необрабатываемым после применимых автоматических повторов
- **THEN** primary status становится `Ошибка`
- **AND** состояние содержит stage, reason code, attempt count и exhaustion flag

## ADDED Requirements

### Requirement: WF-033 [CONFIRMED] Manual reprocessing управляется из карточки
Candidate card SHALL показывать action ручной повторной обработки для `READY` и для `FAILED` после исчерпания automatic retries. Во время active processing action MUST оставаться видимым disabled с объяснением. Archived candidate MUST NOT иметь доступный reprocess action.

#### Scenario: READY candidate запускается повторно
- **WHEN** HR нажимает доступный reprocess action
- **THEN** система показывает confirmation о недоступности прежних результатов и обновлении данных
- **AND** cancel не изменяет candidate или workflow

#### Scenario: Processing candidate открыт
- **WHEN** candidate находится в `MATERIALS_READY`, `TRANSCRIBING`, `ANALYZING` либо `VALIDATING`
- **THEN** reprocess action виден disabled
- **AND** пояснение сообщает, что повтор доступен после завершения текущего run

### Requirement: WF-034 [CONFIRMED] Confirmation запускает stability check перед новым run
После reprocess confirmation система MUST заново выполнить canonical stability and completeness checks последней input version. Новый run MUST стартовать автоматически только после успешной стабилизации полного комплекта; file change сам по себе MUST NOT запускать run. Каждый successful launch MUST создать новый run и result version.

#### Scenario: Inputs стабильны и полны
- **WHEN** HR подтвердил reprocess и последняя input version прошла stability/completeness
- **THEN** система автоматически запускает новый versioned run
- **AND** связывает его с зафиксированными input/profile versions

#### Scenario: Inputs ещё меняются
- **WHEN** после confirmation stability не подтверждена
- **THEN** новый run не стартует
- **AND** current status показывает ожидание стабильности либо недостаток материалов

### Requirement: WF-035 [CONFIRMED] Primary status относится к текущему input/run
После обнаружения новой input version или confirmation reprocess primary badge MUST отражать состояние текущего input/run. Прежний `READY` MUST NOT показываться как current success; visibility старой пары results регулируется reporting contract.

#### Scenario: После READY появились новые материалы
- **WHEN** система зафиксировала новую input version
- **THEN** primary status становится применимым current state
- **AND** recommendation прежнего результата не заменяет workflow status
