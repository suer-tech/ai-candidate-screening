# READY report duration projection — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="READY projection preserves|postgres READY report query derives" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 2 tests, 0 passed, 2 failed.

Exact failures:

```text
AssertionError [ERR_ASSERTION]: READY candidate receives duration from the exact published report version
7 !== 35
actual: 7
expected: 35
operator: strictEqual

AssertionError [ERR_ASSERTION]: report query aggregates MIN(agent_attempts.started_at) in a correlated/lateral subquery bound to r.run_id
actual: ''
expected: true
operator: ==
```

The projection fixture supplies report `elapsedMinutes: 35` over a stale candidate value of 7. The SQL contract requires a correlated/lateral aggregate over attempts belonging to the current `r.run_id`, duration through report/run completion, no top-level attempts join that multiplies document rows, and repository mapping into `ReadyReportProjection`.

JUnit: `ready-report-duration-projection-red.junit.xml`.
