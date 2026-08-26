# Revised requiredness and critical unmapped risk — independent RED baseline

- Change: `implement-matrix-driven-candidate-assessment`
- Task: `12.1`
- Author and executor: independent acceptance subagent `/root/matrix_acceptance_red`
- Independence: this subagent extended only synthetic fixtures, acceptance oracles and safe evidence; it did not implement or edit production code.
- Data classification: synthetic only; no real candidate data, credentials, network calls, provider calls or external spend.
- Focused command: `cd web && node --test --test-name-pattern=MDA-REVISED --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/matrix-driven-requiredness-risk-red.junit.xml tests/matrix-driven-assessment.acceptance.test.mjs`
- Machine evidence command: `cd web && node tests/matrix-driven-assessment.evidence.mjs --scenario-prefix MDA-REVISED --output tests/acceptance/evidence/matrix-driven-requiredness-risk-red.json`

## Recorded baseline

- Recorded at: `2026-08-26T08:00:57.163Z`.
- Focused result: `6/6 RED`, exit code `1`.
- Environment blockers: `0`.
- External/provider calls: `0`.
- Existing oracle regression check: the full suite has 32 cases; 25 prior cases remain GREEN, the revised required-mismatch expectation is RED, and all six new cases are RED.
- Current product boundary: the conformance adapter returns a safe `ADAPTER_ERROR` for the six unknown revised scenarios; each scenario also records its complete unmet semantic oracle.

## New scenarios

1. `MDA-REVISED-REQUIREDNESS-027`: no separate requirements/required/hardRequired vacancy write controls; `compile-vacancy-matrix/v1` assigns `required` from profile semantics with explanation and clean independent critic verification.
2. `MDA-REVISED-HARD-STOP-028`: `hardRequired=true` exactly for stop-factor sourceRefs; both mismatch directions are rejected with a typed gate and block production routing.
3. `MDA-REVISED-REQUIRED-MISMATCH-029`: an admissibly proven `required` mismatch deterministically produces `Не рекомендовать` and persists the formula branch.
4. `MDA-REVISED-CRITICAL-RISK-030`: open signal remains informational until separate `assess-unmapped-risk/v1` and clean `verify-critical-risk/v1` traces confirm a candidate-scoped `criticalUnmappedRisk`; only then it produces `Не рекомендовать` without mutating the shared matrix.
5. `MDA-REVISED-RISK-UNVERIFIED-031`: failed verification stays informational; a verified noncritical signal can only become a caveat and cannot use the rejection branch.
6. `MDA-REVISED-RISK-SENSITIVE-032`: sensitive content is excluded from both risk stages and a role-irrelevant signal cannot become critical or reject the candidate.

The previous oracle was not weakened. Its required-mismatch branch was updated to the stricter revised ASM-050 outcome, so `MDA-FORMULA-018` is intentionally RED until production formula behavior changes.
