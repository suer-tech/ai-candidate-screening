# RabbitMQ parallel candidate pipeline — independent acceptance

## Independence declaration

- Test author: independent acceptance-test subagent `/root/rabbit_acceptance_red`.
- Executor: the same subagent for the initial RED capture; subsequent GREEN execution belongs to the implementation/release workflow.
- The author did not participate in the production implementation and did not change production code.

## Test case

- ID: `TST-086`–`TST-091`.
- Requirements: `RBQ-001`–`RBQ-006`, `WF-040`–`WF-046`, `INT-023`, `OPS-007`–`OPS-010`, `SEC-011`–`SEC-013`, `TST-086`–`TST-091`.
- Goal: prove real RabbitMQ/PostgreSQL dispatch semantics, five forms of internal parallelism, candidate failure isolation, outage recovery, confidential envelopes and the unchanged release-gate conflict.
- Preconditions: Docker daemon available; local images `postgres:16.10-alpine` and `rabbitmq:3-management` available (overridable by `RABBIT_ACCEPTANCE_POSTGRES_IMAGE` and `RABBIT_ACCEPTANCE_RABBIT_IMAGE`). No provider, Drive or candidate credentials are required.
- Data: versioned synthetic fixture `rabbitmq-parallel-pipeline-synthetic-v1`; no real PII, provider calls, secrets or reads from `candidate/`.
- Steps:
  1. Start isolated temporary PostgreSQL and RabbitMQ containers with random host ports.
  2. Prove PostgreSQL with a real create/insert/select operation.
  3. Prove RabbitMQ with a real exchange/queue/binding and publish/get operation.
  4. Invoke the production acceptance boundary for every scenario.
  5. Validate crash boundaries, actual overlapping intervals with worker/group/shard/join IDs, failure isolation, outage recovery and envelope/routing allowlists.
  6. Remove only the two smoke-created containers.
- Expected result: infrastructure probes pass with zero infrastructure errors; current implementation returns a product RED until the production RabbitMQ boundary and five fan-out/join paths exist. After implementation, TST-086–TST-090 pass while TST-091 still records `RED_BLOCKED` for the existing main-spec Shared Drive/service-account conflict.
- Postconditions/cleanup: temporary containers are force-removed by `finally`/test teardown; no volumes, external files or provider state are created.
- Actual initial result: captured in generated JSON, JUnit and timeline evidence files.
- Evidence:
  - `tests/acceptance/evidence/rabbitmq-parallel-pipeline-red.json`;
  - `tests/acceptance/evidence/rabbitmq-parallel-pipeline-red.junit.xml`;
  - `tests/acceptance/evidence/rabbitmq-parallel-pipeline-red-timeline.md`.
- Status: expected `RED` before implementation, with both infrastructure probes GREEN.

## Independent post-implementation review (2026-09-03)

The acceptance oracle additionally requires every claimed observation to come from the production runtime boundary. A dedicated acceptance-only table, generated timestamps, hard-coded candidate states, or hard-coded release status are not production evidence.

The post-implementation run remains `RED` with `infrastructureErrors=0` and five product failures:

- `TST-086`: the crash exercise uses `acceptance_dispatch`, not production `agent_tasks`, `agent_attempts`, and `agent_task_dispatch_outbox`;
- `TST-087`: the overlap timeline is generated in memory rather than read from production `agent_events`;
- `TST-088`: candidate states and failure isolation are returned as constants rather than read from the production read model;
- `TST-089`: the broker exercise does not observe production dispatch-outbox transitions;
- `TST-091`: release/E2E identity and gate state are returned as constants rather than composed from immutable evidence artifacts.

`TST-090` still passes its real published/unacked/DLQ envelope inspection. A separate focused contract test remains RED because a prefix fallback authorizes an unregistered `candidate.matrix-*` task outside the exact routing registry.

## Commands

From `web/`:

```powershell
node tests/rabbitmq-parallel-pipeline.evidence.mjs --output tests/acceptance/evidence/rabbitmq-parallel-pipeline-red.json
node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/rabbitmq-parallel-pipeline-red.junit.xml tests/rabbitmq-parallel-pipeline.acceptance.test.mjs
```
