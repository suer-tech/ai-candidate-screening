## ADDED Requirements

### Requirement: TST-098 [CONFIRMED] Every LLM attempt создаёт complete self-contained trace
Independent controlled-provider matrix MUST cover each LLM capability, retry and tool subcall, verifying exact ordered messages, raw response, tool sequence, effective config, correlations, timings/errors and separate full input snapshot per attempt without dedup substitution.

#### Scenario: Two attempts use same material
- **WHEN** controlled call retries once
- **THEN** acceptance finds two complete trace records and two self-contained material copies
- **AND** each record reconstructs its own historical exchange

### Requirement: TST-099 [CONFIRMED] Protected content isolated from HR and ordinary logs
Security acceptance MUST verify technical-admin-only trace access, HR denial, no product UI/export, full unredacted protected content and absence of full content/secrets in ordinary logs and incidents.

#### Scenario: HR and administrator request same trace
- **WHEN** both identities request protected content
- **THEN** administrator receives exact trace and HR is denied
- **AND** denial/ordinary logs contain metadata only

### Requirement: TST-100 [CONFIRMED] Exact 30-day retention overrides early candidate deletion
Time-controlled test MUST delete candidate before expiry, verify trace persistence through 30 days, then verify deletion at expiry and no protected copy in ordinary sinks/backups governed by the application test environment.

#### Scenario: Candidate deleted on day 10
- **WHEN** test advances clock to before and then at exact expiry
- **THEN** trace exists before expiry and is absent after expiry
- **AND** candidate application data followed its separate deletion lifecycle

### Requirement: TST-101 [CONFIRMED] Trace outage is fail-open with incident
Fault injection MUST make protected writes fail while controlled LLM calls succeed and fail. Workflow outcome MUST follow LLM/business result, while one correlated metadata-only incomplete-tracing incident is emitted without full content.

#### Scenario: Trace store unavailable during successful assessment
- **WHEN** provider returns valid result but trace write fails
- **THEN** workflow continues to validation/publication
- **AND** incident identifies incomplete trace without request/response content

### Requirement: TST-102 [CONFIRMED] Configuration boundary is validated and reproducible
Tests MUST cover invalid startup config, missing secret, controlled restart, prompt/model version change, disabled implicit fallback and explicit fallback trace. Version-controlled templates/schemas MUST contain no candidate PII or secret values.

#### Scenario: Invalid config deployed
- **WHEN** required capability mapping fails schema validation
- **THEN** affected service remains not ready
- **AND** no LLM call starts with partial/defaulted hidden config
