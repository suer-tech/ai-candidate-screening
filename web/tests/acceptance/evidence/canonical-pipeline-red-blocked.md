# Canonical candidate pipeline — independent RED/BLOCKED baseline

- Change: `implement-canonical-candidate-pipeline`
- Recorded: `2026-08-20T08:30:35.563Z`
- Author and executor: Codex independent subagent `/root/canonical_pipeline_red`
- Independence declaration: the author did not implement the production candidate pipeline and changed no application/server production code or database schema.
- Data: `canonical-candidate-v1`, entirely synthetic; no real PII, credentials, provider spending, raw prompts, protected traces or Telegram `chat_id` values were used.

## Outcome

| Contour | Passed | RED | BLOCKED | Meaning |
|---|---:|---:|---:|---|
| Test infrastructure/fixture contract | 9 | 0 | 0 | Harness, readiness checks and external control fixture contract are executable. |
| Local controlled candidate conformance | 0 | 4 | 0 | Product RED: the canonical pipeline conformance adapter and all 17 required stage boundaries are absent. |
| Production-like Playwright E2E | 0 | 0 | 4 | Environment BLOCKED before Chromium; no production acceptance is claimed. |

The local RED is deliberately separate from production-like E2E. It proves an absent product adapter/stage contract against controlled synthetic fixtures, but it does not prove Google Drive, RouterAI, AssemblyAI, PDF or Telegram behavior. Those claims require the provisioned Playwright contour.

## Test cases

### E2E-VAC-001

- Requirements: TST-010–TST-020, TST-030–TST-036; VAC-001–VAC-038; WF-001–WF-018; SEC-002–SEC-005.
- Purpose: create a vacancy through title-only generation, HR editing, preview and explicit approval; prove durable identity, Shared Drive binding, candidates and consumers.
- Preconditions: authenticated synthetic HR, second synthetic HR, real Shared Drive service account, controlled RouterAI, deployed build/control plane.
- Data: unique run prefix, deterministic vacancy response, unique Drive folder IDs and internal UUIDs.
- Steps: generate/edit/preview/approve; bind Drive; seed candidate; exercise rename/move/copy, stable snapshots, consumer and authorization matrices.
- Expected: active immutable profile v1 only after approval; no duplicate identities; no processing before three stable full intervals.
- Postcondition/cleanup: source Drive folder and all derived/provider artifacts removed; archive alone is insufficient.
- Actual: production-like execution `BLOCKED_ENVIRONMENT`; local controlled check `RED` at Drive discovery, stability/input version, completeness and metrics/ETA.
- Evidence: `canonical-pipeline-environment-blocked.json`, `canonical-pipeline-local-red.json`, `canonical-pipeline-local-red.junit.xml`.
- Status: `BLOCKED_ENVIRONMENT` / local product `RED`.

### E2E-TRN-001

- Requirements: TST-050–TST-057; INT-009–INT-019; WF-023 and WF-030.
- Purpose: prove real FFmpeg/AssemblyAI EU transcription, two-speaker content diarization, confidence rules, role mapping, three immutable representations and provider cleanup.
- Preconditions: secured synthetic two-speaker media asset, real AssemblyAI EU credentials/smoke, background Node worker.
- Data: beginning/middle/end control phrases, known order/speakers/duration, no real candidate data.
- Steps: content probe, audio extraction, real STT, normalization/TXT, role mapping and cleanup.
- Expected: parsed and mutually consistent raw/JSON/TXT artifacts, correct speaker/content/timestamps/confidence, no acoustic identity inference.
- Postcondition/cleanup: temporary audio and remote transcript removed.
- Actual: production-like execution `BLOCKED_ENVIRONMENT`; local controlled check `RED` at media/audio, AssemblyAI and role mapping.
- Evidence: same machine files as above.
- Status: `BLOCKED_ENVIRONMENT` / local product `RED`.

### E2E-ABC-001

