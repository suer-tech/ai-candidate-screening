# Manual reprocess discovery — RED evidence

- Date: 2026-08-24
- Command: `npm run test:manual-reprocess-discovery`
- Result: expected RED — 1 test, 0 passed, 1 failed
- Machine evidence: `manual-reprocess-discovery-red.junit.xml`

`PROD-MANUAL-REPROCESS-001` starts from a READY candidate at revision 7 with an existing stable input version and completed automatic run. After the accepted reprocess command creates revision 8, the acceptance contract requires:

- reuse of the existing immutable goal because `agent_goals` is unique by candidate/input/profile/goal type;
- a distinct `manual-reprocess:<folder>:<inputVersion>:revision-8` run trigger identity;
- exactly one new durable run for that revision and zero new goals;
- reuse of the unchanged immutable input version;
- transition to `ANALYZING`;
- zero duplicate goals/runs across three later stability ticks.

Actual production conformance exposes none of the manual-reprocess projection fields. Production enqueue still accepts only `AUTOMATIC_FIRST_RUN` and derives the original `drive-discovery:<folder>:<inputVersion>` identity, so it cannot reuse the immutable goal while creating the required revision-scoped run.

No production code was changed.
