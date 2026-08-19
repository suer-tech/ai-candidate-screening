## Context

Current UI persists editor state only in browser and main specs still describe RouterAI generation plus draft/preview/activation. The target flow crosses server validation, profile versioning and Google Drive provisioning, so partial success must not become externally active.

## Goals / Non-Goals

**Goals:**
- One server-authoritative create operation with idempotent retries.
- Manual editor initialized from a versioned non-LLM template.
- No persisted unsaved draft or hidden activation state.

**Non-Goals:**
- Changing edit/version behavior of already active vacancies beyond compatibility with the new first version.
- Choosing a database, queue, Drive client library or frontend form framework.
- Removing LLM from other product capabilities.

## Decisions

1. **Two UI steps, one persistence commit.** Step 1 validates normalized title; step 2 edits the complete profile. Only final save persists product objects. Alternative autosave was rejected because it recreates a hidden draft lifecycle.
2. **Versioned template snapshot.** The editor receives a copy of the approved standard ABC template and records its template version with the save operation. User changes never mutate the source template.
3. **Server repeats all validation.** Client feedback is advisory; title uniqueness, full profile rules and logical consistency are authoritative at save.
4. **Externally atomic saga.** The operation has a stable operation ID and internal recoverable states, but no vacancy is exposed as active until version persistence and Drive binding both succeed. Compensating or retry logic is implementation-specific.
5. **Idempotency by operation and binding identity.** Retry resolves the same vacancy/folder binding instead of relying on folder names.
6. **No generation compatibility path.** Legacy generation controls and endpoints are removed rather than left disabled.

## Risks / Trade-offs

- [Drive outage delays an otherwise valid save] -> Preserve editor values in the current session and provide idempotent retry; do not publish partial success.
- [Concurrent normalized titles race] -> Enforce uniqueness atomically at persistence boundary, not only during step 1.
- [Long manual form is lost on reload] -> Warn on in-app navigation; accepted trade-off of the explicit no-draft decision.
- [Existing tests assume preview/activation] -> Replace them with independent RED acceptance before implementation and run full regression.

## Migration Plan

1. Add the new server contract and data constraints behind a disabled route/feature boundary.
2. Add independent acceptance tests and migrate the UI to the manual flow.
3. Remove generation endpoints/controls after no consumer remains.
4. Verify existing active vacancies and profile versions remain readable.
5. Rollback restores the prior UI only if no new-format create operation is in flight; persisted active versions remain compatible.
