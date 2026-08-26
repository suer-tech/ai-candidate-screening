## 1. Independent acceptance baseline

- [x] 1.1 Ask an independent subagent that has not participated in implementation to author executable acceptance coverage for INT-023, INT-024, INT-025, and VAC-040.
- [x] 1.2 Run the new acceptance coverage against the current implementation, confirm the expected failures, and save red evidence without weakening assertions.

## 2. Strict schema contracts

- [x] 2.1 Implement a recursive strict-subset JSON Schema validator with safe artifact-scoped diagnostics and table-driven unit tests for accepted and rejected constructs.
- [x] 2.2 Replace permissive or incomplete production response-schema artifacts with closed strict-compatible schemas, using explicit nullable unions only where the domain permits absence.
- [x] 2.3 Add exact versioned schemas for full vacancy generation, ordinary field generation, and ABC field generation, including deterministic request-level narrowing where required.
- [x] 2.4 Add tests proving every production-configured capability resolves to a strict-compatible response schema and that vacancy operations select the correct exact schema.

## 3. Provider and gateway transport

- [x] 3.1 Extend provider/model configuration with an explicit Structured Outputs support declaration and reject missing support or invalid schemas during startup validation.
- [x] 3.2 Derive a deterministic provider-safe schema name and immutable strict `json_schema` response format from the resolved schema artifact in the gateway.
- [x] 3.3 Update the OpenAI-compatible adapter to serialize the gateway-owned response format after generic generation parameters, preventing configuration overrides and legacy fallback.
- [x] 3.4 Detect refusal, missing structured content, and length/incomplete finish reasons as typed safe attempt failures covered by adapter tests.
- [x] 3.5 Extend protected trace request projection and tests to record the effective response format plus schema identity/hash without credentials or headers.

## 4. Prompt and vacancy migration

- [x] 4.1 Remove `JSON.stringify(responseSchema)` and equivalent serialized schema text from OCR, fact extraction, assessment, repair, and matrix prompt construction while retaining semantic output instructions.
- [x] 4.2 Remove schema-shaped transport examples from full and field-level vacancy prompts, route each operation through its exact schema, and preserve the immutable technical/business instruction boundary.
- [x] 4.3 Preserve and test server-side schemaVersion validation, domain validation, migration-chain behavior, ABC input ID/order/count postconditions, and retry/recovery behavior.

## 5. Runtime configuration and documentation

- [x] 5.1 Replace legacy `response_format: { type: "json_object" }` runtime defaults with the explicit Structured Outputs provider/model declaration and update local deployment examples.
- [x] 5.2 Add or update readiness/preflight coverage so an unsupported RouterAI model/profile or incompatible artifact blocks processing without falling back.
- [x] 5.3 Update the LLM runtime documentation and project architecture/index documentation to describe the strict transport contract and operational rollout requirement.

## 6. Verification

- [x] 6.1 Run focused LLM, configuration, vacancy-generation, candidate-pipeline, trace, and independent acceptance tests; save green evidence for the new contract.
- [x] 6.2 Run the complete repository test suite and resolve regressions attributable to this change.
- [x] 6.3 Run required provisioned E2E scenarios `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, and `E2E-RESULT-001`; record any external-environment blocker explicitly and do not claim production readiness without green evidence.
- [x] 6.4 Run `openspec validate migrate-llm-structured-outputs --strict` and reconcile implementation, specs, design, and completed task markers.
