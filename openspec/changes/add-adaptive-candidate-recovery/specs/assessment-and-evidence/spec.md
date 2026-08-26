## ADDED Requirements

### Requirement: ASM-062 [CONFIRMED] Локальный repair evidence не переписывает весь анализ
Если validated assessment содержит ограниченный дефект evidence — отсутствующий locator, locator на несовместимую artifact version либо claim, который можно проверить по уже сохранённым source fragments, — система SHALL создать bounded repair только для затронутого claim/evidence edge. Repair MUST использовать исходный claim, разрешённые fragments и schema, MUST NOT повторять extraction/OCR/STT или изменять несвязанные assessment sections и MUST создавать successor artifact с provenance. Если допустимого evidence нет, claim SHALL получить нормативное состояние недостаточности либо conflict вместо вымышленного locator.

#### Scenario: Один locator отсутствует
- **WHEN** assessment gate находит один significant claim без locator, а соответствующие source fragments уже сохранены
- **THEN** repair проверяет только этот claim и допустимые fragments
- **AND** остальной assessment и дорогие upstream artifacts переиспользуются без изменения

#### Scenario: Подтверждения в источниках нет
- **WHEN** bounded repair не находит допустимого evidence
- **THEN** система не создаёт вымышленную цитату или locator
- **AND** claim переводится в применимое `Недостаточно данных` либо удаляется из подтверждённых выводов

#### Scenario: Repair изменил смысл вывода
- **WHEN** proposed repair меняет recommendation, stop factor или другой связанный assessment decision
- **THEN** local merge блокируется
- **AND** runtime создаёт replan для повторной проверки затронутых зависимых sections

### Requirement: ASM-063 [CONFIRMED] Большой assessment декомпозируется по нормативным разделам
Если preflight либо provider response доказывает превышение context/output limit, система MAY создать bounded subtasks только по зарегистрированным разделам профиля и assessment: facts/evidence, experience, ABC, competencies, access-to-KE, risks/stop factors и conflicts. Каждый subtask MUST получать общий immutable input/profile context manifest, ограниченный section scope и structured schema. Decomposition MUST NOT менять критерии, формулу или разрешать subtask формировать финальную рекомендацию независимо.

#### Scenario: Полный запрос превышает context limit
- **WHEN** preflight показывает, что versioned context не помещается в допустимый model limit
- **THEN** runtime создаёт зарегистрированный section plan в пределах replan budget
- **AND** каждый subtask использует те же input/profile versions

#### Scenario: Один subtask не завершён
- **WHEN** обязательный section output отсутствует или invalid
- **THEN** merge и публикация блокируются
- **AND** recovery применяется только к этому subtask либо создаётся escalation

### Requirement: ASM-064 [CONFIRMED] Merge decomposed assessment проходит общие gates
Merge SHALL быть детерминированным по schema identities и stable section keys, сохранять все evidence locators и выявлять cross-section contradictions, duplicate claims и несовместимые confidence/state. После merge система MUST заново применить global evidence, conflict, stop-factor, access-to-KE и recommendation gates. Финальная recommendation MUST вычисляться только один раз детерминированной формулой по merged validated structure.

#### Scenario: Subtasks согласованы
- **WHEN** все обязательные sections valid и используют совместимые versions
- **THEN** merge создаёт один immutable assessment snapshot
- **AND** deterministic formula вычисляет recommendation после global gates

#### Scenario: Sections противоречат друг другу
- **WHEN** один section подтверждает факт, а другой опровергает его по допустимому evidence
- **THEN** merge не выбирает один вывод silently
- **AND** создаёт cross-section conflict для bounded repair/replan либо normative conflict state

#### Scenario: Две части повторяют один claim
- **WHEN** stable claim identity и evidence совпадают
- **THEN** merge дедуплицирует представление без потери provenance
- **AND** duplicate не увеличивает confidence или вес рекомендации
