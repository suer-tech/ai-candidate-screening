# Five-change implementation evidence — 2026-08-19

Synthetic evidence only. This file contains no candidate content, prompt,
response, tool payload, credential, direct Drive URL, or protected trace.

Build identity: repository base `80e09f2` plus the uncommitted five-change
implementation in this worktree. Verification commands are run from `web/`.

## Independent acceptance

The executable TST-077–TST-078 and TST-086–TST-102 suites were authored by an
independent implementation subagent before the implementation was brought to
GREEN. They run through `npm run test:changes`.

## Focused evidence

- Vacancy: normalized duplicate and invalid-profile rejection, timeout-after-
  folder retry, one operation/folder/vacancy binding, and immediate active v1
  result are covered by `server/product/application.test.ts`.
- Lifecycle: processing archive rejection, optimistic race rejection, successful
  archive/delete, rejected-command audit, app-only delete and tombstone are
  covered by `server/product/application.test.ts`.
- Result preview: same-version pair publication, stale/corrupt rejection,
  preview without audit and selected-document download with export audit are
  covered by `server/product/application.test.ts`.
- Dashboard: one repository snapshot, current-result aggregation, inclusive
  UTC+5 period boundaries, insufficient ETA, latest failed exclusion and Drive
  endpoint failure behavior are covered by product and runtime tests. Status
  cards and recommendation categories open the general queue with the selected
  canonical filter; recommendation navigation preserves the selected period.
- LLM tracing: admin-only access, exact 30-day TTL, candidate-delete exception,
  per-attempt material ownership, gateway success/failure, credential exclusion,
  ordinary metadata-only incident and fail-open outage are covered by
  `server/llm/llm.test.ts`.
- The D1 migration and unique storage identities are executed by
  `server/product/d1-schema.test.ts` using an isolated in-memory SQLite database.

## Runtime boundary

An authenticated production worker without configured D1/Drive resources must
return an explicit unavailable response. It must not serve demo dashboard data,
create a local-only vacancy, mutate a local-only candidate, generate a synthetic
PDF, or expose a Drive URL. Positive production-like integration remains gated
on provisioned external resources and the four mandatory E2E scenarios.

## Verification result

- `npm run lint`: GREEN with zero errors and zero warnings.
- `npx tsc --noEmit`: GREEN.
- `npm test`: GREEN, including build, rendered worker routes, independent
  TST-077–TST-078 and TST-086–TST-102, product/server/D1, UI, transcription,
  and LLM suites.
- `openspec validate --all --strict --no-color`: GREEN, 14/14 items.
- `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, and `E2E-RESULT-001`: BLOCKED;
  executable scenarios and provisioned production-like resources are absent.
