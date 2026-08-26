# VAC-040/VAC-041, ASM-062, SEC-011, TST-086 — editable vacancy prompts GREEN evidence

## Independence and oracle integrity

- Executor: independent acceptance subagent `/root/prompt_acceptance`, author of the pre-production RED acceptance baseline and not a participant in production implementation.
- Change under test: `add-editable-vacancy-prompts`.
- The production implementation, main specifications, OpenSpec task checkboxes, acceptance test and oracle fixtures were not changed during GREEN verification.
- Oracle SHA-256 values before and after the run were identical:
  - `tests/editable-vacancy-prompts.acceptance.test.mjs`: `E4F16EEE85EE74B5777AE1A05E0D80A29261F831429F4DA8ED33A72736ADE7E1`
  - `tests/fixtures/editable-vacancy-prompts/synthetic-conformance.mjs`: `F87CFD062066A7976DA19473483029EC4135FE70795F5256CF4CB3997F101E32`
  - `tests/helpers/editable-vacancy-prompts-conformance-harness.mjs`: `524D16879C4BFB849EA12E8239DF43D1EA188C598EE8CC86A2983D1BAFA6A08C`

## Result

- Timestamp: `2026-08-24T05:06:14.494Z`.
- Focused suite: **6 passed, 0 failed, 0 skipped, 0 cancelled**.
- Machine evidence: **6 GREEN, 0 RED, 0 infrastructure errors**.
- The focused runner, JUnit runner and JSON evidence generator each exited with code `0`.

| Scenario | Requirements | Result |
|---|---|---:|
| `VAC-040-generation-confirmation-ui` | VAC-040, TST-086 | GREEN |
| `VAC-040-generation-api-snapshot` | VAC-040, SEC-011, TST-086 | GREEN |
| `VAC-041-analysis-prompt-ui` | VAC-041, TST-086 | GREEN |
| `VAC-041-ASM-062-versioned-analysis-prompt` | VAC-041, ASM-062, TST-086 | GREEN |
| `ASM-062-protected-runtime-composition` | ASM-062, TST-086 | GREEN |
| `SEC-011-prompt-access-audit-log-safety` | SEC-011, TST-086 | GREEN |

The unchanged oracle covers action order, prompt modal and separate confirmation, absence of LLM calls before confirmation, one normalized snapshot, pending spinner and duplicate-launch protection, five populated sections, success toast, harmless optional-audio failure, analysis prompt/version/run isolation, protected runtime composition, access control, audit metadata and safe logs/errors.

## Evidence safety

- Fixture set: `editable-vacancy-prompts-synthetic-v1`; no provider, network, database or Drive effect is permitted.
- JSON generation rejects serialization of the full synthetic prompt and both secret/cookie sentinels.
- A separate scan across GREEN JSON, JUnit, console and readable evidence found zero occurrences of either fixed secret/cookie sentinel or either full synthetic prompt line.
- No real personal data, provider response or credential is present in the evidence.

## Artifacts and reproduction

- JSON: `tests/acceptance/evidence/editable-vacancy-prompts-green.json`
- JUnit: `tests/acceptance/evidence/editable-vacancy-prompts-green.junit.xml`
- Console: `tests/acceptance/evidence/editable-vacancy-prompts-green-console.txt`

```powershell
cd web
npm run test:editable-vacancy-prompts
npm run test:editable-vacancy-prompts:green-evidence
npm run test:editable-vacancy-prompts:green-json
```

This evidence closes the focused task 7.1 verification only. Full regression, required provisioned E2E and manual local/VPS checks remain separate release gates.
