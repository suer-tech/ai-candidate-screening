# VIS-DEMO criterion chevron SVG — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="criterion chevron uses a centered symmetric inline SVG" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 1 test, 0 passed, 1 failed.

Exact failure:

```text
AssertionError [ERR_ASSERTION]: chevron tile contains one semantic inline SVG icon
0 !== 1
actual: 0
expected: 1
operator: strictEqual
```

The corrected oracle requires `.criterion-row-chevron-icon` to be an inline SVG with a square `0 0 16 16` viewBox and horizontally symmetric path. It also checks fixed square CSS dimensions, `display:block`, a 26×26 grid-centered tile, no text `⌄`, no `translateY` font-metric hacks, and retained 180-degree open-state rotation without positional offsets.

JUnit: `criterion-chevron-svg-red.junit.xml`.
