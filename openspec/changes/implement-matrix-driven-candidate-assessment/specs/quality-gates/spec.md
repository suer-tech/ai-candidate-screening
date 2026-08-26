## ADDED Requirements

### Requirement: TST-120 Независимый ATDD matrix-driven workflow
До изменения production-кода независимый субагент MUST создать ожидаемо падающие acceptance tests для ленивой shared-компиляции, неизменяемости, полного покрытия строк, ABC sufficiency, глобальных конфликтов, speaker attribution, prompt injection, sensitive-data exclusion, deterministic recommendation и legacy compatibility.

#### Scenario: Реализация ещё отсутствует
- **WHEN** новый acceptance-набор впервые запускается против текущего runtime
- **THEN** ожидаемые failures и evidence фиксируются до production-изменений

### Requirement: TST-121 Shadow quality gate
Production routing MUST NOT включаться, пока shadow-набор не подтверждает: 100% критериев представлены; `required` семантически обоснован; `hardRequired` имеет точное соответствие только стоп-факторам профиля; отсутствуют придуманные стоп-факторы; все decision-driving выводы имеют допустимые локаторы; конфликты содержат обе стороны; каждый `criticalUnmappedRisk` прошёл независимую проверку; рекомендации совпадают с формулой; критические строки прошли независимую проверку.

#### Scenario: Компилятор придумал стоп-фактор
- **WHEN** хотя бы один shadow result содержит не происходящий из профиля стоп-фактор
- **THEN** production routing остаётся выключенным

#### Scenario: Unmapped risk не прошёл независимую проверку
- **WHEN** shadow result использует непредусмотренный сигнал как отказное основание без успешной critical-risk verification
- **THEN** production routing остаётся выключенным

### Requirement: TST-122 Обязательная регрессия перед cutover
После изменений моделей, prompts, schemas, policies или matrix-driven code MUST проходить связанный acceptance-набор и полный `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`.

#### Scenario: Matrix compiler изменён
- **WHEN** изменение готовится к production
- **THEN** все обязательные E2E и matrix-driven acceptance tests имеют GREEN результат
