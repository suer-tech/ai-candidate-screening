# LLM runtime boundary

The files in this directory define a vendor-neutral contract. They do not select
an LLM vendor, model, deployment product, or protected-storage implementation.

## Version-controlled artifacts

- `artifacts.ts` contains versioned prompt, response-schema, tool-schema, and
  non-secret execution-default artifacts.
- A deployment-specific non-secret `RuntimeConfigDocument` maps each logical
  capability to a provider profile, model, artifacts, limits, retry policy, and
  an explicit fallback policy.
- Configuration is validated with `validateRuntimeConfiguration` at process
  startup. A changed configuration is activated by a controlled process restart.
- Every attempt records the immutable effective configuration snapshot returned
  by `RuntimeConfiguration.resolve`.

## Runtime-only values

Provider credentials must be supplied through an implementation of
`RuntimeSecretSource` backed by environment variables or a secret store. A
credential value must never be stored in the configuration document, source
control, protected trace, or ordinary log. Provider endpoints containing secret
query parameters are rejected.

Docker Compose may mount the non-secret configuration read-only and inject only
secret references/credentials at runtime. No real secret belongs in a Compose
file committed to the repository.

The worker adapter reads the serialized non-secret document from
`LLM_RUNTIME_CONFIG_JSON`; every `secretReference` is resolved as a separate
runtime environment/secret name. `loadRuntimeConfiguration` rejects missing,
partial, secretless, or implicit-fallback configuration before a caller can
resolve a capability.

## Protected trace storage

Production must provide `ProtectedTracePersistence` and enforce technical-admin
access around `AdminOnlyProtectedTraceStore`. Each LLM attempt is a separate,
self-contained trace containing its exact functional exchange and material
snapshots. Traces expire exactly 30 days after creation and remain independent
from application-level candidate deletion.

The included `R2ProtectedTracePersistence` uses the dedicated
`PROTECTED_LLM_TRACES` binding. Application routes do not expose that binding;
retention maintenance must call `purgeExpired` at least daily and monitor its
result. A deployment may replace this adapter without changing the trace
contract.

If protected persistence fails, `writeProtectedTraceFailOpen` lets processing
continue and emits a metadata-only `IncompleteTraceIncident`. The incident sink
must not serialize prompts, responses, materials, tool payloads, or credentials.
STT events use the separate transcription technical journal and are not written
through this contract.

The request-serving store, application-data store, background processor, and
protected trace store are separate logical roles. Deployment may colocate them,
but access policies and adapters must preserve those boundaries.
