# Mandatory production E2E harness

This directory contains the executable release harness for `E2E-VAC-001`,
`E2E-TRN-001`, `E2E-ABC-001`, and `E2E-RESULT-001`. It is intentionally not a
local demo test: missing identity, D1, R2, Google Drive, LLM, STT, Telegram, or
test-control infrastructure blocks the run before Chromium starts.

The main E2E uses the deterministic RouterAI-compatible test gateway required by
the canonical quality specification. Preflight also performs separate smoke
checks against the configured real LLM and STT providers. A demo fallback is
not accepted for either boundary.

## Commands

```bash
npm run e2e:install
npm run e2e:preflight
npm run e2e:required
```

`e2e:preflight` exits with code `2` and a component-level `BLOCKED` diagnostic
when the environment is incomplete. A blocked or skipped run is never reported
as a passed release gate. `npm run test:e2e-harness` tests only the local
configuration and readiness logic; it is not production acceptance.

## Required runner configuration

All values are supplied by the CI secret/configuration boundary and must not be
committed:

- `E2E_BASE_URL`: HTTPS URL of the provisioned staging or preproduction app.
- `E2E_AUTH_STORAGE_STATE`: Playwright storage state for an authorized synthetic
  HR identity. Keep the file outside version control.
- `E2E_PREFLIGHT_TOKEN`: token for the protected app readiness endpoint.
- `E2E_CONTROL_URL` and `E2E_CONTROL_TOKEN`: protected test-control plane.
- `E2E_FIXTURE_SET_ID`: immutable synthetic fixture set known to the control
  plane.
- `E2E_BUILD_ID`: exact deployed build under test.
- `E2E_ENVIRONMENT`: `staging` or `preproduction`; production is rejected.
- `E2E_ALLOW_DESTRUCTIVE_CLEANUP=true`: explicit permission to delete isolated
  test data from application storage, Drive, and external providers.

The deployed app separately requires `DB`, `PROTECTED_LLM_TRACES`, Drive
integration values, `LLM_RUNTIME_CONFIG_JSON` plus its referenced secrets,
`ASSEMBLYAI_API_KEY`, `E2E_PREFLIGHT_TOKEN`, and the four real-provider smoke
URL/token pairs. Runtime secrets must never be placed in Playwright output.

The Drive health endpoint must return HTTP 2xx with
`{"connected":true,"providerMode":"real","permissions":{"readInputs":true,"createOutputs":true,"manageMembers":false}}`.
Each LLM/STT smoke endpoint accepts an authenticated `POST` probe and must
return HTTP 2xx with `{"ready":true,"providerMode":"real"}` only after a real
provider request succeeds. Neither contract may report readiness from static
configuration alone.

## Test-control contract

The external control plane provisions synthetic inputs in the real Shared Drive,
observes the deployed workflow, exposes non-sensitive acceptance evidence, and
performs test-only cleanup. It is not linked into product runtime code.
It also owns the independent second synthetic HR identity used for the cross-HR
access matrix; the application storage state belongs only to the browser actor.

- `POST /preflight` attests the fixture digest, production-like mode, real LLM
  and STT smoke, deterministic test gateway, and all declared capabilities.
- `POST /runs` creates an isolated run for the supplied fixture/build/prefix.
- `POST /runs/{runId}/vacancy` binds the UI-created vacancy to the run.
- `POST /runs/{runId}/candidates` places the immutable synthetic inputs in the
  vacancy's real Drive folder.
- `GET /runs/{runId}` returns observable workflow status and current result
  version; it must return terminal `FAILED` immediately rather than hiding it.
- `GET /runs/{runId}/evidence/{vacancy|transcript|abc|result}` returns only the
  IDs, counts, hashes, boolean attestations, timings, and synthetic oracle
  matches asserted in `required.spec.mjs`. It must derive them from deployed
  app/provider state, not return hard-coded success.
- `GET /runs/{runId}/evidence/{versioning|failure-matrix|run}` verifies the
  controlled mutation/failure cases and complete reproducibility metadata.
- `POST /runs/{runId}/evidence/report-publication` safely verifies idempotent
  same-version publication and `REPORT_VERSION_CONFLICT` inside the isolated
  run.
- `POST /runs/{runId}/cleanup` removes all data created by the harness, including
  the synthetic source folder in Drive. This test-only cleanup is distinct from
  the product's candidate-delete behavior, which never deletes Drive files.

The run is serial against one build and configuration. Cleanup executes even
after a failed scenario and must attest removal from application storage, Drive,
derived artifacts, and providers. Screenshots, video, trace, JSON report, run ID,
build ID, and safe evidence are retained on failure; fixtures contain no real
PII and evidence must contain no credentials, raw prompts, or protected trace
content.

## CI entrypoint

`.github/workflows/production-e2e.yml` is both manually dispatchable and
reusable from a release workflow. It decodes the protected HR storage state,
runs preflight before Chromium, always uploads Playwright evidence for 30 days,
and relies on the suite's mandatory cleanup. Repository and environment secrets
must be provisioned before invocation; an unconfigured invocation fails rather
than skipping acceptance.
