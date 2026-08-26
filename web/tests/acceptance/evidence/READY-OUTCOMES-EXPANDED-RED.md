# READY outcomes expanded — RED evidence

Дата: 2026-08-24

Команда:

```text
cd web
node --test --test-name-pattern="READY outcome" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Результат: `2` теста, `0` passed, `2` failed.

Точные падения:

1. `Сильные стороны has no collapsed details/summary`: найдено `2` disclosure-узла (`details` и `summary`), ожидалось `0`. Fixture содержит пять сильных сторон; тот же цикл после исправления проверит все пять рисков и компетенций, отсутствие `Показать ещё` и немедленную видимость каждого названия.
2. `Сильные стороны items expose stable classes`: найдено `0` элементов `.decision-outcome-item`, ожидалось `5`. После этого assertion тест требует `.decision-outcome-icon` у header/item icons и сохраняет `is-strength`/`is-risk` с `--success-soft/--success-ink` и `--risk-soft/--risk-ink`.

JUnit: `tests/acceptance/evidence/ready-outcomes-expanded-red.junit.xml`.
