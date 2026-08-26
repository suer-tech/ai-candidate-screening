# VIS-DEMO candidate card footer duration — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="READY candidate card footer|candidate progress track keeps" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 2 tests, 0 passed, 2 failed.

Exact failures:

```text
AssertionError [ERR_ASSERTION]: completed card exposes a semantic footer region
actual: undefined
expected: true
operator: ==

AssertionError [ERR_ASSERTION]: progress-to-footer gap is at least 12px, received 2px
actual: false
expected: true
operator: ==
```

The READY fixture persists `elapsedMinutes: 18`; its footer must expose left `.candidate-processing-duration` with `18 мин` and right `.candidate-card-result` with the recommendation. Processing and READY-with-unknown-duration fixtures must not render a completed-duration region. The companion CSS contract requires at least 12px after `.candidate-card .candidate-progress` before the footer's upper border, a separate flex/grid footer layout, and right-aligned result styling.

JUnit: `candidate-card-footer-duration-red.junit.xml`.
