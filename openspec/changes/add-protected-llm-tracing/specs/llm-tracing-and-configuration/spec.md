## Purpose

Определяет единый защищённый и vendor-neutral контракт исторической трассировки всех LLM exchanges, их inputs, tool calls, attempts и effective runtime configuration.

## ADDED Requirements

### Requirement: TRC-001 [CONFIRMED] Каждый LLM attempt имеет отдельный self-contained trace
Для каждого vacancy generation, OCR, assessment, validation/repair и future agent/tool LLM call система MUST создавать отдельную trace record на каждый attempt. Record MUST иметь stable trace/call/attempt IDs, capability, workflow run/stage, candidate/vacancy IDs при применимости, input/profile/result versions, parent-child links и provider request ID при наличии. AssemblyAI STT MUST NOT входить в этот contract и SHALL иметь отдельный technical journal.

#### Scenario: Automatic retry выполняет второй call
- **WHEN** первый LLM attempt завершается retryable error и запускается второй
- **THEN** система создаёт две отдельные trace records с общим parent/business run
- **AND** attempt numbers, timing и outcomes различимы

### Requirement: TRC-002 [CONFIRMED] Trace сохраняет exact exchange и full input snapshot
Каждая trace record MUST хранить exact ordered request messages/content blocks; prompt/template version and hash; tool definitions; tool choice; tool-call IDs, names, exact arguments, ordered results/errors; immutable raw response envelope; assistant messages; finish reason; usage; parsed/normalized output; validation/migration chain; и отдельную полную копию каждого использованного material/input snapshot. Reference, hash или dedup link MUST NOT заменять содержимое record. Protected content MUST храниться без redaction/masking. Transport credentials и authorization headers MUST NOT становиться частью LLM exchange.

#### Scenario: Tool call выполнен внутри exchange
- **WHEN** model вызывает tool и получает result
- **THEN** trace сохраняет definition, call ID, exact args, exact result/error и sequence
- **AND** record достаточна для исторического просмотра без обращения к общей input copy

#### Scenario: Один material использован двумя attempts
- **WHEN** retry использует тот же source file
- **THEN** каждая attempt record содержит отдельную full snapshot copy
- **AND** shared dedup reference не заменяет ни одну copy

### Requirement: TRC-003 [CONFIRMED] Trace сохраняет effective model и execution configuration
Record MUST сохранять provider, endpoint без secret parameters, requested and reported model identifiers/versions, API/SDK contract version, prompt/instruction/template version and hash, expected/actual schema versions, response format, generation parameters, tool configuration, limits, timeout/retry policy, effective non-secret config version/snapshot, UTC start/end, monotonic duration, HTTP/provider status, error and retry/backoff metadata.

#### Scenario: Config изменена между runs
- **WHEN** два calls используют разные effective config releases
- **THEN** каждая trace record содержит свой immutable config snapshot/version
- **AND** исторический exchange не зависит от current runtime config

### Requirement: TRC-004 [CONFIRMED] Trace нужен для исторического просмотра, не deterministic replay
System SHALL позволять technical administrator восстановить exact historical request/response/tool-call exchange. Система MUST NOT обещать deterministic re-execution, identical provider response либо automatic replay side effects.

#### Scenario: Administrator исследует old call
- **WHEN** model/provider behavior уже изменилось
- **THEN** сохранённый historical exchange остаётся доступным в течение retention
- **AND** продукт не заявляет, что повтор call вернёт тот же response

### Requirement: TRC-005 [CONFIRMED] Protected traces доступны только technical administrator
Full traces с prompts, materials и PII MUST быть доступны только technical administrator через protected store access. HR MUST NOT иметь доступ; отдельный product UI или export MUST отсутствовать в MVP.

#### Scenario: HR запрашивает trace
- **WHEN** authenticated HR пытается получить protected trace content
- **THEN** система отказывает без раскрытия prompts, PII или protected identifiers
- **AND** обычная candidate card не содержит trace viewer/export

### Requirement: TRC-006 [CONFIRMED] Protected trace хранится ровно 30 дней
Каждая complete или partial protected trace record MUST храниться ровно 30*24 hours от trace creation timestamp и затем удаляться. Candidate deletion до expiry MUST NOT удалять trace раньше. Ordinary metadata incident MAY следовать отдельной technical log policy и MUST NOT содержать full content.

#### Scenario: Candidate удалён на десятый день
- **WHEN** application permanent delete происходит через 10 дней после trace creation
- **THEN** protected trace остаётся доступным administrator до 30-day expiry
- **AND** удаляется по trace retention на 30-й день

### Requirement: TRC-007 [CONFIRMED] Trace-write failure работает fail-open
Невозможность записать protected trace MUST NOT блокировать LLM call или workflow. Processing SHALL продолжаться; система MUST создать metadata-only observability incident с trace/call/run IDs, timestamp, failure class и признаком incomplete tracing без request/response/material full content.

#### Scenario: Protected store недоступен
- **WHEN** trace write завершается ошибкой
- **THEN** applicable LLM processing продолжает normal outcome
- **AND** ordinary observability получает incomplete-trace incident без full content

### Requirement: TRC-008 [CONFIRMED] MVP не требует отдельного tamper evidence
Protected trace store MUST обеспечивать обычную защищённость и access boundary, но MVP MUST NOT требовать отдельные append-only semantics, hash chain или signature. Это отсутствие MUST NOT ослаблять authentication, authorization, encryption или retention requirements.

#### Scenario: MVP trace принят
- **WHEN** trace completeness, access и retention tests проходят
- **THEN** отсутствие hash chain/signature не блокирует acceptance
- **AND** unauthorized access по-прежнему отклоняется

### Requirement: TRC-009 [CONFIRMED] Runtime config разделяет capability, non-secret config и secrets
Business workflow SHALL выбирать logical LLM capability. Schema-validated non-secret runtime config MUST map capability to provider profile, model identifier, prompt/tool/response schema versions, generation parameters, limits, timeouts and retry policy. Invalid config MUST prevent affected service readiness. Changes SHALL применяться controlled restart в MVP; implicit model fallback MUST быть disabled, а explicit fallback MUST фиксироваться в effective config и trace. Secrets MUST поступать только из runtime secret boundary и MUST NOT храниться в version control, image, orchestration manifest, CLI arguments, ordinary logs или exchange content.

#### Scenario: Required secret отсутствует
- **WHEN** affected service запускается без required provider credential
- **THEN** service не становится ready для этой capability
- **AND** secret value не появляется в diagnostics

#### Scenario: Explicit fallback использован
- **WHEN** configured fallback policy выбирает alternative model
- **THEN** trace сохраняет фактический provider/model и policy version
- **AND** смена не происходит неявно

### Requirement: TRC-010 [CONFIRMED] Prompt and schema artifacts версионируются
Prompt templates, tool schemas, response schemas, safe defaults and their versions/hashes MUST быть reviewed version-controlled release artifacts. Rendered prompts и candidate content MUST NOT храниться в version control и SHALL сохраняться только в protected trace. MVP MUST NOT требовать operator UI для model/prompt config; technical administrator SHALL управлять reviewed artifacts и runtime secrets.

#### Scenario: Prompt release изменён
- **WHEN** новая reviewed prompt version развёрнута controlled restart
- **THEN** subsequent calls используют новую version/hash
- **AND** prior traces сохраняют effective prior prompt content and version
