# VacancySettings result-schema disclosure — RED baseline

## Independence

- Author/executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code and OpenSpec artifacts were not changed.
- The test transpiles and renders the real exported `VacancySettings` from `web/app/page.tsx` with synthetic data.

## Acceptance contract

In the real `Промпт для анализа` section the test requires:

1. an accessible button whose visible label identifies the result schema;
2. `aria-expanded=false` and no rendered schema region initially;
3. expansion after a click with `aria-expanded=true`;
4. a labelled `Схема результата анализа` region;
5. a multiline formatting-preserving `pre` block exposing assessment-schema fields;
6. no `input`, `textarea` or `select` inside the schema region.

## Expected RED

- Captured at `2026-08-25T05:50:50.3006128Z`.
- Result: **0 passed, 1 failed, 0 infrastructure errors**.
- First missing behavior: the opened real analysis-prompt section has no accessible result-schema disclosure control.
- JUnit: `tests/acceptance/evidence/analysis-prompt-result-schema-disclosure-red.junit.xml`.

```powershell
cd web
node --import tsx --test --test-name-pattern="result schema disclosure" tests/editable-vacancy-prompts.acceptance.test.mjs
```

The command intentionally exits with code `1` until production implements the disclosure.
