# KE gap, resolved facts and warning B — RED evidence

Дата: 2026-08-24

Команда:

```text
cd web
node --test --test-name-pattern="additional criteria require|10px horizontal gap|B badges remain" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Результат: `3` теста, `0` passed, `3` failed.

Точные падения:

1. В `Дополнительные критерии` отображается `Критерий только с declared factId`, хотя `missing-fact` отсутствует в evidence. После исключения такой строки тест требует ровно одну resolved-строку с `Открыть факты →` и раскрываемым `.criterion-fact`.
2. `.ke-access-content>div>p` не объявляет `gap`/`column-gap`; требуется явный горизонтальный gap не меньше `10px` между icon column и названием.
3. Legacy dark rules для `.grade-b` содержат hardcoded brown/yellow `#3c3018/#edc56e/#65512b` и отдельный override `var(--risk-soft)/var(--risk-ink)`. Scoped `.assessment-grade.grade-b` уже использует warning tokens, но конфликтующие dark selectors пока могут перекрасить B.

JUnit: `tests/acceptance/evidence/ke-gap-resolved-facts-warning-b-red.junit.xml`.
