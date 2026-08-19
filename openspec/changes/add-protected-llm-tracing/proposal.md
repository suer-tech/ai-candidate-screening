## Why

Canonical specs частично обеспечивают AI reproducibility, но не дают единого exact trace всех LLM calls, attempts и tool subcalls. Для расследования исторического exchange нужен защищённый self-contained trace contract, отделённый от ordinary logs и vendor-specific implementation.

## What Changes

- Ввести единый protected trace для всех LLM calls: vacancy generation, OCR, assessment, validation/repair и future agent/tool subcalls; AssemblyAI STT остаётся отдельным technical journal.
- Сохранять exact request/messages, response, tool calls/results, effective model/config/prompt/schema, timings/errors/correlation и отдельный full input snapshot для каждого attempt.
- Хранить full content с PII без redaction в protected store, доступном только technical administrator; ordinary logs остаются metadata-only.
- **BREAKING:** хранить каждый trace ровно 30 дней, не удаляя раньше при candidate deletion; это явное исключение из current `SEC-007`.
- Работать fail-open при trace-write failure с обязательным metadata-only observability incident.
- Не требовать в MVP UI/export или отдельный append-only/hash-chain/signature mechanism.
- Определить vendor-neutral runtime configuration boundary для logical capabilities, model/provider selection, prompt versions, secrets и immutable effective config snapshots.

## Capabilities

### New Capabilities

- `llm-tracing-and-configuration`: единый protected trace и runtime configuration contract всех LLM capabilities.

### Modified Capabilities

- `data-and-security`: закрепить protected PII trace boundary, admin-only access, 30-day retention exception и ordinary-log minimization.
- `integrations-and-operations`: расширить AI reproducibility до every call/attempt/tool subcall и effective configuration.
- `quality-gates`: добавить trace completeness, isolation, retention, access and fail-open acceptance scenarios.

## Impact

- Затрагиваются every LLM gateway, workflow correlation, protected persistence, retention job, ordinary logging, runtime configuration and deployment health.
- Provider, model, trace-store product and orchestration technology не фиксируются.
- Product code не реализуется этим planning change.
