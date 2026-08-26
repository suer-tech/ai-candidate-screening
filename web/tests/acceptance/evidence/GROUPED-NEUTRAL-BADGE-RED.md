# Grouped neutral badge — RED evidence

Дата: 2026-08-24

Команда:

```text
cd web
node --test --test-name-pattern="grouped neutral assessment badge" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Результат: `1` тест, `0` passed, `1` failed.

Точное падение:

```text
neutral grouped badge is explicitly scoped to blue tokens
actual: ""
expected: background:var(--blue-soft); color:var(--blue)
```

Вместо требуемого scoped `.assessment-grade.grade-neutral` сейчас существует только общий hardcoded `.grade-neutral`. После появления scoped rule тест также запрещает white/hardcoded dark overrides.

JUnit: `tests/acceptance/evidence/grouped-neutral-badge-red.junit.xml`.
