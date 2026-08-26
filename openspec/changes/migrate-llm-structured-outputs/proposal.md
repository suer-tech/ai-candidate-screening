## Why

The current OpenAI-compatible integration sends only `response_format: { "type": "json_object" }` and embeds response schemas in model instructions. JSON mode guarantees parseable JSON but does not enforce the versioned schema, duplicates technical contracts across prompts, consumes prompt context, and lets transport behavior drift away from the schema artifacts that the server validates.

## What Changes

- Require schema-bearing LLM capabilities to send their versioned response schema through the OpenAI-compatible Structured Outputs field `response_format.type = "json_schema"` with strict adherence enabled.
- Remove serialized JSON Schema and schema-shaped examples from system and user prompts after the corresponding response artifacts are strict-compatible.
- Introduce exact response-schema artifacts for full vacancy generation, ordinary field generation, and ABC field generation instead of routing those shapes through the permissive `structured-object/v1` artifact.
- Validate at startup that every configured Structured Outputs schema belongs to the supported strict JSON Schema subset and that a provider/model profile explicitly declares Structured Outputs support.
- Preserve short semantic output instructions, immutable prompt/version binding, raw provider responses, deterministic server-side validation, migration handling, retry policy, and protected traces.
- Fail closed when Structured Outputs is unsupported or a configured schema is incompatible; do not silently fall back to prompt-embedded schemas or legacy JSON mode.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `integrations-and-operations`: Define the transport contract, strict-schema compatibility gate, provider capability declaration, refusal/truncation handling, traceability, and fail-closed behavior for Structured Outputs.
- `vacancy-profile`: Require exact versioned schemas for full-profile and field-level vacancy generation while keeping the existing editable business instructions separate from the immutable response contract.

## Impact

- LLM gateway request types, runtime configuration, OpenAI-compatible adapter, protected trace request projection, schema artifacts, and startup validation.
- Vacancy generation, OCR, fact extraction, candidate assessment, matrix capabilities, and their prompt composition call sites.
- RouterAI deployment configuration must declare Structured Outputs support for the selected model.
- Existing schema validators and normalized-output checks remain authoritative defense-in-depth boundaries.
- Acceptance coverage must prove that schemas are present in the provider request, absent from prompts, unsupported schemas/providers fail closed, and required production E2E scenarios remain green.
