# Vacancy version badge contract — GREEN evidence

## Independence

- Executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code and OpenSpec artifacts were not changed during verification.
- The same real-component oracle that produced the RED baseline was rerun without weakening assertions.

## Preserved oracle

1. `VacancySettings` heading equals only the vacancy title and contains no `· версия N`.
2. The real top vacancy header shows a separate compact `Профиль vN` badge grouped beside the activity badge.
3. No standalone version copy remains elsewhere in that header.
4. `Папка Google Drive связана` is absent from the real vacancy view.

## GREEN results

- Captured at `2026-08-25T07:18:43.6430588Z`.
- Focused Node test output: **5 passed, 0 failed** including the parent header test; JUnit contains its **4 passing leaf cases**.
- Full editable-vacancy-prompts output: **18 passed, 0 failed** including the parent header test; JUnit contains **17 passing leaf cases**.
- Infrastructure errors: **0**.

## Evidence

- Focused JUnit: `tests/acceptance/evidence/vacancy-version-badge-contract-green.junit.xml`
- Full-suite JUnit: `tests/acceptance/evidence/editable-vacancy-prompts-version-badge-green.junit.xml`

```powershell
cd web
node --import tsx --test --test-name-pattern="vacancy version badge contract" tests/editable-vacancy-prompts.acceptance.test.mjs
npm run test:editable-vacancy-prompts
```
