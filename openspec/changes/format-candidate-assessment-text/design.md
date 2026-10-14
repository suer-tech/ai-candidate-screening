## Context

See proposal.md. Production base 99a7bb4. Read-only inspection: 24 latest published assessments; six detailed cases spanning refusal, incomplete and qualified recommendations, 39–2118 chars. No real materials become test fixtures. hrText collapses whitespace; ABC UI concatenates reason/conditions/scales.

## Goals / Non-Goals

**Goals:** deterministic display-only decomposition; new generated prose carries paragraph boundaries; reversible release.

**Non-Goals:** score/recommendation policy changes, historical artifact mutation, report redesign, new provider calls or arbitrary Markdown/HTML execution.

## Decisions

- Keep JSON schema fields as strings. Preserve multiline HR-safe prose separately from single-line labels/normalization; comparison helpers may still normalize whitespace.
- A small shared presentation module splits paragraphs and explicit lists, recognizes a bounded set of existing full sentence section markers, and preserves original slices. Fallback is intact prose, not sentence-count chunking. Unknown headings do not invent semantics.
- UI renders safe React text with semantic paragraphs/lists. ABC passes separate fields instead of joining them; neutral conditions and individually labeled scale descriptions. Keep existing evidence disclosure separate; scale can be a native disclosure, not a nested interactive control inside a button.
- Presentation instructions are versioned without changing output schemas or the underlying decision rules. No extra LLM stage. A formatting failure never makes a previously valid assessment invalid.
- Independent synthetic rendered acceptance covers heterogeneous prose, exact non-whitespace content/order, safe HTML, optional fields, ABC sections and projection-to-UI newline preservation. Root also performs real browser visual QA.

## Risks / Trade-offs

- Heuristic paragraph boundaries are imperfect → use only explicit markers, retain connectives, ambiguous prose stays intact.
- Some conditions are rubric definitions → preserve original label and use neutral bullets.
- Mixed old/new worker prompt versions → targeted release drains idle application services and preserves state; no migrations.
- Full E2E environment remains known blocked → run fail-closed gates and record actual status; user asked for a reversible trial, never label incomplete gates GREEN.

## Migration Plan

Build/test immutable image from reviewed source; pin old image 7cd3b3c and configuration build identity. Under deployment lock, pause external intake, stop discovery, require idle, recreate only existing app services with exact replica counts. Verify processing/public health and metadata fingerprints; restore intake only after readiness. Forward compatible rollback returns prior image/source/build ID without reverting DB state. Newly stored multiline strings are compatible with the old renderer.
