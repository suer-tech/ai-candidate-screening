# VacancySettings result schema must be absent — GREEN evidence

## Independence

- Executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code and OpenSpec artifacts were not changed during verification.
- The same absence oracle that produced the RED baseline was rerun without weakening assertions.

## Preserved oracle

After opening the real rendered `Промпт для анализа` section, the test requires:

1. zero buttons or disclosure controls whose label refers to the result schema;
2. zero result-schema regions;
3. zero `pre` schema blocks;
4. no visible text `Схема результата анализа`.

## GREEN results

- Captured at `2026-08-25T06:10:40.7169812Z`.
- Focused absence test: **1 passed, 0 failed**.
- Full editable-vacancy-prompts regression: **13 passed, 0 failed**.
- Infrastructure errors: **0**.

## Evidence

- Focused JUnit: `tests/acceptance/evidence/analysis-prompt-result-schema-absent-green.junit.xml`
- Full-suite JUnit: `tests/acceptance/evidence/editable-vacancy-prompts-schema-absent-green.junit.xml`

```powershell
cd web
node --import tsx --test --test-name-pattern="does not expose the result schema" tests/editable-vacancy-prompts.acceptance.test.mjs
npm run test:editable-vacancy-prompts
```
