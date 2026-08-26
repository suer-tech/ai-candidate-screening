# READY card single status and borderless footer — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="borderless footer|shows Готово only" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 2 tests, 0 passed, 2 failed.

Exact failures:

```text
AssertionError [ERR_ASSERTION]: candidate footer has no border separator
actual: border-top:1px solid #f0f1f3;...
expected: /(?:^|;)\s*border(?:-top|-right|-bottom|-left)?\s*:/
operator: doesNotMatch

AssertionError [ERR_ASSERTION]: Готово appears exactly once on the READY card
3 !== 1
actual: 3
expected: 1
operator: strictEqual
```

The updated contract no longer requires a footer border. It forbids footer border declarations and pseudo-element dividers while retaining the left `.candidate-processing-duration` and right `.candidate-card-result`. READY must omit `.candidate-score` and keep only the green `status-ready` text `Готово`; processing must retain its current-stage region.

JUnit: `ready-card-single-status-borderless-footer-red.junit.xml`.
