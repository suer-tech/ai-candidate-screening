# Durable agent runtime RED timeline — 2026-08-20

Build scope: current local worktree, before durable runtime implementation.

```text
11:43:50 +05:00  focused suite started
11:43:50 +05:00  TST-110 fixture loaded -> conformance adapter lookup -> NOT_IMPLEMENTED
11:43:50 +05:00  TST-111 fixture loaded -> conformance adapter lookup -> NOT_IMPLEMENTED
11:43:50 +05:00  TST-112 fixture loaded -> conformance adapter lookup -> NOT_IMPLEMENTED
11:43:50 +05:00  TST-113 fixture loaded -> conformance adapter lookup -> NOT_IMPLEMENTED
11:43:50 +05:00  TST-114 fixture loaded -> conformance adapter lookup -> NOT_IMPLEMENTED
11:43:50 +05:00  TST-115 fixture loaded -> conformance adapter lookup -> NOT_IMPLEMENTED
11:43:50 +05:00  TST-116 fixture loaded -> conformance adapter lookup -> NOT_IMPLEMENTED
11:43:50 +05:00  suite finished: 0 passed, 7 failed, 0 skipped, exit 1
```

The absent runtime cannot yet emit the required event/plan timeline. This short
timeline records the executable RED boundary without fabricating runtime events.
The exact failure details are retained in `agent-runtime-red.junit.xml`. Fixtures
contain synthetic identities only; no provider call, secret resolution, external
spend, or real candidate data occurred.

