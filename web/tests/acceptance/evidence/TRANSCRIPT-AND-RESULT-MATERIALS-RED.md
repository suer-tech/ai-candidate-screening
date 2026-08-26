# Published transcript and result materials — RED

Date: 2026-08-24

Command:

```powershell
cd web
node --test --test-name-pattern="CandidateDetail transcript|passes the published candidate transcript|bind transcript bundle|result materials" --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Result: **RED** — 7 tests, 0 passed, 7 failed.

Exact first failure for each contract:

```text
published candidate transcript has a semantic region
actual: undefined; expected: true

CandidateDetail tab consumes the projected candidate transcript rather than demo rows
actual source does not match <TranscriptTab transcript={candidate.transcript} />

search finds the unique middle utterance from the full projection
0 !== 1

published run without utterances has an explicit empty state
actual: undefined; expected: true

projected transcript run id
actual: undefined; expected: 'published-run-65-plus'

title and version have their own header row
0 !== 1

generic compact item grid explicitly excludes the result block
expected selector: .materials-compact>div:not(.panel-head):not(.result-materials)
```

The transcript fixture contains 67 utterances and explicitly checks the first, middle (34th), and last rows without slicing, complete-set search, and distinct missing-transcript/no-search-match states. The server contract binds `transcript-bundle` plus `artifact_blobs` to the exact published report `r.run_id`. Result materials require separate `.result-materials-header` and `.result-materials-actions` rows with isolated alignment CSS.

JUnit: `transcript-and-result-materials-red.junit.xml`.
