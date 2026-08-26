# UI-DASH-FLOW-001 — Dashboard candidate-flow chart layout RED

## Independence and scope

- Author/executor: independent acceptance subagent `/root/prompt_acceptance`.
- Scope: static rendered CSS contract for Dashboard widget `Поток кандидатов`.
- Production CSS/TSX, OpenSpec and task files were not changed.
- Test SHA-256: `61BA4AF62F1DC9B43B91148F38AE754F97770B2C7CCAB5EF74F180329D1A3D6C`.

## Required layout contract

- `.vacancy-flow-chart .bar-wrap` uses a centered horizontal axis, `flex-direction: column` and `justify-content: flex-end`.
- `.vacancy-flow-chart .bar-total` participates in normal flow, uses tabular numerals, reserves a stable line box and remains centered.
- `.flow-bar` cannot shrink away from the common lower baseline and remains centered.
- Vacancy labels reserve equal two-line height with a line clamp, so title length cannot move the bars.
- At `max-width: 520px`, the chart can scroll horizontally and every vacancy slot keeps a readable minimum width.

## Expected RED before production change

- Timestamp: `2026-08-24T06:25:03.1602415Z`.
- Result: **0 passed, 1 failed, 0 skipped, 0 cancelled**.
- Console and JUnit commands both exited with code `1`.
- Infrastructure/import/syntax errors: `0`.
- First observable product mismatch: computed cascade has `align-items: end` for the chart bar wrapper; expected `center`.
- The same test retains the remaining numeric-label, stable-baseline, equal-label-height and mobile assertions for the GREEN run.

## Reproduction and artifacts

```powershell
cd web
node --test tests/vacancy-flow-chart-layout.acceptance.test.mjs
node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/vacancy-flow-chart-layout-red.junit.xml tests/vacancy-flow-chart-layout.acceptance.test.mjs
```

- Console: `tests/acceptance/evidence/vacancy-flow-chart-layout-red-console.txt`
- JUnit: `tests/acceptance/evidence/vacancy-flow-chart-layout-red.junit.xml`
