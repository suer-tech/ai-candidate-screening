# Assessment join correction (2026-09-22)

## Diagnosis and scope

The reported run completed document/transcript/evidence processing, row join and
ABC join, then failed at assessment join with `incomplete_structured_output` on
its first attempt. The old provider adapter used that one code for length,
content-filter and generic incomplete termination; the supplied operational log
cannot distinguish which provider finish reason occurred.

Two implementation defects were identified: the join requested all matrix rows
again but discarded them, and it lacked a durable transient retry budget.
The correction requests only a recommendation and rationale, preserves joined
artifacts, and permits three task attempts for transport failures and explicitly
confirmed length truncation. Schema errors, refusals and filters are terminal.
No model, credentials, database schema or completed candidate data are changed.

## Verification and outstanding gates

- Independent synthetic tests reproduced product RED before implementation.
- `npm run test:assessment-join`: 55 passed, including the strict provider request,
  immutable input preservation, terminal invalid output and non-multiplying retries.
- `npm run test:agent-runtime:focused`: 15 passed; build and strict OpenSpec pass.
- Full `npm test` is not green: seven failures in the changes suite reproduce on
  the original production commit `287c49a` (legacy assessment capability fixtures,
  report-preview expectation and missing provisioned runtime).
- Additional matrix/Rabbit/tool regression: 19 passed and three legacy tool tests
  fail identically on `287c49a`. Global lint has the same 86 baseline errors.
  TypeScript has 112 diagnostics versus 117 on baseline; no new file/error-code
  group was introduced. These checks must not be described as all-green.
- Required E2E preflight and all four production-like E2E are BLOCKED without the
  isolated E2E configuration, identity, fixtures and explicit cleanup consent.
  RabbitMQ production acceptance remains open. The Shared Drive/service-account
  main-spec conflict and reviewed OPS-003 delta still require normative closure.

Pushing this correction is not proof of production recovery or release readiness.
Do not use real candidate material as a substitute for the required synthetic gates.

## Operator update

Run on the VPS, not in Windows PowerShell. This checkout uses `/root/hr` and both
compose files under `/root/hr/deploy/docker`. Stop if Git reports local tracked
changes or cannot fast-forward. Preserve runtime files and volumes. Apply only
the reviewed `main` commit; do not switch to the older main image.

```bash
cd /root/hr
git status --short
git diff --quiet && git diff --cached --quiet || { echo 'Local changes: stop'; exit 1; }
git fetch origin main
git switch main
git merge --ff-only origin/main

dc() {
  docker compose --project-directory /root/hr/deploy/docker \
    --env-file /root/hr/deploy/docker/.env \
    -f /root/hr/deploy/docker/docker-compose.yml \
    -f /root/hr/deploy/docker/docker-compose.vps.yml "$@"
}

export CANDIDATE_PIPELINE_BUILD_ID="$(git rev-parse HEAD)"
dc build web
dc run --rm --no-deps web npm run test:assessment-join
```

Do not continue if build or the focused tests fail. After required environment
gates and rollout approval, and with no in-flight candidate tasks, recreate the
application containers using the same exported build ID:

```bash
dc up -d --no-build
dc ps
dc exec -T web sh -lc 'printf "BUILD_ID=%s\n" "$CANDIDATE_PIPELINE_BUILD_ID"'
dc exec -T worker-llm sh -lc 'printf "BUILD_ID=%s\n" "$CANDIDATE_PIPELINE_BUILD_ID"'
dc logs --since 15m --tail 500 --timestamps worker-llm worker-control
```

Persist the same `CANDIDATE_PIPELINE_BUILD_ID` in the existing compose `.env`
before future deployments; otherwise a future shell may reuse the old value.
Git is used on the host only: do not run `build:id` inside the runtime image.
Do not delete volumes, manipulate failed tasks in SQL, or claim the failed run
automatically resumed. Use the application's explicit retry only after the new
build is confirmed. A successful result requires actual downstream validation,
report generation and publication, not just a healthy web container.

The separate central-observability branch is intentionally excluded: its VPS
override adds mandatory monitoring configuration and has an unfinished two-VPS
smoke gate. Integrate it through its own reviewed rollout rather than incident
hotfix deployment.
