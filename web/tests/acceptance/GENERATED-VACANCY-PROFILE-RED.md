# Canonical generated vacancy profile — RED acceptance evidence

- Change: `revise-vacancy-creation-flow`
- Requirement: `VAC-042`, `VAC-043`
- Task: `6.1`
- Date: 2026-08-21
- Production implementation changed before the run: no

## Focused command

```text
npm run test:vacancy-generation:canonical
```

## Expected RED result

Four tests executed: one passed and three failed.

1. Canonical happy path passed: exactly five directions in the required order are already accepted.
2. Negative ABC matrix failed: `validateGeneratedVacancyProfile` accepted the first invalid case with five random names instead of rejecting it. The same test also defines missing, extra, duplicate and reordered cases.
3. Structured section normalization failed: `Образ результата` was flattened to one string joined with `; ` instead of separate readable lines. The test covers arrays and nested objects in all four required sections and verifies leaf order/content preservation.
4. Vacancy settings UI failed: the multiline textarea had no explicit `wrap="soft"`; the same test also requires newline round-trip plus `white-space: pre-wrap` and long-token wrapping in CSS.

Machine-readable evidence: `tests/acceptance/evidence/generated-vacancy-profile-red.junit.xml`.
