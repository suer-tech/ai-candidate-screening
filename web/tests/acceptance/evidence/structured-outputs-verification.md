# Structured Outputs verification — 2026-08-26

## Focused acceptance

- Command: `npx tsx --test tests/structured-outputs.acceptance.test.ts`
- Result: 6 passed, 0 failed.
- Machine-readable evidence: `structured-outputs-green.junit.xml`.

## Repository regression suite

- Command: `npm test`
- Structured-output regressions found in four legacy runtime fixtures were corrected by declaring `ROUTERAI_STRUCTURED_OUTPUTS=true` explicitly.
- The subsequent run reached the provisioned PostgreSQL integration boundary. All completed tests passed, but the command exited with two environment failures because PostgreSQL rejected the configured `hh_agent` credentials with SQLSTATE `28P01`.
- The failures were `matrix-postgres-repository.integration.test.ts` and `production-runtime.integration.test.ts`; neither reached structured-output application behavior.

## Required provisioned E2E

- Command: `npm run e2e:required`
- Result: not executed; Playwright configuration failed closed before scenario discovery.
- Missing external configuration: `E2E_BASE_URL`, `E2E_AUTH_STORAGE_STATE`, `E2E_PREFLIGHT_TOKEN`, `E2E_CONTROL_URL`, `E2E_CONTROL_TOKEN`, `E2E_FIXTURE_SET_ID`, `E2E_BUILD_ID`, `E2E_ENVIRONMENT`, and `E2E_ALLOW_DESTRUCTIVE_CLEANUP`.
- Therefore `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, and `E2E-RESULT-001` have no green evidence in this workspace. Production readiness is not claimed.
