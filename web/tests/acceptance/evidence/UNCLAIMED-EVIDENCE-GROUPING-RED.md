# Unclaimed evidence grouping — RED evidence

Дата: 2026-08-24

Команда:

```text
cd web
node --test --test-name-pattern="unclaimed evidence is grouped" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Результат: `1` тест, `0` passed, `1` failed.

Fixture содержит три unclaimed evidence: два с human criterion `Операционное мышление` и одно с criterion `Коммуникация`.

Точное падение:

```text
additional section never renders evidence as direct unmatched cards
actual: 3
expected: 0
```

После удаления direct `.unmatched-fact` тот же тест требует ровно две сгруппированные `.criterion-detail-row`: каждая имеет один summary `Открыть факты →`; первая содержит два вложенных `.criterion-fact`, вторая — один.

JUnit: `tests/acceptance/evidence/unclaimed-evidence-grouping-red.junit.xml`.
