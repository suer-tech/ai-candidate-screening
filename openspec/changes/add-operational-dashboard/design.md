## Context

The prototype already has queue, metric cards, vacancy-series bars, recommendation donut and Drive indicator, but all data semantics are local/demo. Canonical workflow and ETA rules remain sources of truth; dashboard must consume them without creating a second status model.

## Goals / Non-Goals

**Goals:**
- One consistent operational read model derived from persisted workflow/result/vacancy/archive state.
- Deterministic period and version semantics across graphs.
- Explicit empty/error states without fabricated data.

**Non-Goals:**
- Recruiter performance analytics, hiring decisions or ranking.
- A separate dashboard error subsystem.
- Selecting a chart library, scheduler or storage engine.

## Decisions

1. **Server-authoritative snapshot.** Dashboard consumes one query snapshot with an effective `asOf` time and local-zone date range, preventing blocks from mixing refresh moments.
2. **Current candidate projection.** Each non-archived candidate contributes one current workflow state and at most one current result. Archived candidates contribute only to a separate archive lifecycle count; latest-run failure rules are applied before active aggregation.
3. **Shared graph period.** A single selector changes both graphs, while queue and status cards remain current-state views.
4. **Vacancy series by stable ID.** Display names/colors are presentation metadata; graph aggregation keys use vacancy ID and include only active vacancies. There is no separate active-vacancy summary card.
5. **ETA delegated to canonical service.** Dashboard never estimates locally; it renders a numeric value or exact fallback returned under WF-032.
6. **Drive health is polling display only.** Check state is transient; no manual reconnect command is introduced.
7. **Navigation carries filters.** Each HR-facing workflow card passes its exact canonical status filter, the archive card passes the lifecycle archive filter, and recommendation categories pass result/period filters to the general queue rather than maintaining duplicate lists.
8. **Primary-card boundary.** The seven primary cards are `MATERIALS_INCOMPLETE`, `TRANSCRIBING`, `ANALYZING`, `VALIDATING`, `READY`, `FAILED`, and archive. Technical `NEW`, `WAITING_FOR_STABILITY`, and `MATERIALS_READY` remain valid workflow states and may appear in queue/detail, but do not receive primary dashboard cards. Each processing card has an exact canonical count and filter; no aggregate presentation status is created.
9. **Semantic status palette.** Insufficient materials remains amber, transcription, AI analysis and result validation use distinguishable indigo/violet tones, ready remains green, failed red, and archive gray. Labels, counts and exact filter behavior remain present so color is never the sole status indicator; recommendation-category colors remain a separate visual vocabulary.
10. **Seven-card responsive grid.** Desktop distributes seven cards in one row; tablet and mobile reduce columns according to available width while retaining source order and full labels.

## Risks / Trade-offs

- [Large vacancy count makes graph unreadable] -> Preserve complete data semantics; responsive visual grouping/legend scrolling may change without merging vacancy series.
- [Concurrent reprocess changes counts during view] -> Use snapshot timestamp and refresh atomically.
- [Timezone boundary causes date drift] -> Convert completion UTC timestamp to `Asia/Yekaterinburg` only for bucket selection/display.
- [Polling amplifies Drive load] -> Connectivity check must be lightweight and independent from full folder scan.

## Migration Plan

1. Build read-model contract and deterministic aggregation tests against seeded data.
2. Replace each demo block independently behind the same snapshot API.
3. Enable period navigation and Drive health after all blocks reject static fallback data.
4. Remove unsupported dashboard actions and analytics placeholder.
5. Run focused dashboard acceptance and full E2E regression before release.
