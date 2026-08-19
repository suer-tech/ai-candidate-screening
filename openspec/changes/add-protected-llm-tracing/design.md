## Context

Existing specs persist raw analysis/OCR responses but coverage differs by capability; implementation currently has no RouterAI gateway, trace schema or persistent database. Exact traces contain PII and intentionally outlive early candidate deletion, so they require a boundary distinct from ordinary observability and application data.

## Goals / Non-Goals

**Goals:**
- One gateway contract and trace envelope for every LLM attempt/tool subcall.
- Self-contained historical records with effective configuration.
- Strong separation of protected content, secrets and metadata-only logs.
- Vendor-neutral deployment/configuration compatible with container orchestration.

**Non-Goals:**
- Deterministic replay, automatic tool re-execution or response equivalence.
- Product UI/export for traces.
- Tamper-evidence chain/signature in MVP.
- Choosing trace-store, secret-manager, provider, model or orchestrator product.

## Decisions

1. **Logical gateway before provider adapters.** Callers submit capability, correlation and typed exchange; adapters resolve provider-specific transport. This prevents model literals in business rules.
2. **One envelope per attempt.** Envelope includes exact messages/tool events/raw response/normalized output and an owned input snapshot. Storage-level compression is allowed only if each record remains logically and lifecycle self-contained; shared dedup references cannot replace record content.
3. **Transport secrets excluded before exchange construction.** Authorization headers/credentials never enter the logical request. No redaction is applied to actual exchange content after construction.
4. **Protected and ordinary sinks are separate.** Ordinary logs receive IDs/safe metadata; protected store receives full envelope. HR-facing services have no protected-store credential.
5. **Fail-open persistence.** Call execution is not conditioned on trace-store availability. A metadata-only incident is emitted through ordinary observability; the result explicitly marks tracing incomplete.
6. **Exact TTL from trace creation.** Retention job deletes at 30 days regardless of candidate deletion. This requires a reviewed SEC-007 exception and isolated indexes that do not depend on live candidate rows.
7. **Immutable config release per run.** Version-controlled prompts/tools/schemas and safe defaults combine with deployment non-secret config and runtime secrets. Startup validation and controlled restart avoid hot-reload ambiguity.
8. **No implicit fallback.** Fallback is a named policy in effective config and therefore traceable.
9. **Logical service separation.** Web/API and long-running workflow/media/AI processing are separate service roles; application data and protected trace persistence are separate boundaries. Docker Compose MAY orchestrate them on one server without becoming a product requirement.

## Risks / Trade-offs

- [Full snapshots multiply sensitive storage] -> Strict admin-only boundary, encryption, exact TTL and capacity monitoring; accepted no-dedup product decision.
- [Fail-open creates missing evidence] -> Mandatory correlated incident and incomplete-trace metric; workflow availability has priority.
- [Trace survives candidate deletion] -> Isolate store, deny HR access and enforce exact expiry; security change explicitly documents exception.
- [Prompt source contains internal instructions] -> Keep repository access controlled and never expose templates through client APIs/logs.
- [Provider reports only moving model alias] -> Persist both requested and reported identifiers plus effective config; deterministic replay remains non-goal.

## Migration Plan

1. Define trace/config schemas and metadata-only log allowlist before integrating a provider.
2. Add protected persistence, TTL and admin access with synthetic data.
3. Route one controlled capability through the gateway and pass security/fault tests.
4. Migrate remaining LLM capabilities and retries/tool subcalls; keep STT journal separate.
5. Enable production only after cross-capability completeness and 30-day deletion tests pass.
6. Rollback can disable protected writes fail-open while preserving ordinary incidents; existing traces continue their TTL.
