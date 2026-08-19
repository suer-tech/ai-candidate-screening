## ADDED Requirements

### Requirement: TST-089 [CONFIRMED] Canonical status UI принимается event-driven matrix
Acceptance MUST вызвать каждое из девяти workflow states и проверить exact user label, transition event, current badge, separate archive flag и отсутствие recommendation/percentage как status.

#### Scenario: Structured response передан на checks
- **WHEN** controlled workflow завершает assessment response и начинает validation
- **THEN** UI показывает `Проверка результата`
- **AND** `Готово` не появляется до полного success contract

### Requirement: TST-090 [CONFIRMED] Archive, restore и delete имеют guards и audit
Matrix MUST проверить disabled archive during processing, archive confirmation, archive filter, restore without analysis, delete only after archive, separate delete confirmation, app-data cleanup without Drive operation и audit всех трёх lifecycle actions.

#### Scenario: Processing candidate нельзя архивировать
- **WHEN** test пытается archive во время `ANALYZING`
- **THEN** action disabled и run не изменяется
- **AND** audit не содержит ложного archive success

### Requirement: TST-091 [CONFIRMED] Manual reprocess доступен только в разрешённых состояниях
Acceptance MUST проверить enabled action у `READY` и terminal `FAILED`, visible disabled action during processing, отсутствующий action в archive, confirmation/cancel и автоматический launch только после successful stability check.

#### Scenario: Stability ещё не достигнута
- **WHEN** HR подтвердил reprocess, но files продолжают меняться
- **THEN** новый run отсутствует
- **AND** UI показывает current waiting status и disabled повтор

### Requirement: TST-092 [CONFIRMED] Новый run использует versions и safe reuse
Test MUST подтвердить новый run/result version, immutable input/profile binding, отсутствие file-change auto-run и reuse допустимых completed expensive stages по WF-023.

#### Scenario: FAILED assessment повторяется без input changes
- **WHEN** HR подтверждает retry после automatic attempts
- **THEN** новый run переиспользует valid extraction/transcription artifacts
- **AND** начинает applicable failed stage без duplicate STT

### Requirement: TST-093 [CONFIRMED] Out-of-scope demo UI отсутствует
Acceptance MUST проверить отсутствие `На следующий этап`, hiring decision state, `Аналитика`, vacancy-table no-op filters/export/search при сохранении functional queue/archive filters и PDF export.

#### Scenario: MVP navigation открыта
- **WHEN** HR просматривает top navigation и candidate/vacancy screens
- **THEN** скрытые и no-op controls отсутствуют
- **AND** normative MVP controls остаются функциональными
