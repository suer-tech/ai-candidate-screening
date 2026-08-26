# AGENT-RUNTIME — independent RED acceptance baseline

- Change: `add-durable-agent-runtime`
- Author: independent acceptance subagent `/root/durable_runtime_red`
- Executor of recorded RED: independent acceptance subagent `/root/durable_runtime_red`
- Independence declaration: the author/executor did not implement the durable agent runtime production code.
- Data: only `candidate-synthetic-001` and deterministic local fixtures; no real candidate data, provider secrets, network calls, or external spend.
- Command: `npm run test:agent-runtime`
- Cleanup: fixtures are immutable repository data; the RED run creates no candidate/provider state and requires no external cleanup.

## Test cases

### TST-110 — restart/checkpoint continuation

- Related requirements: TST-110, AGT-003, AGT-005, OPS-006.
- Purpose: prove recovery before claim, during lease, after an effect before acknowledgement, after provider checkpoint, and between eval/repair.
- Preconditions: production conformance adapter and persistent background runtime are available.
- Steps: execute each of the five controlled restart points in an isolated synthetic run and drain that run.
- Expected: per isolated case, one remote STT job, checkpoint-based continuation, one expensive execution, reconciliation before any repeated effect, `SUCCEEDED`.
- Actual RED: production conformance adapter is absent; scenario returns `NOT_IMPLEMENTED`.
- Evidence: Node test diagnostic and `agent-runtime-red.junit.xml`.
- Status: RED (expected before implementation).

### TST-111 — concurrent claims, lease reclaim and idempotency

- Related requirements: TST-111, AGT-004, AGT-006.
- Purpose: prove at-least-once delivery with a single effective result.
- Preconditions/data: two synthetic workers, one duplicated trigger, deterministic provider/artifact identities.
- Steps: claim concurrently, expire the winning lease, reclaim it, send late completion from the old owner, then complete with the current owner.
- Expected: one concurrent winner per lease epoch, one effective completion/effect/artifact, stale token rejection, duplicate linked to the existing outcome.
- Actual/status/evidence/cleanup: same RED boundary and evidence as TST-110; no external state.

### TST-112 — budgets and tool grants

- Related requirements: TST-112, AGT-008, AGT-009, SEC-012.
- Purpose: prove every configured budget and invalid-grant class is a hard pre-effect gate.
- Preconditions/data: deterministic budget/grant matrix in the fixture.
- Steps: exhaust attempts, repair, replan, LLM call/token/cost, wall-time and external-request limits; restart after repair usage; exercise absent/expired/wrong-scope/wrong-side-effect grants.
- Expected: zero denied provider calls, durable `BUDGET_EXHAUSTED`, usage preserved after restart, denial audit without secret resolution.
- Actual/status/evidence/cleanup: same RED boundary and evidence as TST-110; no external state.

### TST-113 — eval, repair and replan

- Related requirements: TST-113, AGT-002, AGT-010, AGT-011.
- Purpose: distinguish PASS, bounded local repair, repeated violation, immutable replan and loop guard.
- Preconditions/data: controlled evaluator decisions and stable obstacle fingerprints.
- Steps: pass one gate, repair one missing locator and re-evaluate, repeat a second violation through replan to human-required.
- Expected: one repair and one replan maximum, immutable plan versions 1/2 with mapping, transcript reuse, no unbounded loop, typed non-success outcome.
- Actual/status/evidence/cleanup: same RED boundary and evidence as TST-110; no external state.

### TST-114 — typed escalation and resume

- Related requirements: TST-114, AGT-012, AGT-013, WF-020, WF-040.
- Purpose: prove a resolvable obstacle is `WAITING_FOR_HUMAN`, same-input resolution resumes the same run, and input replacement creates a linked run.
- Preconditions/data: two allowlisted actions (`confirm-mapping`, `replace-input`) and escalation revisions.
- Steps: resolve current escalation without input change, repeat stale resolution, then replace input in a new escalation.
- Expected: complete typed escalation record, preserved checkpoints/budgets/artifacts for same run, stale rejection, old run `SUPERSEDED`, new run linked to origin.
- Actual/status/evidence/cleanup: same RED boundary and evidence as TST-110; no external state.

### TST-115 — outbox and compensation

- Related requirements: TST-115, AGT-014, AGT-015.
- Purpose: prove partial/unknown external outcomes never become duplicate or partial visible success.
- Preconditions/data: deterministic reversible PDF-pair and irreversible notification fixtures.
- Steps: inject timeout before call, timeout after effect, partial PDF pair, lost notification response and compensation failure.
- Expected: durable intent/idempotency before calls, reconcile before retry, one visible result version, no duplicate notification, separate outbox/readiness, audited compensation failure.
- Actual/status/evidence/cleanup: same RED boundary and evidence as TST-110; no external state.

### TST-116 — production-like regression gate

- Related requirements: TST-116 and TST-083–TST-085.
- Purpose: require the focused suite and four mandatory E2E tests on one production-like build with safe evidence retained 30 days.
- Preconditions: provisioned background runtime and the mandatory E2E environment.
- Steps: run TST-110–115, then `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`, and collect evidence.
- Expected: all pass on one build; machine result, readable timeline, cleansed artifacts and provisioned runtime are attested.
- Actual RED: local code has no durable runtime adapter; full production-like regression is therefore not claimable or run as part of this baseline.
- Evidence: Node test diagnostic and `agent-runtime-red.junit.xml`.
- Status: RED (expected before implementation); this is not a release acceptance result.
