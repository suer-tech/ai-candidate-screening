## Why

Текущий dashboard визуально пригоден для MVP, но использует demo counts, ratings, labels и no-op actions. Нужен отдельный operational contract для контроля очереди, ошибок, актуальных результатов и candidate lifecycle без post-MVP recruiter analytics.

## What Changes

- Сохранить layout очереди и summary blocks, заменив demo data canonical workflow statuses, elapsed time и допустимым ETA.
- Показывать errors только в `Контроле очереди` и candidate card, без отдельного error panel.
- Показывать ровно семь отдельных HR-facing summary cards: `Недостаточно материалов`, `Транскрибация`, `AI-анализ`, `Проверка результатов`, `Готово`, `Ошибка` и lifecycle-card `Архив`; не выводить technical `Ожидание стабильности` как primary card и убрать summary `Активные вакансии`.
- Сохранить реальные графики `Поток кандидатов` и `Результаты анализа` с selector `7/30/90 дней`.
- Считать кандидата один раз по текущей актуальной версии; исключать прежний success после terminal `FAILED` reprocess.
- Сохранить Google Drive indicator с polling 15 секунд и тремя состояниями без manual recovery.
- Выбирать greeting по `UTC+5`; не показывать ratings, general score, HR decision state, export, recruiter analytics или demo controls.
- Добавить acceptance matrix empty/error/period/reprocess/ETA/Drive states.

## Capabilities

### New Capabilities

- `operational-dashboard`: операционный MVP dashboard, его blocks, data semantics, filters, periods и integration state.

### Modified Capabilities

- `quality-gates`: добавить dashboard acceptance scenarios на real data, canonical semantics и отсутствие demo behavior.

## Impact

- Затрагиваются dashboard query/read model, workflow/archive metrics, vacancy-series aggregates, Drive health check и UI navigation.
- Конкретная chart library, storage, scheduler и frontend technology не фиксируются.
- Product code не реализуется этим planning change.
