# KE state semantics — RED evidence

Дата: 2026-08-24

Команда:

```text
cd web
node --test --test-name-pattern="KE (not-confirmed|states expose)" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Результат: `2` теста, `0` passed, `2` failed.

Точные падения:

1. `Не подтверждено uses a negative icon, not the substring-based success check`: actual `✓`, expected `×`. Это фиксирует ложное совпадение `подтверж` внутри отрицательного state.
2. `Подтверждённый пункт exposes ke-state-confirmed`: semantic class отсутствует. После этого тест требует отдельные `.ke-state-partial`, `.ke-state-not-confirmed`, `.ke-state-needs-clarification`, иконки `✓/◐/×/?` и tokenized colors success/warning/risk/blue.

JUnit: `tests/acceptance/evidence/ke-state-semantics-red.junit.xml`.
