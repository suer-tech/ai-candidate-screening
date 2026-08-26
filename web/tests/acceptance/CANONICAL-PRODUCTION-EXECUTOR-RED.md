# Canonical production executor — independent ATDD baseline

## Result

The initial focused production entry contour was RED: 5 tests, 0 passed, 5 failed. Every case reached `executeCandidateTool({ mode: "production" })` and returned `PRODUCTION_TOOL_EXECUTOR_NOT_PROVISIONED`.

Production code changed concurrently after that first run. The final independent rerun is GREEN: 5 tests, 5 passed, 0 failed. The strict grant, env-backed route, OAuth/My Drive snapshot, shadow, effectful recovery, restart/escalation, and data-safety contracts all pass. The current JUnit and JSON evidence describe this final state; the machine-readable JSON also records the initial 5/5 stub RED counts.

This is a product RED, not an environment preflight blocker. The contour uses only controlled, expense-free synthetic provider ports and does not need real URLs, tokens, accounts, identities, or provider resources.

## Exact command

From `web/`:

```text
node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/canonical-production-executor-current-green.junit.xml tests/canonical-production-executor.acceptance.test.mjs
```

Final observed exit code: `0`. Initial stub-run exit code: `1`.

## Covered contracts

- `ATDD-PEX-001`: env D1 + durable personal OAuth/My Drive runtime, exact scoped grant before token/provider access, snapshot derived from the registered candidate folder, and zero Shared Drive/service-account calls.
- `ATDD-PEX-002`: shadow routing reaches all non-visible tools through production provider ports while Drive publication and Telegram remain zero.
- `ATDD-PEX-003`: effectful routing is gated by build-bound release evidence and a durable outbox; repeated report/notification tasks yield one PDF pair and one delivery per configured recipient.
- `ATDD-PEX-004`: provider-job checkpoint restart, unknown-outcome reconcile-before-retry, and `invalid_grant` escalation to `WAITING_FOR_HUMAN` with checkpoint preservation.
- `ATDD-PEX-005`: large artifact payloads remain outside D1/logs, D1 stores references only, and credential markers do not reach returned evidence, D1 observations, or logs.

The fixture identity is unique and synthetic. Provider endpoints use `.invalid` identities or in-memory controlled ports. No real PII, credentials, Telegram recipients, Google resources, RouterAI/AssemblyAI calls, publication, or expense is involved.

## Evidence

- Combined timeline JSON at `tests/acceptance/evidence/canonical-production-executor-red.json` records the initial 5/5 `PRODUCTION_TOOL_EXECUTOR_NOT_PROVISIONED` result. Because production changed in the shared worktree during the run, the JUnit destination with the same `-red` basename was overwritten by the required independent rerun and now contains the final 5/5 GREEN state.
- Final GREEN JUnit: `tests/acceptance/evidence/canonical-production-executor-current-green.junit.xml`
- Final GREEN machine-readable observations, including the initial RED record: `tests/acceptance/evidence/canonical-production-executor-current-green.json`

## Normative conflict to sync

This suite records the personal My Drive behavior only as a change-scoped implementation contract because the active change proposal/design/tasks explicitly require it. Current main specs conflict: `INT-005`/`SEC-003` require corporate Shared Drive plus service account and prohibit production dependency on personal OAuth. No main spec or existing canonical E2E oracle was changed. The conflict remains `BLOCKER_TO_SYNC_BEFORE_MAIN_SPEC_ACCEPTANCE`.

## Independence

Author/executor: independent acceptance subagent `/root/canonical_pipeline_red`. No production code, database schema, main spec, or change task was edited.
