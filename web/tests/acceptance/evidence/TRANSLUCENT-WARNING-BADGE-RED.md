# VIS-DEMO translucent warning badge — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="translucent amber warning surface" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 1 test, 0 passed, 1 failed.

Exact failure:

```text
AssertionError [ERR_ASSERTION]: light --warning-soft is translucent amber/yellow, received #fff0a6
actual: false
expected: true
operator: ==
```

The focused contract also checks the dark-theme token, readable warning ink distinct from risk ink, the scoped `.assessment-grade.grade-b` warning-token rule, and absence of risk/red/brown overrides. Execution stops at the first opaque light-theme token, as expected for RED.

JUnit: `translucent-warning-badge-red.junit.xml`.
