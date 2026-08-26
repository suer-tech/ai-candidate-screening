# VIS-DEMO whole-row criterion disclosure — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="whole criterion row|criterion evidence open state" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 2 tests, 0 passed, 2 failed.

Exact first failures:

```text
AssertionError [ERR_ASSERTION]: there is no separate disclosure text or button
actual: ...Открыть факты →...
expected: /Открыть факты/
operator: doesNotMatch

AssertionError [ERR_ASSERTION]: open state is visually explicit and scoped to the selected item
actual: ''
expected: /(?:border|background|box-shadow)\s*:/
operator: match
```

Once those gates pass, the same focused contract checks native keyboard-accessible whole-row buttons, `aria-expanded`, click/open/click-close behavior, exactly one `.criterion-detail-item.is-open`, an immediately adjacent `.criterion-evidence-area` with criterion-bound facts, full-width/separated evidence styling, and a `prefers-reduced-motion: reduce` transition override without timing assertions.

JUnit: `criterion-row-disclosure-red.junit.xml`.
