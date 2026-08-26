# Vacancy version badge contract — RED baseline

## Independence

- Author/executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code and OpenSpec artifacts were not changed.
- Tests transpile and render the real `VacancySettings` and `Vacancies` components from `web/app/page.tsx` with synthetic vacancy data.

## Acceptance contract

1. The settings heading contains exactly the vacancy title and no `· версия N` suffix.
2. The top vacancy header retains the activity badge and shows a separate compact `Профиль vN` badge grouped beside it.
3. No standalone `Профиль vN` or `Версия N` copy remains elsewhere in the top header.
4. The text `Папка Google Drive связана` is absent from the real vacancy view.

## Expected RED

- Captured at `2026-08-25T07:15:45.3105099Z`.
- Focused result: **0 passed, 5 failed, 0 infrastructure errors**. The count includes the parent header test and its three independently reported subtests.
- Observed product gaps:
  - settings heading is `Синтетическая вакансия · версия 7`, not just `Синтетическая вакансия`;
  - no separate `Профиль v7` badge exists beside `Активна`;
  - one old standalone version line remains in the header;
  - `Папка Google Drive связана` is still visible.

## Evidence

- JUnit: `tests/acceptance/evidence/vacancy-version-badge-contract-red.junit.xml`

```powershell
cd web
node --import tsx --test --test-name-pattern="vacancy version badge contract" tests/editable-vacancy-prompts.acceptance.test.mjs
```

The focused command intentionally exits with code `1` until production satisfies the contract.
