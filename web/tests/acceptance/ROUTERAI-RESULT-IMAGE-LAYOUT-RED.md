# RouterAI resultImage layout — RED acceptance evidence

- Change: `revise-vacancy-creation-flow`
- Requirement: `VAC-044`
- Task: `7.1`
- Date: 2026-08-21
- Production implementation changed before this run: no

## Focused test

`VAC-044: actual RouterAI resultImage uses deterministic Russian layout grammar`

```text
npm run test:vacancy-generation:result-image:red-evidence
```

## Expected RED

One selected test executed and failed. The actual editor text still contains raw keys `positionGoal`, `measurableResults`, `result`, `metrics`, and `personalContribution`; repeated spaces remain inside scalar values; top-level blocks have no blank separators; nested bullets and indentation are inconsistent.

The oracle requires:

- Russian labels `Цель должности`, `Измеримые результаты`, `Результат`, `Метрики`, `Личный вклад`;
- exactly one empty line between adjacent top-level blocks;
- stable bullets and indentation for result arrays and nested metrics;
- trimmed scalar values with every internal whitespace run collapsed to one space;
- no raw camelCase keys in persisted editor text.

Machine-readable evidence: `tests/acceptance/evidence/routerai-result-image-layout-red.junit.xml`.