- Requirements: TST-060–TST-065; ASM-001–ASM-024; INT-020–INT-022; REP-002, REP-006, REP-008–REP-009.
- Purpose: prove evidence-first assessment for text PDF, scanned PDF/OCR, DOCX and transcript locators and publish the normative ABC PDF.
- Preconditions: frozen profile/input version, controlled RouterAI current-schema responses, protected trace storage and PDF boundary.
- Data: known facts, one-valid-evidence, low-confidence-only, absent-evidence and conflict cases.
- Steps: extract/OCR, build facts/evidence, assess ABC, validate, render/parse/checksum PDF.
- Expected: every direction present in HR order with allowed score/state and complete text locator; no invention or clickable evidence links.
- Postcondition/cleanup: PDF, AI/OCR raw/normalized data and provider artifacts removed.
- Actual: production-like execution `BLOCKED_ENVIRONMENT`; local controlled check `RED` at document/OCR/evidence/assessment/validation/PDF pair stages.
- Evidence: same machine files as above.
- Status: `BLOCKED_ENVIRONMENT` / local product `RED`.

### E2E-RESULT-001

- Requirements: TST-070–TST-076; ASM-030–ASM-061; REP-001–REP-014; OPS-001–OPS-005; SEC-007–SEC-010.
- Purpose: prove the 15-section final PDF, deterministic recommendation, immutable pair publication, direct Telegram result link, comparison, lifecycle and cleanup.
- Preconditions: same candidate/build/config/result version as the other E2E tests, controlled recommendation/conflict matrices and server-only Telegram recipients.
- Data: stop-factor/insufficiency/risk/positive/ABC-only cases, one-recipient base and isolated two-recipient delivery matrix.
- Steps: validate recommendation; render/publish pair; retry/conflict publication; notify; compare candidates; reject mutation; archive/restore/delete.
- Expected: exactly two consistent user PDFs; one recommendation; idempotent per-recipient delivery; `READY` survives Telegram failure; full cleanup/tombstone guard.
- Postcondition/cleanup: source and all derived/provider/delivery data absent; minimal non-personal tombstone may remain.
- Actual: production-like execution `BLOCKED_ENVIRONMENT`; local controlled check `RED` at recommendation/validation/PDF/publication/Telegram/cleanup.
- Evidence: same machine files as above.
- Status: `BLOCKED_ENVIRONMENT` / local product `RED`.

## Environment blockers

Runner configuration is absent for `E2E_BASE_URL`, `E2E_AUTH_STORAGE_STATE`, `E2E_PREFLIGHT_TOKEN`, `E2E_CONTROL_URL`, `E2E_CONTROL_TOKEN`, `E2E_FIXTURE_SET_ID`, `E2E_BUILD_ID`, `E2E_ENVIRONMENT` and `E2E_ALLOW_DESTRUCTIVE_CLEANUP`. Consequently, build/config identity, authenticated HR identity, D1/R2, real Shared Drive permissions, controlled RouterAI, real RouterAI/AssemblyAI smoke, PDF publication, Telegram recipient configuration and provider cleanup remain unverified.

## Commands

- `npm run test:e2e-harness` — 9/9 passed.
- `npm run e2e:preflight -- --json-output tests/acceptance/evidence/canonical-pipeline-environment-blocked.json` — BLOCKED as expected.
- `npm run e2e:required` — BLOCKED at the same configuration gate before Chromium; all four production-like E2E remain blocked, not failed or skipped-as-passed.
- `npm run e2e:canonical:local-red` — 0/4 passed, 4/4 meaningful product RED, 17 missing stages.
- JUnit local RED run — 0/4 passed, 4/4 failed with stage-specific messages.
- JavaScript syntax checks — 5/5 passed.
- Focused ESLint for the changed E2E/helper files — passed.
- `openspec validate implement-canonical-candidate-pipeline --type change --strict --json --no-interactive` — passed; OpenSpec progress is 3/63, with only tasks 1.1–1.3 completed.
