## MODIFIED Requirements

### Requirement: SEC-005 [CONFIRMED] Журнал действий
Audit MUST фиксировать доступ к карточке; создание, изменение, активацию и удаление вакансии; создание, перемещение, архивирование, восстановление и окончательное удаление кандидата; добавление и замену материалов; запуск и повтор анализа; выбор profile version; и export. Каждый timestamp MUST храниться UTC ISO 8601 и отображаться в `Asia/Yekaterinburg` с `+05:00`. Готовый результат MUST оставаться read-only.

#### Scenario: HR запускает новую версию вместо изменения результата
- **WHEN** HR подтверждает manual reprocess
- **THEN** audit содержит actor, candidate, input/profile versions и время confirmation
- **AND** launch event связывается с новым run после stability check

#### Scenario: Кандидат перемещён между вакансиями
- **WHEN** кандидат связывается с другой вакансией допустимой операцией
- **THEN** audit фиксирует actor, candidate, исходную и целевую vacancy и timestamp
- **AND** существующая история действий не перезаписывается

#### Scenario: Candidate восстановлен
- **WHEN** HR выполняет restore из archive
- **THEN** audit содержит actor, candidate, прежний lifecycle flag и время
- **AND** restore не записывается как analysis launch

### Requirement: SEC-007 [CONFIRMED] Архивирование и каскадное удаление
Archive SHALL быть обратимым lifecycle flag, сохранять application data и последнее workflow state, скрывать candidate из active/default surfaces и отключать automatic launches/notifications. Archive action MUST быть disabled во время processing и SHALL требовать confirmation. Restore SHALL возвращать candidate без automatic analysis. Permanent delete MUST быть доступен только archived candidate, требовать отдельного confirmation и удалять internal card, personal fields, transcripts, OCR, AI responses, fragments, embeddings, PDFs, technical JSON, temporary files и другие application-derived data, кроме protected LLM traces, чей отдельный 30-day lifecycle задаётся dedicated tracing capability. Приложение MUST NOT удалять, ожидать удаления или требовать от HR удаления Google Drive folders/files. Minimal tombstone без PII SHALL предотвращать rediscovery прежнего Folder ID; Drive cleanup status/queue MUST отсутствовать.

#### Scenario: Archive запрошен во время processing
- **WHEN** candidate находится в active processing state
- **THEN** archive action disabled и операция не выполняется
- **AND** active run продолжается по workflow

#### Scenario: Archived candidate restored
- **WHEN** HR выполняет restore
- **THEN** candidate возвращается в применимое сохранённое workflow state
- **AND** analysis не запускается автоматически

#### Scenario: Permanent delete подтверждён
- **WHEN** archived candidate удаляется окончательно
- **THEN** application data удаляются и остаётся minimal non-PII tombstone
- **AND** Drive content не удаляется, не проверяется и не создаёт cleanup queue

#### Scenario: Delete запрошен для active candidate
- **WHEN** candidate не archived
- **THEN** permanent delete unavailable
- **AND** application data и Drive content не изменяются

#### Scenario: Срок хранения истёк
- **WHEN** применимый retention policy требует удаления архивированного кандидата
- **THEN** система выполняет тот же permanent-delete contract для application data
- **AND** Drive content не удаляется, а protected traces следуют отдельному 30-day lifecycle

#### Scenario: Кандидат архивирован
- **WHEN** HR подтверждает archive завершённого кандидата
- **THEN** candidate скрывается из active/default surfaces и automatic launches/notifications
- **AND** application data, Drive content и последнее workflow state сохраняются

#### Scenario: Удаление подтверждено, но исходная папка существует
- **WHEN** permanent delete подтверждён для archived candidate и связанная Drive folder продолжает существовать
- **THEN** deletion application data завершается без ожидания Drive cleanup
- **AND** minimal non-PII tombstone предотвращает rediscovery прежнего Folder ID

#### Scenario: Полное удаление завершено
- **WHEN** permanent-delete operation успешно завершена
- **THEN** internal PII и application-derived data удалены, кроме protected traces до их expiry
- **AND** Drive cleanup status или queue отсутствует
