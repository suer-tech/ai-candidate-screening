# KE storage projection — RED evidence

Дата: 2026-08-24

Команда:

```text
cd web
node --test --test-name-pattern="projectAssessment maps storage KE" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Результат: `1` тест, `0` passed, `1` failed.

Storage fixture передаёт восемь элементов `structuredAssessment.accessToKe` реальной формы:

```text
{ criterion, conclusion, state, factIds }
```

Точное падение:

```text
all eight storage KE criteria survive projection
actual: 0
expected: 8
```

После проверки количества тот же тест требует mapping `criterion -> name`, `conclusion -> reason`, сохранение `state`/`factIds` и отображение первого/последнего КЕ в READY region без ложного empty state.

JUnit: `tests/acceptance/evidence/ke-storage-projection-red.junit.xml`.
