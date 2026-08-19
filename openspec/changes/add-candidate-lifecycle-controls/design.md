## Context

Current prototype keeps archive in local UI state and mixes workflow stages with demo ratings and decision labels. Canonical workflow already owns processing states and retry policy, while confirmed decisions alter archive/delete and add an explicit card-level reprocess flow.

## Goals / Non-Goals

**Goals:**
- A single server-authoritative workflow/lifecycle read model.
- Safe, auditable lifecycle commands with state preconditions.
- Manual reprocess that composes with canonical stability and retry rules.
- Removal of controls outside MVP scope.

**Non-Goals:**
- Implementing result preview details owned by `add-in-app-report-preview`.
- Deleting any Google Drive content.
- Adding hiring pipeline, HR decision persistence or recruiter analytics.

## Decisions

1. **Workflow state and lifecycle flag are separate.** Archive never overwrites the last workflow status; list filters combine both dimensions.
2. **Commands enforce server preconditions.** UI disabled states are feedback, not authorization. Archive rejects processing candidates; delete rejects non-archived candidates.
3. **Delete is application-only.** Cleanup enumerates internal derivatives and writes a non-PII tombstone; no Drive cleanup workflow exists. This intentionally replaces the current SEC-007 Drive-completion rule.
4. **Manual reprocess is a command followed by stability orchestration.** Confirmation records intent, hides stale result per reporting change, starts stability checks and automatically creates the run only after a complete stable snapshot.
5. **Current run wins presentation.** Primary badge derives from current input/run; recommendation remains a result attribute.
6. **No-op controls are removed rather than disabled.** Functional queue filters and result export remain separate capabilities.

## Risks / Trade-offs

- [Drive files remain after app deletion] -> Preserve tombstone to prevent rediscovery and document the intentional privacy-policy exception.
- [Confirmation precedes a long stability wait] -> Show current state and keep reprocess disabled until workflow terminal state.
- [Concurrent lifecycle commands race] -> Apply optimistic state/version checks and idempotent command IDs.
- [Cross-change dependency on result visibility] -> Acceptance references the preview change but lifecycle implementation does not duplicate PDF selection logic.

## Migration Plan

1. Add persistent lifecycle flag, audit events and command preconditions.
2. Introduce canonical state presentation and acceptance matrix before replacing demo labels.
3. Add reprocess orchestration and verify reuse/version behavior.
4. Remove demo controls only after functional replacements required by main specs are present.
5. Migrate existing local archives deliberately or reset demo-only state; no production Drive deletion is performed.
