## Why

В карточке кандидата «Итог AI» и «Детальная оценка» склеивают разнородные части в плотный текст. Пользователь согласовал адаптивные абзацы и списки с сохранением смысла, проверку на новой обработке и возможность вернуть прежнее оформление.

## What Changes

- Сохранить переносы HR-safe обоснований и показывать абзацы, явные заголовки и списки без переписывания слов, чисел, отрицаний или порядка.
- Отдельно отображать ABC-обоснование, справочную шкалу A/B/C и существующие доказательства. По уточнению пользователя от 2026-10-14 скрыть «Учтённые признаки», сохранив исходные данные, и перенести кнопку «Доказательства» в конец карточки непосредственно перед раскрываемой областью. Пустые поля не создавать.
- Для новых результатов закрепить в действующих строковых полях LLM правило «одна мысль — один абзац», списки с отдельными строками; старый JSON остаётся совместимым.
- Для сплошного старого текста использовать только консервативные явные границы; неоднозначный текст оставлять вместе.
- Сохранить предыдущий immutable image и точную команду отката trial release; отчёты и сохранённые результаты не переписывать.

## Performance follow-up (2026-10-14)

The user reports 5–10s+ loading indicators for every candidate card. Read-only production measurement: summary ~189ms; all-candidate detailed SQL exceeded 12s; the same report projection scoped to one candidate ~476ms. Preserve REP-020/050/051 content and existing summary/full API compatibility, but request detailed data for only the selected candidate. Keep list entries intact, invalidate stale detail responses on selection changes, and never fall back to another candidate. No scoring, processing, schema or stored data changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reporting-and-notifications`: читаемое адаптивное представление готовой оценки без изменения её содержания.

## Impact

UI candidate detail, HR-safe projection, presentation-only LLM instructions, synthetic independent rendered acceptance and relevant regression. No DB migrations, provider changes or automatic reprocessing. Полный production-like E2E остаётся отдельным gate: known BLOCKED не становится GREEN из-за пользовательской ручной проверки.
