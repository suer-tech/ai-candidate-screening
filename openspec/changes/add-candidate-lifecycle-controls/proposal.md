## Why

Canonical specs задают state machine, archive и retry, но текущий UI смешивает workflow status, recommendation и demo actions, а подтверждённые lifecycle решения меняют удаление, повторную обработку и границы MVP. Нужен наблюдаемый и безопасный контракт действий кандидата без hiring pipeline state.

## What Changes

- Показывать девять canonical workflow states с provider-neutral event boundaries и отдельным archive lifecycle badge.
- Запретить archive во время processing; добавить подтверждённые archive, restore и delete controls, где delete доступен только после archive.
- **BREAKING:** окончательное удаление очищает только данные приложения и никогда не удаляет и не ожидает удаления Drive-папок/файлов; Drive cleanup queue отсутствует.
- Аудировать archive, restore и delete.
- Добавить manual reprocessing из карточки для `READY` и terminal `FAILED`, disabled во время active run, с confirmation, stability check и новым versioned run.
- Удалить MVP controls и states без нормативного назначения: `На следующий этап`, hiring decision pipeline, верхнюю `Аналитику`, vacancy-table no-op filters/export/search.
- Добавить acceptance scenarios lifecycle, statuses, failures и UI guards.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `candidate-workflow`: уточнить visible state boundaries и manual reprocessing lifecycle.
- `data-and-security`: изменить archive/delete/restore contract и audit events без Drive deletion.
- `product-scope`: зафиксировать границу MVP без HR decision pipeline и demo controls.
- `quality-gates`: добавить independently authored lifecycle/status/reprocess acceptance scenarios.

## Impact

- Затрагиваются candidate card/list, workflow orchestration, archive filter, audit, deletion and retry operations.
- Visibility готовых PDF при reprocess остаётся в change `add-in-app-report-preview`; этот change не дублирует preview contract.
- Product code не реализуется этим planning change.
