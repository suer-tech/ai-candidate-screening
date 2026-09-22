# Heartbeat recovery correction (2026-09-22)

## Observed incident, not an assumed root cause

Operator diagnostics show several runs failing within one second with
`TOOL_EXECUTOR_LEASE_LOST`, followed by failed fan-out joins. The preceding worker
logs contain both transient heartbeat failures and generic lease-loss responses.
The inspected containers had no restarts/OOM flag. PostgreSQL reported zero
deadlocks, no current blocking, and no matching error log lines. This does not
rule out a past API stall, overload, connection failure or slow application work.
The deployed build was `bbd96db`; the effective file configuration still selected
Sol. No Luna rollout was confirmed. No candidate content belongs in this evidence.

## Reproduced defects and correction

- Any heartbeat HTTP 409/422 was interpreted as fencing loss; the API also used
  422 for unexpected infrastructure failures. Only explicit `STALE_LEASE_TOKEN`
  now proves lease loss. Infrastructure failures return sanitized 503 metadata.
- Interval requests could overlap indefinitely. One bounded request is allowed
  per task; a separate last-confirmed-deadline watchdog cancels expired work.
- Three transient failures could abort an otherwise valid lease. Heartbeat retry
  is now limited by confirmed lease validity, not that arbitrary failure count.
- The HTTP adapter returns FAILED after cancellation; the consumer previously
  persisted this as a terminal task failure. All outcome paths now check ownership
  after adapter execution. Lost/cancelled workers leave recovery to PostgreSQL.
- Authorization, effect preparation and outcome HTTP requests also receive the
  execution cancellation signal and a bounded deadline. Missing-adapter failures
  respect lease expiry; completion racing with shutdown cannot promote work.
- Rabbit consumers recovered expired leases only on startup. The publisher now
  invokes existing recovery periodically, without reviving terminal failed runs.

Provider retries, prompts, models, task artifacts, fencing tokens and external
effect reconciliation are unchanged. Cancelling a client request does not prove
the remote provider stopped; existing checkpoints/grants/fencing remain required.

## Verification and rollout boundary

An independent test author reproduced 20 behavioral failures before implementation
and five further cancellation failures during review, before their correction.
`cd web && npm run test:heartbeat-recovery` includes these tests, HTTP error
classification, publisher scheduling, existing consumer and HTTP adapter checks.
It is included first in `npm test` so unrelated baseline failures cannot hide it.
These synthetic checks are NOT real PostgreSQL/Rabbit or provider E2E evidence.

Do not deploy over active processing or automatically restart historical FAILED
runs in SQL. Preserve all volumes, credentials, runtime files and checkpoints.
Deploy the reviewed commit using the existing Docker runbook and immutable build
ID. Keep model changes separate from this incident correction. Inspect sanitized
`agent-worker-heartbeat-error`, `runtime-heartbeat-error`,
`agent-worker-lease-expired` and `rabbit-expired-tasks-recovered` events. Worker
events now correlate task/run/attempt IDs; API events include allowlisted
infrastructure reason codes, not raw exceptions or query content.

Required real PostgreSQL/Rabbit fault injection and E2E-VAC/TRN/ABC/RESULT must run
on one provisioned immutable identity. Missing Docker, credentials or fixtures is
BLOCKED, not PASSED. The main-spec Shared Drive/service-account mismatch remains
an independent release blocker. Successful unit tests do not prove the observed
production outage is resolved.

Local verification: 39 focused heartbeat/consumer/adapter/error/scheduling tests,
55 assessment-join regressions and 15 runtime tests pass; build, changed-file lint
and all 27 strict OpenSpec checks pass. Full `npm test` still stops at the seven
previously observed report-preview/legacy trace fixture/runtime configuration
failures. Global lint has 86 errors; TypeScript has 112 diagnostics, with none in
the changed files. The E2E harness has 18 passes and three failures (two missing
runtime/PostgreSQL setup, one progress UI expectation). Required E2E preflight and
all four scenarios are blocked by absent E2E configuration. Docker is not available
in this session, so real broker recovery was not exercised. The owner authorized
publishing the correction to GitHub main for an operator-controlled rollout.
Publication of the commit does not mean the server has been updated or verified.
