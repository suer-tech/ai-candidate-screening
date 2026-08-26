# revise-vacancy-creation-flow — RED timeline

- `2026-08-20T08:00Z` — Read project documentation, all main specs, apply skill instructions, OpenSpec status/instructions and every reported context file.
- `2026-08-20T08:04Z` — Diagnosed the opposite baseline: first action is `Продолжить`; step 2 advertises `Стандартный ABC-профиль … без LLM-генерации`; final action is `Сохранить вакансию`.
- `2026-08-20T08:09Z` — Replaced old TST-086–TST-088 with 14 executable scenarios and synthetic fixtures. No production file was edited.
- `2026-08-20T08:10Z` — `npm run test:vacancy-creation:red`: 14 executed, 0 passed, 14 failed, 0 skipped.
- `2026-08-20T08:10Z` — UI failure observed: expected `Сформировать вакансию`, actual buttons `×`, `Отмена`, `Продолжить`.
- `2026-08-20T08:10Z` — Server scenarios observed `NOT_IMPLEMENTED`: `server/product/application.ts` loaded, but does not export `runVacancyCreationConformanceScenario(fixture)` and exposes no generation/retry/preview oracle result.
- `2026-08-20T08:10Z` — JUnit evidence written to `revise-vacancy-creation-flow-red.junit.xml`; 14 testcase and 14 failure elements verified.
- `2026-08-20T08:10Z` — Syntax checks passed for test, harness and fixture. RED is not caused by syntax, import resolution or invalid fixtures.

Release meaning: expected ATDD RED. Production implementation must satisfy the oracle without weakening it.
