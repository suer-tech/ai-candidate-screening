# VAC-041, ASM-062, TST-086 — user clarification GREEN

## Independence

- Author/executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code and OpenSpec artifacts were not changed by this subagent.
- Inputs are synthetic and contain no personal data or secrets.

## Result

- Captured at `2026-08-25T05:15:36.788Z`.
- Focused result: **5 passed, 0 failed, 0 skipped, 0 infrastructure errors**.
- Three conformance scenarios passed; two additional tests exercised real production boundaries directly.

## Direct production-boundary coverage

1. The real exported `VacancySettings` from `web/app/page.tsx` is transpiled and rendered with the existing React acceptance harness. The test opens the actual analysis-prompt section and verifies:
   - exact navigation label, heading and field label `Промпт для анализа`;
   - absence of legacy `Промпт анализа` in the opened section;
   - absence of `Инструкция анализа кандидатов`;
   - absence of the removed full versioning notice.
2. The real `candidate-assessment/v1` artifact and `prompt-contracts.ts` functions are imported. The test verifies Russian text, four explicit headings, a readable list, exact single insertion of the vacancy snapshot and protected composition order.
3. The production candidate runtime boundary is inspected to verify that `agent_runs.analysis_prompt_*` is read and composed inside the `assessment` capability, with one call site, while the preceding document/transcription/fact stages do not read `analysis_prompt_text`.

## Evidence

- JUnit for all five focused tests: `tests/acceptance/evidence/editable-vacancy-prompts-user-clarification-green.junit.xml`
- JSON for the three conformance scenarios: `tests/acceptance/evidence/editable-vacancy-prompts-user-clarification-green.json`

```powershell
cd web
node --import tsx --test --test-name-pattern="user clarification" tests/editable-vacancy-prompts.acceptance.test.mjs
```
