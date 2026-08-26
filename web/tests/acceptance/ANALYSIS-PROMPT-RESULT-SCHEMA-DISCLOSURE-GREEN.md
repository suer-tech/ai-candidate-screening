# VacancySettings result-schema disclosure — GREEN evidence

## Independence

- Executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code and OpenSpec artifacts were not changed during verification.
- The same oracle that produced the RED baseline was rerun without removing or relaxing assertions.

## Preserved oracle

The test still requires all of the following from the real rendered `VacancySettings`:

1. an accessible result-schema disclosure button;
2. `aria-expanded=false` and no schema region before interaction;
3. `aria-expanded=true` after clicking;
4. a region labelled `Схема результата анализа`;
5. a multiline `pre` block containing assessment result fields;
6. no editable `input`, `textarea` or `select` inside that region.

## GREEN results

- Captured at `2026-08-25T05:59:54.8398260Z`.
- Focused disclosure test: **1 passed, 0 failed**.
- Full editable-vacancy-prompts regression: **13 passed, 0 failed**.
- Infrastructure errors: **0**.

## Evidence

- Focused JUnit: `tests/acceptance/evidence/analysis-prompt-result-schema-disclosure-green.junit.xml`
- Full-suite JUnit: `tests/acceptance/evidence/editable-vacancy-prompts-with-schema-disclosure-green.junit.xml`

```powershell
cd web
node --import tsx --test --test-name-pattern="result schema disclosure" tests/editable-vacancy-prompts.acceptance.test.mjs
npm run test:editable-vacancy-prompts
```
