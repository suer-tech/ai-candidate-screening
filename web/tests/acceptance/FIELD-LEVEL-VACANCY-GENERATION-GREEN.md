# VAC-042–VAC-046 — field-level vacancy generation GREEN evidence

## Independence

- Executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- Production code, OpenSpec artifacts and task checkboxes were not changed during verification.
- The RED oracle was rerun without removing, weakening or rewriting assertions.

## GREEN results

- Captured machine evidence at `2026-08-25T08:02:51.822Z`.
- Focused real UI/server output: **13 passed, 0 failed**; focused JUnit contains **12 passing leaf cases**.
- Machine conformance: **5 GREEN, 0 RED, 0 infrastructure errors**.
- Consolidated related regression: **66 passed, 0 failed** in Node output; JUnit contains **62 passing leaf cases** after excluding parent suite containers.

## Preserved VAC-042–VAC-046 coverage

- Four empty-field generation flows, filled-field hiding, confirmation, spinner, one request, atomic draft-only application, error preservation and no autosave/reload.
- Five operation-specific vacancy-scoped prompts, Russian structured defaults with exact titles, persistence/isolation and exact prompt snapshot in the matching LLM request.
- ABC one-shot generation over mixed standard/custom, reduced and zero direction compositions with exact identity/order/count and no zero-direction request.
- Full-generation overwrite warning and cancellation with no API/provider/draft/version side effect.
- Unified dirty guard for settings/internal transitions and beforeunload, including close, discard, save success and save failure semantics.

## Related regression suites

| Suite | Result |
|---|---:|
| Editable vacancy prompts | 18/18 |
| ABC save/UI acceptance | 11/11 |
| Server product application | 10/10 |
| Canonical vacancy generation | 6/6 |
| ABC validation | 8/8 |

No real product gaps were observed in the requested scope.

## Evidence and reproduction

- Focused JUnit: `tests/acceptance/evidence/field-level-vacancy-generation-green.junit.xml`
- Machine JSON: `tests/acceptance/evidence/field-level-vacancy-generation-green.json`
- Consolidated regression JUnit: `tests/acceptance/evidence/field-level-vacancy-generation-related-regression-green.junit.xml`

```powershell
cd web
node --import tsx --test tests/field-level-vacancy-generation.acceptance.test.mjs
node tests/field-level-vacancy-generation.evidence.mjs --output tests/acceptance/evidence/field-level-vacancy-generation-green.json
npm run test:editable-vacancy-prompts
node --import tsx --test tests/vacancy-abc-profile.acceptance.test.mjs tests/vacancy-abc-profile.ui.test.mjs
npm run test:server-product
npm run test:vacancy-generation:canonical
npm run test:abc
```
