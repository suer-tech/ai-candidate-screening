# VAC-040/VAC-041, ASM-062, SEC-011, TST-086 — editable vacancy prompts RED baseline

## Independence declaration

- Author and executor: independent acceptance subagent `/root/prompt_acceptance`.
- The author did not participate in production implementation and changed no production source, database schema, main specification or OpenSpec task checkbox.
- Change under test: `add-editable-vacancy-prompts`.
- Oracle source: the complete change context and applicable main specifications. Production code was read only to locate the observable conformance boundary and classify the RED result.

## Scope and safety

- Six deterministic scenarios use fixture set `editable-vacancy-prompts-synthetic-v1`.
- No provider, network, database, Drive or real browser side effect is permitted by the fixture contract.
- Inputs contain only synthetic vacancy/user/run identifiers. Credential-like sentinel strings verify that prompt text and secrets cannot enter evidence.
- Machine evidence is rejected if either sentinel is serialized.
- The adapter contract is `runEditableVacancyPromptsConformanceScenario(fixture)` exported by `server/product/application.ts`. Absence is an observable product `NOT_IMPLEMENTED` result, not an import, syntax or fixture error.

## Covered behavior

| Scenario | Requirements | Acceptance oracle |
|---|---|---|
| `VAC-040-generation-confirmation-ui` | VAC-040, TST-086 | Top action order; prompt modal; separate confirmation; no LLM before consent; cancellation preserves the prompt; one launch; disabled action and spinner; all five sections; ready toast; optional audio failure is harmless. |
| `VAC-040-generation-api-snapshot` | VAC-040, SEC-011, TST-086 | Exact normalized one-run prompt snapshot; `vacancy-profile/v1`; SHA-256; CSRF and vacancy access; operation/hash conflict; invalid input causes no provider call. |
| `VAC-041-analysis-prompt-ui` | VAC-041, TST-086 | Sixth local section after `Допуск к КЕ`; default `candidate-assessment/v1`; new-runs-only explanation; reset/save; invalid or failed save preserves the draft and creates no version. |
| `VAC-041-ASM-062-versioned-analysis-prompt` | VAC-041, ASM-062, TST-086 | Exactly one new immutable profile version; historical fallback; old and new runs keep their own exact snapshots; extraction/transcription/fact stages do not receive the analysis prompt. |
| `ASM-062-protected-runtime-composition` | ASM-062, TST-086 | Immutable envelope has priority over hostile HR text; schema/evidence checks remain active; missing/tampered snapshots and nonconforming output fail with controlled codes and no current-prompt fallback. |
| `SEC-011-prompt-access-audit-log-safety` | SEC-011, TST-086 | Inaccessible vacancy fails closed without metadata; size limit precedes provider; audit has actor/vacancy/action/artifact/hash metadata; prompt text, cookies, tokens and secrets do not enter ordinary logs or public errors. |

## Expected RED captured before production changes

- Timestamp: `2026-08-24T04:57:51.177Z`.
- Result: **0 passed, 6 failed, 0 skipped/cancelled, 0 infrastructure errors**.
- Failure class: `EDITABLE_VACANCY_PROMPTS_CONFORMANCE_NOT_IMPLEMENTED` — the production adapter export is absent, so every independently specified behavior remains RED.
- This is the expected ATDD baseline. It is not evidence of implementation completion.

## Evidence and reproduction

- Human-readable baseline: this file.
- Captured focused console output: `tests/acceptance/evidence/editable-vacancy-prompts-red-console.txt`.
- Machine-readable result: `tests/acceptance/evidence/editable-vacancy-prompts-red.json`.
- JUnit: `tests/acceptance/evidence/editable-vacancy-prompts-red.junit.xml`.

```powershell
cd web
npm run test:editable-vacancy-prompts
npm run test:editable-vacancy-prompts:red-evidence
npm run test:editable-vacancy-prompts:red
```

Each command intentionally exits non-zero while the product contract is RED. The focused suite is also included in `npm run test:changes`, so it cannot be omitted from the project regression path after implementation.
