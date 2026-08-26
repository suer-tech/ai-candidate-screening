# Matrix-driven candidate assessment — independent RED baseline

- Change: `implement-matrix-driven-candidate-assessment`
- Author and executor: independent acceptance subagent `/root/matrix_acceptance_red`
- Independence: this subagent created only synthetic fixtures, acceptance harness/tests and evidence; it did not implement or edit production code.
- Fixture: `matrix-driven-assessment-synthetic-v1`
- Data: synthetic profile/candidates only; no real candidate data, credentials, provider calls, network calls or external spend.
- Production boundary under test: `server/candidate-pipeline/matrix-driven-conformance.ts`, exporting `runMatrixDrivenAssessmentConformance`.
- RED command: `cd web && node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/matrix-driven-assessment-red.junit.xml tests/matrix-driven-assessment.acceptance.test.mjs`
- Machine evidence command: `cd web && node tests/matrix-driven-assessment.evidence.mjs --output tests/acceptance/evidence/matrix-driven-assessment-red.json`

## Recorded baseline

- Recorded at: `2026-08-26T06:58:53.979Z`.
- Result: `26/26 RED`, `0 GREEN`, `0 environment blocked`, `0 external calls`.
- Expected reason: the production conformance adapter and matrix-driven workflow do not exist yet. The harness reports `NOT_IMPLEMENTED` rather than substituting fixture outputs for production behavior.
- Machine-readable detail: `evidence/matrix-driven-assessment-red.json`.
- JUnit detail: `evidence/matrix-driven-assessment-red.junit.xml`.

## Timeline

1. Read AGENTS.md, project architecture, current main specifications and every proposal/design/delta-spec/task artifact for the change.
2. Created immutable synthetic vacancy/candidate sentinels and 26 scenarios mapped to MDA, ASM, SEC, OPS, WF, REP, VAC and TST requirements.
3. Added a black-box conformance harness which invokes the production adapter when present and otherwise returns a typed `NOT_IMPLEMENTED` result. The harness never performs provider or network calls.
4. Ran the complete suite before matrix-driven production implementation. Node exited `1`; all 26 scenarios failed against the absent adapter as expected.
5. Generated safe JSON and JUnit evidence. The JSON confirms six covered groups: shared compilation, compiler/critic, evidence graph, matrix evaluation, security, and rollout/reporting.

## Oracle coverage

- Lazy compilation, concurrent claim, lease/fencing recovery, single checksum, immutable reuse.
- Full-profile compiler input, candidate-data exclusion, clean critic context, exact source refs, qualitative best effort without invented thresholds, invented stop-factor repair, bounded fingerprint loop.
- Source claims rather than facts, context beyond 240 characters with question/answer adjacency, speaker-role gate, global cross-batch conflict, informational unmapped signals.
- Every matrix row, exact missing-row repair, ABC defining-condition sufficiency, independent critical verification, deterministic recommendation priority including `hardRequired`.
- Prompt injection, sensitive decision-context exclusion and candidate/run evidence isolation.
- Shadow side-effect suppression and quality gate, fixed workflow version, immutable legacy result/manual reprocess, exactly the established two PDF files, and cutover blocked unless matrix acceptance plus all four mandatory E2E suites pass on one build.

This is a pre-implementation RED artifact, not a release acceptance claim. TST-122 and production cutover still require the full mandatory E2E set after implementation.
