# Criterion accent and grouped evidence icon — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="criterion titles use|disclosed evidence headings use|grouped evidence rows use an accessible" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 3 tests, 0 passed, 3 failed.

Exact failures:

```text
AssertionError [ERR_ASSERTION]: light theme declares --criterion-accent
actual: ''; expected: ''; operator: notStrictEqual

AssertionError [ERR_ASSERTION]: light theme declares --evidence-verified-ink
actual: ''; expected: ''; operator: notStrictEqual

AssertionError [ERR_ASSERTION]: grouped row has one stable inline document-check icon
0 !== 1
actual: 0; expected: 1; operator: strictEqual
```

Following gates require both tokens in light and dark, distinct from `var(--ink)` and white; `.criterion-row-copy>b` and `.criterion-fact>b` must consume their respective tokens. Grouped rows must use aria-hidden inline SVG `.grouped-evidence-icon` with `data-icon="document-check"`, `stroke="currentColor"`, no text plus/cross, fixed icon CSS, and the purpose copy `Доказательства, связанные с этим критерием`.

JUnit: `criterion-accent-evidence-icon-red.junit.xml`.
