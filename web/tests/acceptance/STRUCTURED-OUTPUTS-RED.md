# INT-023–INT-025, VAC-040 — Structured Outputs RED baseline

## Independence and safety

- Author/executor: independent acceptance subagent `/root/structured_outputs_acceptance`.
- Change under test: `migrate-llm-structured-outputs`.
- The author did not edit application implementation, main specs, change artifacts, or `tasks.md`.
- The contour uses synthetic messages and a controlled in-process `fetch` response. It performs no real provider, network, database, credential, or personal-data operation.

## Executable architectural boundaries

- Runtime readiness: `validateRuntimeConfiguration`.
- Transport: `executeLlmAttempt` and `OpenAiCompatibleProviderAdapter`.
- Protected observability: `AdminOnlyProtectedTraceStore` request projection and effective schema artifact identity.
- Versioned contracts: `RESPONSE_SCHEMA_ARTIFACTS`.
- Production prompt construction: vacancy, OCR, fact-extraction, and assessment prompt builders.

## Covered behavior

| Requirement | Acceptance oracle |
|---|---|
| INT-023 | Provider body contains an exact `response_format.type=json_schema`, safe name, `strict=true`, and the resolved artifact schema; messages do not contain a serialized schema; refusal and truncation are typed failures. |
| INT-024 | Missing/false provider support and an invalid open strict schema block readiness with artifact-scoped safe diagnostics; no legacy success/fallback is accepted. |
| INT-025 | Protected trace request records the effective response format and preserves artifact id/version/hash without credential or authorization header. |
| VAC-040 | Full vacancy, ordinary field, and ABC use three distinct closed strict artifacts; full vacancy fixes exactly five ABC directions; production prompts contain no schema-shaped exemplar. |

## Expected RED captured before implementation

- Captured at `2026-08-26T08:19:14.8750880Z`.
- Focused result: **6 tests, 0 passed, 6 failed, 0 infrastructure errors**.
- Exit code: `1`, expected while the legacy implementation remains in place.

Observed product gaps:

1. The provider body has no gateway-owned `json_schema` response format; it therefore cannot expose the exact strict artifact or trace it.
2. Provider/model profiles without an explicit Structured Outputs declaration are accepted.
3. The permissive `structured-object/v1` artifact is accepted instead of blocking readiness.
4. Provider refusal and `finish_reason=length` are not rejected as typed attempt failures.
5. No exact full-vacancy, ordinary-field, or ABC response artifacts exist in the catalog.
6. Production prompts still serialize response schemas and include vacancy schema-shaped JSON exemplars.

## Evidence and reproduction

- JUnit: `tests/acceptance/evidence/structured-outputs-red.junit.xml`

```powershell
cd web
npx tsx --test tests/structured-outputs.acceptance.test.ts
npx tsx --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/structured-outputs-red.junit.xml tests/structured-outputs.acceptance.test.ts
```

Both commands intentionally exit non-zero until INT-023–INT-025 and VAC-040 are implemented. Assertions must not be weakened to make this baseline green.

## Corrected helper rerun

On `2026-08-26T08:25:06.1264219Z`, the independent helper was corrected to use an explicit `"missing"` sentinel. The previous JavaScript default parameter converted an explicitly passed `undefined` into `true`, so the original JUnit is superseded for the missing-support branch only. The corrected test now exercises two distinct provider documents: one without `supportsStructuredOutputs` and one with `supportsStructuredOutputs: false`.

The shared implementation had advanced by the time of this correction. The corrected current-worktree run is **6 passed, 0 failed**, exit code `0`. Its JUnit evidence is `tests/acceptance/evidence/structured-outputs-corrected-current.junit.xml`. The prompt oracle was also made precise: serializing `responseSchema` or `config.responseSchema.schema` remains forbidden, while serializing ordinary input data that carries only `config.responseSchema.id` is permitted and is not schema duplication.
