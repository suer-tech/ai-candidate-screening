# UI-DASH-FLOW-001 — Dashboard candidate-flow chart layout GREEN

## Independent verification

- Executor: independent acceptance subagent `/root/prompt_acceptance`.
- Production CSS and acceptance oracle were not changed during verification.
- Oracle SHA-256 matches the RED baseline exactly: `61BA4AF62F1DC9B43B91148F38AE754F97770B2C7CCAB5EF74F180329D1A3D6C`.
- Timestamp: `2026-08-24T06:28:04.0027319Z`.

## Result

- Same focused test: **1 passed, 0 failed, 0 skipped, 0 cancelled**.
- Console runner exit: `0`.
- JUnit runner exit: `0`.
- Targeted ESLint exit: `0`.

The unchanged oracle confirms centered column layout with a common lower baseline, a normal-flow tabular numeric label with stable height, a centered non-shrinking bar, equal two-line clamped vacancy-label height, and readable mobile scrolling with minimum slot width.

## Reproduction and artifacts

```powershell
cd web
node --test tests/vacancy-flow-chart-layout.acceptance.test.mjs
node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/vacancy-flow-chart-layout-green.junit.xml tests/vacancy-flow-chart-layout.acceptance.test.mjs
npm exec eslint -- tests/vacancy-flow-chart-layout.acceptance.test.mjs
```

- Console: `tests/acceptance/evidence/vacancy-flow-chart-layout-green-console.txt`
- JUnit: `tests/acceptance/evidence/vacancy-flow-chart-layout-green.junit.xml`
