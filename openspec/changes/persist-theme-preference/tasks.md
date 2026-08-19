## 1. Acceptance Contract

- [x] 1.1 Add focused acceptance tests for explicit persistence, system fallback, early bootstrap, storage failure, and accessible toggle semantics.
- [x] 1.2 Run the focused tests against the current implementation and record the expected failing baseline.

## 2. Theme Preference Implementation

- [x] 2.1 Add shared theme parsing, resolution, safe storage, root application, and pre-render bootstrap helpers.
- [x] 2.2 Emit the bootstrap before visible content and synchronize system/storage changes without persisting a system-derived fallback.
- [x] 2.3 Update the existing toggle to persist only explicit choices and expose native accessible pressed-state semantics.

## 3. Verification

- [x] 3.1 Pass focused theme tests and dashboard regression tests.
- [x] 3.2 Pass web regression tests, lint, TypeScript checks, and production build.
- [x] 3.3 Pass strict validation for `persist-theme-preference`, `add-operational-dashboard`, and all OpenSpec changes.
- [ ] 3.4 Run mandatory provisioned `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, and `E2E-RESULT-001` before production release.
