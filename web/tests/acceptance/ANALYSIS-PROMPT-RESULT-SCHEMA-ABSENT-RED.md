# VacancySettings result schema must be absent — RED baseline

## Independence

- Author/executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code and OpenSpec artifacts were not changed.
- The test renders the real exported `VacancySettings` from `web/app/page.tsx` with synthetic data.

## Updated acceptance contract

After opening `Промпт для анализа`, the real section MUST contain none of the following:

1. a button or disclosure control whose label refers to the result schema;
2. a result-schema `region`;
3. any `pre` schema block;
4. the visible text `Схема результата анализа`.

This replaces the earlier disclosure requirement; the new oracle asserts absence directly and does not preserve the old collapsed/expanded expectations.

## Expected RED

- Captured at `2026-08-25T06:07:48.9575312Z`.
- Result: **0 passed, 1 failed, 0 infrastructure errors**.
- Failure: the current real section contains one result-schema button/disclosure control (`expected 0, actual 1`).
- JUnit: `tests/acceptance/evidence/analysis-prompt-result-schema-absent-red.junit.xml`.

```powershell
cd web
node --import tsx --test --test-name-pattern="does not expose the result schema" tests/editable-vacancy-prompts.acceptance.test.mjs
```

The focused command exits with code `1` until production removes the schema UI.
