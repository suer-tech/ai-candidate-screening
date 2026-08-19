## ADDED Requirements

### Requirement: INT-040 [CONFIRMED] Drive-папка вакансии создаётся и связывается идемпотентно
Успешный create-vacancy save MUST создать либо найти одну папку вакансии в согласованной области Google Shared Drive и сохранить устойчивую связь её Folder ID с vacancy ID. Повтор той же save operation MUST использовать существующий binding и MUST NOT создавать duplicate folders.

#### Scenario: Vacancy сохранена впервые
- **WHEN** atomic save достигает Drive provisioning
- **THEN** система создаёт одну vacancy folder и связывает её Folder ID с vacancy ID
- **AND** только после binding save может завершиться success

#### Scenario: Повтор после неизвестного результата
- **WHEN** save повторяется после timeout либо временной ошибки
- **THEN** система находит существующий binding или завершает прежнюю operation
- **AND** не создаёт вторую folder

#### Scenario: Drive недоступен
- **WHEN** обязательное folder provisioning не завершилось после разрешённых retries
- **THEN** save остаётся unsuccessful и vacancy не участвует в intake/analysis
- **AND** HR получает понятную ошибку и safe retry action
