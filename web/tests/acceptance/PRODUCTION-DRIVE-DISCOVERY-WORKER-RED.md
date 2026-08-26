# Production Drive discovery worker — RED regression evidence

- Main requirements: `WF-002`, `WF-003`, `WF-013`, `WF-015`, `WF-017`, `WF-022` and applicable integrations/operations requirements
- Change context: `implement-canonical-candidate-pipeline`
- Date: 2026-08-21
- Production implementation changed before this run: no
- Fixture policy: synthetic-only; no credentials, provider tokens or real personal data

## Command

```text
npm run test:production-discovery
```

## Expected RED

Two tests executed, zero passed, two failed.

### `PROD-DISC-001: local/VPS worker entry starts the production Drive discovery runtime`

`server/agent-runtime/worker-cli.ts` is the worker target used by `scripts/run-runtime-process.ts`, but it starts only `AgentRuntimeConsumer`. It neither imports production Drive discovery wiring nor calls `startProductionDriveDiscoveryWorker`.

### `PROD-DISC-002: 15-second loop survives Drive errors and enqueues a stable candidate goal durably`

The executable production boundary is absent:

```text
export runProductionDriveDiscoveryWorkerConformanceScenario(fixture)
from server/candidate-pipeline/production-discovery.ts
```

Consequently no production evidence exists for the required 15-second loop, safe tick/success/error logs, continuation after a Drive error, durable candidate registration, three stable full-minute comparisons, immutable input version, or durable canonical goal/task enqueue.

Machine-readable evidence: `tests/acceptance/evidence/production-drive-discovery-worker-red.junit.xml`.
