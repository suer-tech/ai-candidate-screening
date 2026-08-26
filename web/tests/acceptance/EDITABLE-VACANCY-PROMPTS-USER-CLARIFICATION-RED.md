# VAC-041, ASM-062, TST-086 — user clarification RED baseline

## Independence and scope

- Author/executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code, main specifications and OpenSpec task checkboxes were not changed.
- The three scenarios are deterministic and synthetic; provider, network, database, Drive and browser side effects are disabled by the harness contract.

## Focused scenarios

| Scenario | Expected behavior |
|---|---|
| `VAC-041-russian-analysis-prompt-ui-copy` | Exact navigation/heading `Промпт для анализа`; legacy label and both removed explanatory texts are absent; default `candidate-assessment/v1` text is Russian, multiline and split into explicit sections and a list. |
| `VAC-041-ASM-062-vacancy-specific-prompt-snapshots` | Two vacancies persist different exact prompt snapshots and hashes; each new run pins the selected profile version of its own vacancy without cross-vacancy leakage. |
| `ASM-062-assessment-request-vacancy-prompt-routing` | The candidate-assessment LLM request contains the exact pinned vacancy prompt once; document extraction, transcription and fact extraction do not receive it. |

## Expected RED

- Captured at `2026-08-25T05:10:48.380Z` before any production changes by this subagent.
- Result: **0 passed, 3 failed, 0 infrastructure errors**.
- Failure reason for all scenarios: the production conformance boundary returns `NOT_IMPLEMENTED` for the three newly specified kinds. The failures therefore represent missing product behavior/observability, not a fixture import or infrastructure failure.

## Evidence and reproduction

- JUnit: `tests/acceptance/evidence/editable-vacancy-prompts-user-clarification-red.junit.xml`
- JSON: `tests/acceptance/evidence/editable-vacancy-prompts-user-clarification-red.json`

```powershell
cd web
node --import tsx --test --test-name-pattern="user clarification" tests/editable-vacancy-prompts.acceptance.test.mjs
node tests/editable-vacancy-prompts.evidence.mjs --scenario-prefix "user clarification" --author /root/analysis_prompt_acceptance --output tests/acceptance/evidence/editable-vacancy-prompts-user-clarification-red.json
```

Both commands intentionally exit non-zero until production behavior satisfies the new oracle.
