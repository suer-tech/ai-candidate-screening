# VIS-DEMO resolved evidence count — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="criterion count equals resolved|resolved evidence counters use Russian" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 2 tests, 0 passed, 2 failed.

Exact failures:

```text
AssertionError [ERR_ASSERTION]: counter is based on two resolved evidence items, not five declared ids
actual: ...5 доказательств... [two rendered criterion facts]
expected: /2 доказательства/
operator: match

AssertionError [ERR_ASSERTION]: 1 uses the correct Russian evidence form
actual: ...1 доказательств...
expected: /1 доказательство/
operator: match
```

The first fixture declares five `factIds`, resolves only two evidence records, toggles that row open, and requires both the visible `2 доказательства` counter and exactly two `.criterion-fact` nodes. The companion contract covers `1 доказательство`, `2 доказательства`, and `5 доказательств`, with each counter equal to the rendered fact count.

JUnit: `resolved-evidence-count-red.junit.xml`.
