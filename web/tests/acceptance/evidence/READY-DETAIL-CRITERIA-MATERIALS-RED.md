# READY detail criteria/materials — RED evidence

Дата: 2026-08-24

Команда:

```text
cd web
node --test --test-name-pattern="A/B/C badges|detailed assessment|fact disclosure|materials eyebrow|KE region|projectAssessment maps storage KE" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Результат после разделения color/filter fixtures: `7` тестов, `5` passed, `2` failed.

Точные падения:

1. `.criterion-detail-row summary` не содержит `list-style:none`; после этого проверяется `summary::-webkit-details-marker { display:none }`. Текст каждого summary уже равен `Открыть факты →`.
2. Storage mapping уже сохраняет восемь `{criterion, conclusion, state, factIds}`, но READY KE region не показывает `conclusion`: отсутствует `Вывод по критерию 8`, вместо него виден только state `Требует уточнения`.

Прошедшая проверка:

- Color fixture с evidence для B подтверждает A=`success`, B=`warning`, C=`risk` в detail и matching aside.
- Filtering fixture сохраняет B без evidence и подтверждает отсутствие строк ABC/дополнительного критерия без facts.
- Подзаголовки `ABC-критерии`/`Дополнительные критерии`, отсутствие legacy heading, eyebrow `Google Drive`+nowrap и предметное empty КЕ проходят.

JUnit: `tests/acceptance/evidence/ready-detail-criteria-materials-red.junit.xml`.
