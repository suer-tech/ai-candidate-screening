# TST-086–TST-088 — revised create-vacancy acceptance baseline

## Independence declaration

- Author: independent acceptance subagent `/root/vacancy_creation_red`.
- Executor: the same independent acceptance subagent in the local workspace.
- Declaration: the author did not implement the production create-vacancy flow and changed no production code, main specification or unrelated OpenSpec task.
- Change under test: `revise-vacancy-creation-flow`.
- Oracle source: the complete change context plus applicable main specifications; current production code was inspected only to diagnose the RED result.

## Shared preconditions and data

- Node.js `v24.14.0`; commands run from `web/`.
- Synthetic title prefix: `ACCEPT-VAC-20260820`.
- Synthetic generation operation: `vacancy-generation-op-synthetic-001`.
- Synthetic final-save operation: `vacancy-final-save-op-synthetic-001`.
- Controlled provider outcomes contain no real personal data, secrets, raw provider response or internal instruction.
- The production conformance boundary is `runVacancyCreationConformanceScenario(fixture)` exported by `server/product/application.ts`. Its absence is reported as observable `NOT_IMPLEMENTED`, not an import or fixture exception.

## TST-086 — generation, editor and exact confirmation

- Related requirements: VAC-014, VAC-019, VAC-030–VAC-034, VAC-037, VAC-040–VAC-041, TST-086.
- Goal: prove that a manually entered unique title starts mandatory server-side LLM generation and only a valid result can enter the editable, previewed and explicitly confirmed flow.
- Steps and expected results:
  1. Open `Новая вакансия`: exactly one profile field, `Название вакансии`, and action `Сформировать вакансию` are visible; criteria are absent.
  2. Submit `  бизнес   ассистент ` while `Бизнес ассистент` exists: server normalizes before any LLM or Drive call and rejects `VACANCY_TITLE_DUPLICATE` without persistence.
  3. Run four controlled cases which succeed on attempts 1, 2, 3 and 4: all calls in a case use one operation ID; retries require no HR action; exactly one editor opens; Drive call count is zero.
  4. Before valid structured output, editor is unavailable. After success, generated fields and `Требует решения HR` markers are editable.
  5. Confirm reset: restore the last valid LLM snapshot without a model call. Confirm discard/navigation and reload: clear unsaved state without vacancy/version/draft.
  6. Preview assessment rules and report structure, explicitly confirm the exact snapshot hash, edit any field and verify confirmation is invalidated until a new preview and confirmation.
- Postconditions/cleanup: no persistent object exists before final save; all fixtures are in-memory synthetic values.
- Actual result: RED. Current UI exposes `Продолжить`, and the server LLM conformance boundary is absent.
- Evidence: `evidence/revise-vacancy-creation-flow-red.junit.xml`, cases 1–5.
- Status: FAILED (expected RED).

## TST-087 — retry, terminal safety and no fallback

- Related requirements: VAC-031–VAC-032, VAC-037–VAC-038, VAC-040–VAC-041, TST-087.
- Goal: prove bounded automatic recovery and a safe terminal state that never falls back to a manual or template editor.
- Steps and expected results:
  1. For timeout, network error, HTTP 429, HTTP 500, HTTP 503 and invalid structured output, observe initial attempt plus exactly three automatic retries with one operation ID.
  2. For authentication and configuration errors, observe one attempt and zero automatic retries; public error contains neither raw response nor secret.
  3. Double-click during an active request: one operation and one parallel provider call; submit is disabled and current attempt is visible.
  4. Exhaust four retryable attempts: understandable safe message includes attempt count and `Повторить генерацию`; title remains only in browser session.
  5. Verify no editor, manual template, vacancy, version, persistent draft or Drive call exists after any unsuccessful generation.
  6. Explicit retry later starts a new operation, preserves the title and opens one editor only after a valid structured response.
- Postconditions/cleanup: unsuccessful operations leave no persistent product or Drive artifacts.
- Actual result: RED. No executable server generation/retry contract exists; current UI instead transitions to a non-LLM template editor.
- Evidence: `evidence/revise-vacancy-creation-flow-red.junit.xml`, cases 6–10.
- Status: FAILED (expected RED).

## TST-088 — idempotent final save and Drive recovery

- Related requirements: VAC-014, VAC-019, VAC-034, INT-040, TST-088.
- Goal: prove one externally atomic visible outcome across repeated final-save delivery and unknown Drive outcomes.
- Steps and expected results:
  1. Deliver `Сохранить и активировать` twice with the same operation ID and confirmed snapshot: exactly one active vacancy, one immutable version 1, one folder and one binding; HR edits survive; intake/analysis visibility begins only after commit.
  2. During all generation attempts, preview and confirmation, observe zero Drive calls; first folder provisioning occurs inside final save.
  3. Simulate timeout after folder creation, retry the same operation, reconcile before another create and reuse `drive-folder-synthetic-001`; no vacancy/version/folder duplicates.
  4. Exhaust Drive provisioning: show an understandable safe retry; expose no active/intake/analysis vacancy and no duplicates.
- Postconditions/cleanup: controlled in-memory objects only; no external Drive mutation is made by this RED suite.
- Actual result: RED. Existing `createVacancy` has direct manual-profile persistence and Drive provisioning, but no generated-snapshot confirmation contract or conformance evidence for unknown-outcome recovery.
- Evidence: `evidence/revise-vacancy-creation-flow-red.junit.xml`, cases 11–14.
- Status: FAILED (expected RED).

## Execution

```text
npm run test:vacancy-creation:red
npm run test:vacancy-creation:evidence
```

Result at `2026-08-20T08:10:52.9895951Z`: 14 tests, 0 passed, 14 failed, 0 skipped. The focused suite loaded and executed all test, fixture and production modules successfully; failures are behavioral assertions only.
