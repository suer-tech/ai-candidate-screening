# VAC-042–VAC-046 — field-level vacancy generation RED baseline

## Independence

- Author/executor: independent acceptance subagent `/root/analysis_prompt_acceptance`.
- The author did not change production code, OpenSpec artifacts or task checkboxes.
- Change under test: `add-field-level-vacancy-generation`.
- Fixtures are synthetic and permit no provider, database, network or personal-data side effects.

## Executable boundaries

- Server/application contract: `runFieldLevelVacancyGenerationConformanceScenario(fixture)` exported from `server/product/application.ts`.
- UI contract: the real `VacancySettings`, `Vacancies` and `VacancyGenerationPromptModal` compiled from `app/page.tsx` through the existing React acceptance harness.
- Test doubles replace only React runtime/browser effects and controlled HTTP responses; production handlers, conditions and state updates remain the code under test.

## Covered behavior

| Requirement | Acceptance coverage |
|---|---|
| VAC-042 | All four supported fields; empty-only action; confirmation/cancel; one request; spinner and double-submit lock; atomic selected-field draft update; no reload/autosave/version; error preservation and retry. |
| VAC-043 | Five independent field/ABC prompts; Russian structured defaults with exact vacancy title; operation/vacancy persistence isolation; exact saved prompt once in the matching LLM request. |
| VAC-044 | One-shot ABC over mixed standard/custom, reduced and zero compositions; exact ids, names, origins, order and count; atomic grades; mismatch rejection; zero directions cause no request. |
| VAC-045 | Existing all-generation action; warning explicitly covers all sections and overwrite of populated values; cancel causes no API/provider/draft/version effect. |
| VAC-046 | Manual and generated dirty state; settings/internal transitions; beforeunload only while dirty; red `Не сохранять`, blue `Сохранить изменения`, close; discard/save success/save failure semantics. |

## Expected RED

- Captured at `2026-08-25T07:45:22.296Z` before production implementation.
- Node focused output: **0 passed, 13 failed, 0 infrastructure errors** including parent/subtests.
- JUnit contains **12 failing leaf cases**.
- Machine conformance summary: **0 GREEN, 5 RED, 0 infrastructure errors**.

Observed first-order gaps:

- the field-level server conformance boundary is absent for VAC-042–VAC-046;
- none of the four empty real fields exposes a generation action;
- the real ABC section exposes no ABC generation action;
- the real all-generation warning does not explicitly mention all sections;
- the real settings section changes without opening the dirty-navigation dialog.

## Evidence and reproduction

- JSON: `tests/acceptance/evidence/field-level-vacancy-generation-red.json`
- JUnit: `tests/acceptance/evidence/field-level-vacancy-generation-red.junit.xml`

```powershell
cd web
node --import tsx --test tests/field-level-vacancy-generation.acceptance.test.mjs
node tests/field-level-vacancy-generation.evidence.mjs --output tests/acceptance/evidence/field-level-vacancy-generation-red.json
```

Both commands intentionally exit with code `1` while the product contract is RED.
