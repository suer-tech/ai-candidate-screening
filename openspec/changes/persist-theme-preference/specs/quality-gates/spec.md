## ADDED Requirements

### Requirement: TST-103 Theme preference acceptance coverage
Automated acceptance coverage SHALL verify explicit light and dark persistence, reload restoration, system fallback only in the absence of a valid explicit choice, pre-render root-theme bootstrap, safe storage failure handling, and the accessible theme-button contract.

#### Scenario: Theme preference checks run in regression
- **WHEN** the web regression suite runs
- **THEN** it verifies both explicit theme values and dark-system fallback without persisting the fallback
- **AND** it verifies bootstrap ordering, storage failure behavior, accessible name, pressed state, native button semantics, and decorative icon hiding

#### Scenario: Theme implementation changes
- **WHEN** root layout, theme storage, theme resolution, or theme toggle code changes
- **THEN** the focused theme tests and the web build MUST pass before the change is accepted
- **AND** the mandatory production E2E gate remains required under the main quality-gate specification
