# RouterAI generated shape — RED regression evidence

- Change: `revise-vacancy-creation-flow`
- Date: 2026-08-21
- Production implementation changed before this run: no

## Focused test

`VAC-042/VAC-043 regression: actual RouterAI field names and canonical question suffixes are normalized`

```text
npm run test:vacancy-generation:routerai:red-evidence
```

## Expected RED

One selected test executed and failed. `validateGeneratedVacancyProfile` returned:

```text
invalid structured response: canonical ABC directions required
```

The failure occurs when the first valid RouterAI direction is named `Продуктивность: <канонический вопрос>`. Therefore the implementation has not yet reached the assertions that map `resultImage`, `competencies`, `stopFactors`, and `keAdmission` to the four Russian profile sections.

The existing negative matrix remains unchanged and passes, including rejection of five random direction names. The regression test also repeats that rejection after using the RouterAI profile keys so field-key mapping cannot weaken canonical-name validation.

Machine-readable evidence: `tests/acceptance/evidence/routerai-generated-shape-red.junit.xml`.
