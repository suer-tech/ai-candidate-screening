## Context

See `proposal.md` for motivation. The repository already has a vendor-neutral LLM gateway, versioned prompt and response-schema artifacts, an OpenAI-compatible Chat Completions adapter, protected traces, and post-response normalizers. Runtime configuration currently injects legacy `response_format: { type: "json_object" }` through generic generation parameters. Several callers also concatenate a serialized schema or schema-shaped JSON example into messages. Schema quality is uneven: some artifacts are closed and nearly strict-compatible, while others allow arbitrary properties or omit complete nested contracts.

The production provider is RouterAI and the actual model is deployment-configured. RouterAI exposes Structured Outputs only for supporting models, so OpenAI compatibility alone cannot be treated as evidence of support. Main specs require versioned schemas, immutable raw responses, deterministic migration, protected traceability, and fail-closed publication validation.

## Goals / Non-Goals

**Goals:**

- Establish one gateway-owned path from a versioned schema artifact to the actual provider `response_format`.
- Make strict-schema compatibility and provider/model support startup invariants.
- Separate business prompt content from the immutable transport contract.
- Preserve defense-in-depth validation and reproducible traces.
- Cover full vacancy, field-level vacancy, OCR, assessment, extraction, repair, and matrix capabilities without per-caller transport assembly.

**Non-Goals:**

- Migrating from Chat Completions to the Responses API.
- Selecting or hard-coding a RouterAI model.
- Removing semantic output instructions, server validation, schema migration adapters, or retry/recovery behavior.
- Treating provider-side strictness as product-quality validation.

## Decisions

### 1. The gateway owns the effective response format

`ProviderAttemptRequest` will carry an explicit immutable response-format value derived from the resolved `responseSchema` artifact. `executeLlmAttempt` will construct this value after capability resolution; callers will supply messages and tools only. The adapter will serialize it after generic generation parameters so configuration cannot override the schema accidentally.

Alternative considered: continue placing `response_format` in `generationParameters`. Rejected because the schema varies by capability/request and generic configuration can drift from `responseSchemaArtifact`.

### 2. Use strict Chat Completions Structured Outputs

The effective body will use:

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "<artifact-safe-name>",
      "strict": true,
      "schema": {}
    }
  }
}
```

Names will be deterministically derived from artifact ID/version, restricted to the provider-safe character set and length. The schema value will be a deep clone of the immutable artifact.

Alternative considered: function/tool calling. Rejected because these calls describe final outputs, not tool invocations, and the existing adapter already consumes assistant message content.

### 3. Provider support is explicit configuration, not inferred

Provider profiles will declare a Structured Outputs support flag. Configuration validation will require it for every schema-bearing capability. Deployment setup must set the flag only after the configured RouterAI model advertises or passes a controlled capability check. No automatic runtime downgrade is allowed.

Alternative considered: send `json_schema` optimistically and downgrade on HTTP 400. Rejected because it creates non-reproducible behavior and reintroduces prompt-schema fallback.

### 4. Validate the strict subset before runtime calls

A recursive validator will reject open objects, missing `additionalProperties: false` on object nodes, properties not included in `required` where strict mode requires them, unconstrained object/array items, and JSON Schema keywords outside the supported allowlist. Optional domain values will be represented explicitly with nullable unions where needed, not by omitting them from `required`.

The exact allowlist will be covered by table-driven tests and remain independent of post-response domain validation.

Alternative considered: rely on provider 400 responses. Rejected because readiness must fail before candidate processing and provider diagnostics vary by upstream model.

### 5. Replace permissive and dynamic vacancy contracts with exact artifacts

Full vacancy generation receives a complete profile schema. Ordinary field generation and ABC generation receive distinct request-selected artifacts because their shapes differ. If the ordinary field name is dynamic, the request-level schema may clone a versioned base artifact and narrow `field.const` to the selected allowed key; its derived identity/hash must be traceable. ABC input identity/order remains a server-side postcondition because JSON Schema cannot reliably require an arbitrary runtime sequence without generating a bounded per-request schema.

Alternative considered: keep `structured-object/v1` and rely on prompt examples. Rejected because it does not constrain the response and contradicts the migration objective.

### 6. Prompts retain semantics but not schema serialization

Call sites may say “return only the structured result defined by the system response contract” and may describe business semantics, security boundaries, exact domain meaning, and ordering rules. They must not append `JSON.stringify(schema)` or embed schema-shaped exemplar JSON used as a substitute for the response contract.

### 7. Handle refusal and truncation before JSON parsing

The adapter will detect provider refusal fields and non-success finish reasons such as length truncation before accepting content. These outcomes become typed attempt errors and enter the existing retry/recovery policy. A missing content body is not a successful structured result.

### 8. Trace the effective contract

Protected traces will include the schema artifact identity/hash through effective configuration and the sanitized effective response format in the request projection. Credentials and headers remain excluded by allowlist construction.

## Risks / Trade-offs

- [Existing artifacts fail strict validation] → Convert them incrementally within this change and require table-driven validation for every configured production capability before enabling the runtime flag.
- [RouterAI model claims support but rejects part of the schema subset] → Add a controlled provider canary/preflight for the configured model and retain fail-closed readiness; do not downgrade automatically.
- [Strict schemas make formerly optional fields mandatory] → Use explicit nullable unions only where the domain permits absence and keep domain validators authoritative.
- [Large schemas increase request overhead] → Remove duplicated prompt schemas and schema-shaped examples; measure provider usage without weakening the contract.
- [Dynamic vacancy operations select the wrong schema] → Make schema selection explicit in the request/capability boundary and test all three vacancy paths.
- [Existing user changes overlap LLM files] → Apply narrowly with patch-based edits and preserve unrelated worktree changes.

## Migration Plan

1. Add independent acceptance tests that fail against the legacy adapter and prompt composition.
2. Add strict-subset validation and exact schema artifacts until all configured capabilities pass startup validation.
3. Extend provider/runtime configuration with explicit Structured Outputs support and update deployment examples.
4. Route the resolved schema through gateway and adapter, add refusal/truncation handling, and update trace projection.
5. Remove serialized schemas and schema-shaped transport examples from prompts; retain semantic constraints.
6. Run focused unit/acceptance tests, the full repository test suite, and required `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` in a provisioned environment.
7. Deploy only with a RouterAI model confirmed to support Structured Outputs. Rollback uses the previous application release and configuration together; there is no in-release downgrade to legacy JSON mode.
