# Evidence planning starvation correction (2026-09-22)

## Incident and evidence boundary

The operator confirmed matching web/worker build `7074366` and Grok configuration.
A media shard failed after 35.605 seconds with a generic execution error. During
the same window the media worker reported six heartbeat request timeouts, with
the confirmed lease still valid. Web also reported PostgreSQL `CONNECT_TIMEOUT`;
PostgreSQL logged a client reset at the same time. Containers had zero restarts
and no OOM flag. A later snapshot showed ample memory/disk and few connections.
The later resource snapshot cannot establish resource availability during the
incident. The original media exception was sanitized before persistence and
cannot now be reconstructed. No candidate materials were used in this analysis.

## Reproduced defect and correction

`buildCriterionClaimExtractionBatches` performs repeated synchronous full-request
tokenization while building growing document/transcript windows. Production used
it during fan-out planning, inside every evidence shard, and in the legacy claims
path. All run inside the shared web tool executor, so separate Rabbit worker
containers did not isolate this CPU work from control-plane sockets and timers.

A local synthetic fixture with 30 criteria, 600 utterances and the real
`js-tiktoken` o200k encoder made 1,201 token counts. Before correction it blocked
the event loop for 24,413 ms; a 10 ms timer ran only after 24,414 ms. With the
cooperative driver the same workload took 25,455 ms, with 649 timer ticks and a
maximum observed interval of 108 ms. These are local measurements, not a promised
production latency bound. This reproduces a plausible mechanism for simultaneous
timeouts, not definitive proof that it caused the historical media exception.

The production driver now yields to I/O between token counts. A shared generator
keeps the synchronous compatibility API and the async API identical in contents,
IDs, order, overlap, locators, token checks and errors. All three production call
sites await the cooperative API. No materials are truncated, no model/provider
changes, timeout increases or retry-policy changes are made. Individual tokenizer
calls remain synchronous and total CPU cost remains; this is not a worker-thread
isolation or asymptotic batching optimization.

Media shard failures additionally emit `candidate-phase-error` with technical
run/task/attempt IDs, phase, elapsed time and an allowlisted top-level/nested cause
code. Phases distinguish source download, processor request, response read and
artifact storage. No raw exception, stack, filename, URL, prompt or content is
logged. The original error is rethrown unchanged, even if logging itself fails.
Unknown persisted failures are not guessed to be transient and automatically
retried by this correction.

## Verification and deployment

Run `cd web && npm run test:batch-responsiveness`. The command is first in
`npm test` and exercises cooperative progress, byte-equivalent batching behavior,
source preservation, errors, diagnostic minimization and unchanged outcomes.
An independent author observed two behavioral timer-progress failures before the
fix. Diagnostic tests initially used an explicit operation passthrough seam;
their RED proves missing records at that seam, not production integration.

Final local verification: 52 focused tests pass, including a loopback HTTP request
with real tokenization that completes while planning is still running. The same
HTTP test fails with the original synchronous implementation. An independent
in-memory comparison against commit `70743669` confirms exact batch outputs and
token-count call sequences (not just comparison of two drivers sharing new code).
The full `npm test` passes the new suite, runtime configuration, 39 heartbeat and
55 assessment regressions, build and rendered checks before stopping at seven
previous report-preview/legacy trace/runtime-configuration failures. Strict
OpenSpec passes all 27 items. Lint passes for the planner and new diagnostic/tests;
the touched production-runtime file retains eight pre-existing unused variables
outside the edited sections. TypeScript reports 113 repository diagnostics, none
in these changed source/test files. Required E2E/preflight are blocked by absent
test environment and credentials. No production run was triggered by verification.

Do not restart active candidate processing or edit historical task states in SQL.
Deploy only after draining active runs using the existing immutable Docker build
procedure. Preserve PostgreSQL/Rabbit volumes, runtime files and artifacts. A
manual retry remains subject to existing checkpoint compatibility, including the
build/config fingerprint; this change does not guarantee reuse across builds.

Real PostgreSQL/Rabbit acceptance and all four production-like E2E remain required.
Missing provisioned fixtures/credentials is BLOCKED, not PASSED; the canonical
Shared Drive/service-account conflict remains independently unresolved. Local
synthetic success must not be presented as verified production recovery.
