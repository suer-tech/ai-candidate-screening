## Context

See proposal.md. Initial production base 99a7bb4; refinement base fde657a. Read-only inspection: 24 latest published assessments; six detailed cases spanning refusal, incomplete and qualified recommendations, 39–2118 chars. No real materials become test fixtures. hrText collapses whitespace; ABC UI concatenates reason/conditions/scales.

## Goals / Non-Goals

**Goals:** deterministic display-only decomposition; new generated prose carries paragraph boundaries; reversible release.

**Non-Goals:** score/recommendation policy changes, historical artifact mutation, report redesign, new provider calls or arbitrary Markdown/HTML execution.

## Decisions

- Keep JSON schema fields as strings. Preserve multiline HR-safe prose separately from single-line labels/normalization; comparison helpers may still normalize whitespace.
- A small shared presentation module splits paragraphs and explicit lists, recognizes a bounded set of existing full sentence section markers, and preserves original slices. Fallback is intact prose, not sentence-count chunking. Unknown headings do not invent semantics.
- UI renders safe React text with semantic paragraphs/lists. ABC passes separate fields instead of joining them; individually labeled scale descriptions; the user refinement dated 2026-10-14 hides defining conditions from the card without changing stored fields. Place the evidence toggle after reasoning and the native scale disclosure, immediately before its controlled panel. Keep grade/title noninteractive. The scale and evidence remain independent accessible controls.
- Presentation instructions are versioned without changing output schemas or the underlying decision rules. No extra LLM stage. A formatting failure never makes a previously valid assessment invalid.
- Independent synthetic rendered acceptance covers heterogeneous prose, exact non-whitespace content/order, safe HTML, optional fields, ABC sections and projection-to-UI newline preservation. Root also performs real browser visual QA.

## Risks / Trade-offs

- Heuristic paragraph boundaries are imperfect → use only explicit markers, retain connectives, ambiguous prose stays intact.
- Conditions duplicate rubric definitions → hide their separate presentation as requested; preserve projection/storage and keep the full level definitions.
- Mixed old/new worker prompt versions → targeted release drains idle application services and preserves state; no migrations.
- Full E2E environment remains known blocked → run fail-closed gates and record actual status; user asked for a reversible trial, never label incomplete gates GREEN.

## Migration Plan

Build/test immutable image from reviewed source; pin current trial image 1b9909f for the refinement and configuration build identity. Under deployment lock, pause external intake, stop discovery, require idle, recreate only existing app services with exact replica counts. Verify processing/public health and metadata fingerprints; restore intake only after readiness. Forward compatible rollback returns prior image/source/build ID without reverting DB state. Newly stored multiline strings are compatible with the old renderer.

## Performance follow-up

Selected detail uses the existing authenticated workspace application boundary with an optional JSON-encoded CandidateId query parameter. Omitted parameter retains existing API behavior; invalid input fails400 and missing candidate fails404. The repository resolves the public/number identity and restricts candidate/runtime/report lineage/blob/material reads in SQL before projection. The UI merges only that candidate into the list, tracks which ID is fully loaded, cancels/ignores obsolete reads and never renders another candidate as fallback. Polling keeps the same selected scope. No arbitrary cache or stale assessment reuse; immutable report/recovery lineage semantics remain unchanged.
